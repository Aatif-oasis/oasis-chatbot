"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AgentSummary,
  ConversationDetail,
  Message,
  closeConversation,
  createTicket,
  getConversation,
  listAgents,
  sendAgentMessage,
} from "@/lib/api-client";
import { useAgentSocket } from "@/lib/use-agent-socket";

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Raising a ticket is how a chat turns into follow-up work once the
  // customer has gone. It starts from here rather than from the tickets
  // page because this is where the agent already has the context.
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDetail, setTicketDetail] = useState("");
  const [ticketPriority, setTicketPriority] = useState("medium");
  const [ticketSaving, setTicketSaving] = useState(false);
  const [ticketDone, setTicketDone] = useState<string | null>(null);

  function addMessageIfNew(prev: ConversationDetail, incoming: Message) {
    if (prev.messages.some((m) => m.id === incoming.id)) return prev;
    return { ...prev, messages: [...prev.messages, incoming] };
  }

  const { watch, unwatch } = useAgentSocket((event) => {
    if (event.type === "new_message" && event.conversation_id === conversationId && event.message) {
      const incoming = event.message as unknown as Message;
      if (!incoming.id) return;
      setConversation((prev) => (prev ? addMessageIfNew(prev, incoming) : prev));
    }
    if (event.type === "conversation_transferred" && event.conversation_id === conversationId) {
      getConversation(conversationId).then(setConversation).catch(() => undefined);
    }
  });

  useEffect(() => {
    getConversation(conversationId)
      .then(setConversation)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load this conversation")
      );

    listAgents()
      .then((agents: AgentSummary[]) => {
        const nameMap: Record<string, string> = {};
        agents.forEach((a) => {
          nameMap[a.id] = a.full_name;
        });
        setAgentNames(nameMap);
      })
      .catch(() => undefined);

    watch(conversationId);
    return () => unwatch(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [conversation?.messages.length]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    setSending(true);
    try {
      const message = await sendAgentMessage(conversationId, content);
      setConversation((prev) => (prev ? addMessageIfNew(prev, message) : prev));
      setError(null);
    } catch (err) {
      // Put the text back rather than losing what the agent typed.
      setDraft(content);
      setError(err instanceof Error ? err.message : "That message didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleRaiseTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!conversation || !ticketSubject.trim() || !ticketDetail.trim()) return;
    setTicketSaving(true);
    try {
      const ticket = await createTicket({
        customer_id: conversation.customer_id,
        conversation_id: conversation.id,
        subject: ticketSubject.trim(),
        description: ticketDetail.trim(),
        priority: ticketPriority,
      });
      setTicketDone(ticket.id);
      setTicketOpen(false);
      setTicketSubject("");
      setTicketDetail("");
      setTicketPriority("medium");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not raise the ticket");
    } finally {
      setTicketSaving(false);
    }
  }

  async function handleClose() {
    try {
      const updated = await closeConversation(conversationId);
      setConversation((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close this conversation");
    }
  }

  if (error && !conversation) {
    return (
      <div className="page">
        <Link href="/dashboard" className="back-link">
          Back to conversations
        </Link>
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!conversation) return <div className="page">Loading conversation…</div>;

  const assignedName = conversation.assigned_agent_id
    ? agentNames[conversation.assigned_agent_id] || "another agent"
    : null;

  return (
    <div className="chat">
      <div className="chat-head">
        <div>
          <Link href="/dashboard" className="back-link">
            Back to conversations
          </Link>
          <div className="chat-customer">{conversation.customer_name || "Unnamed visitor"}</div>
          <div className="chat-contact">
            {conversation.customer_phone || "No phone given"}
            {conversation.customer_email ? `, ${conversation.customer_email}` : ""}
          </div>
          <div className="chat-meta">
            <span className={conversation.status === "closed" ? "pill" : "pill pill-open"}>
              {conversation.status}
            </span>
            <span>{assignedName ? `With ${assignedName}` : "Not yet claimed"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="btn btn-quiet" onClick={() => setTicketOpen((v) => !v)}>
            Raise a ticket
          </button>
          {conversation.status !== "closed" && (
            <button className="btn btn-quiet" onClick={handleClose}>
              Close chat
            </button>
          )}
        </div>
      </div>

      {ticketDone && (
        <div className="alert alert-info" style={{ margin: "12px 24px 0" }}>
          Ticket raised.{" "}
          <Link href={`/dashboard/tickets/${ticketDone}`} style={{ textDecoration: "underline" }}>
            Open it
          </Link>
        </div>
      )}

      {ticketOpen && (
        <form onSubmit={handleRaiseTicket} className="ticket-form">
          <label className="field">
            What needs following up?
            <input
              value={ticketSubject}
              onChange={(e) => setTicketSubject(e.target.value)}
              placeholder="Refund not received for order 4821"
              required
            />
          </label>

          <label className="field">
            Details
            <input
              value={ticketDetail}
              onChange={(e) => setTicketDetail(e.target.value)}
              placeholder="What you promised the customer, and what happens next"
              required
            />
          </label>

          <div className="controls">
            <label className="field" style={{ marginBottom: 0 }}>
              Priority
              <select value={ticketPriority} onChange={(e) => setTicketPriority(e.target.value)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="urgent">urgent</option>
              </select>
            </label>
            <button type="submit" className="btn" disabled={ticketSaving}>
              {ticketSaving ? "Raising" : "Raise ticket"}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setTicketOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="alert alert-error" style={{ margin: "12px 24px 0", marginBottom: 0 }}>
          {error}
        </div>
      )}

      <div ref={listRef} className="thread">
        {conversation.messages.map((m) => (
          <div
            key={m.id}
            className={m.sender_type === "agent" ? "bubble-row bubble-row-agent" : "bubble-row"}
          >
            <div
              className={m.sender_type === "agent" ? "bubble bubble-agent" : "bubble bubble-customer"}
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Write a reply"
          aria-label="Write a reply"
        />
        <button className="btn" onClick={handleSend} disabled={sending}>
          {sending ? "Sending" : "Send"}
        </button>
      </div>
    </div>
  );
}
