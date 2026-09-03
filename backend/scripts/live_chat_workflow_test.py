"""
Live smoke test for the full workflow:
  Customer opens chat -> sends "Hello" -> Backend receives -> Agent dashboard
  notified -> Agent opens chat -> Agent replies -> Customer receives reply
  instantly -> Conversation saved to DB

Run against the actual running server + real Postgres + real Redis.
Not a pytest file — a standalone script for live verification, same as the
curl-based smoke tests used for Modules 1-3.
"""
import asyncio
import json
import uuid

import httpx
import websockets

BASE = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as client:
        org_name = f"Zeta Support {uuid.uuid4().hex[:6]}"
        org_slug = "-".join(org_name.lower().split())
        admin_email = f"admin-{uuid.uuid4().hex[:8]}@zeta.com"
        agent_email = f"agent-{uuid.uuid4().hex[:8]}@zeta.com"

        print(f"=== Register org '{org_name}' (slug={org_slug}) ===")
        reg = await client.post(
            "/api/v1/auth/register",
            json={
                "organization_name": org_name,
                "admin_full_name": "Zeta Admin",
                "admin_email": admin_email,
                "admin_password": "SuperSecret123",
            },
        )
        assert reg.status_code == 201, reg.text
        admin_token = reg.json()["access_token"]
        print("OK — org + admin created")

        print("\n=== Invite an agent ===")
        invite = await client.post(
            "/api/v1/users",
            json={
                "email": agent_email,
                "full_name": "Zeta Agent",
                "temporary_password": "TempPass123",
                "role": "agent",
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert invite.status_code == 201, invite.text
        print("OK — agent invited")

        print("\n=== Agent logs in ===")
        agent_login = await client.post(
            "/api/v1/auth/login", json={"email": agent_email, "password": "TempPass123"}
        )
        assert agent_login.status_code == 200, agent_login.text
        agent_token = agent_login.json()["access_token"]
        print("OK — agent authenticated")

        print("\n=== Agent dashboard connects to org-wide notification socket ===")
        agent_ws = await websockets.connect(f"{WS_BASE}/api/v1/conversations/ws/agent?token={agent_token}")
        print("OK — agent WebSocket connected, waiting for notifications...")

        print("\n=== CUSTOMER opens chat widget, sends 'Hello' ===")
        external_id = f"visitor-{uuid.uuid4().hex[:8]}"
        start = await client.post(
            f"/api/v1/public/{org_slug}/conversations",
            json={"external_id": external_id, "initial_message": "Hello", "full_name": "Test Visitor", "phone": "9990001111"},
        )
        assert start.status_code == 201, start.text
        conversation_id = start.json()["id"]
        print(f"OK — conversation started: {conversation_id}")

        print("\n=== Backend pushes 'new_conversation' notification to agent dashboard ===")
        notification_raw = await asyncio.wait_for(agent_ws.recv(), timeout=5)
        notification = json.loads(notification_raw)
        print(f"RECEIVED by agent: {notification}")
        assert notification["type"] == "new_conversation"
        assert notification["conversation_id"] == conversation_id
        assert notification["preview"] == "Hello"
        print("OK — agent got real-time notification of the new chat")

        print("\n=== Customer's browser opens the conversation WebSocket to await a reply ===")
        customer_ws = await websockets.connect(
            f"{WS_BASE}/api/v1/public/{org_slug}/conversations/{conversation_id}/ws"
            f"?external_id={external_id}"
        )
        print("OK — customer WebSocket connected")

        print("\n=== Agent opens the chat (watches the conversation room) ===")
        await agent_ws.send(json.dumps({"action": "watch", "conversation_id": conversation_id}))
        print("OK — agent is now watching the conversation")

        print("\n=== Agent replies ===")
        reply_text = "Hi! Thanks for reaching out — how can I help you today?"
        reply = await client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            json={"content": reply_text},
            headers={"Authorization": f"Bearer {agent_token}"},
        )
        assert reply.status_code == 200, reply.text
        print("OK — agent's reply saved via REST")

        print("\n=== CUSTOMER receives the reply instantly over their WebSocket ===")
        push_raw = await asyncio.wait_for(customer_ws.recv(), timeout=5)
        push = json.loads(push_raw)
        print(f"RECEIVED by customer: {push}")
        assert push["type"] == "new_message"
        assert push["message"]["content"] == reply_text
        assert push["message"]["sender_type"] == "agent"
        print("OK — customer got the agent's reply in real time, unprompted")

        print("\n=== Conversation + both messages are persisted in the database ===")
        detail = await client.get(
            f"/api/v1/conversations/{conversation_id}",
            headers={"Authorization": f"Bearer {agent_token}"},
        )
        assert detail.status_code == 200, detail.text
        messages = detail.json()["messages"]
        assert len(messages) == 2
        assert messages[0]["content"] == "Hello" and messages[0]["sender_type"] == "customer"
        assert messages[1]["content"] == reply_text and messages[1]["sender_type"] == "agent"
        print(f"OK — {len(messages)} messages persisted and retrievable via REST:")
        for m in messages:
            print(f"   [{m['sender_type']}] {m['content']}")

        await agent_ws.close()
        await customer_ws.close()

        print("\n=== ALL STEPS OF THE WORKFLOW VERIFIED END-TO-END ===")


if __name__ == "__main__":
    asyncio.run(main())
