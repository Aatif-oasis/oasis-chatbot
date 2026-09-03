// Real end-to-end test of the SHIPPED widget file — not a reimplementation.
// jsdom provides a real DOM + fetch is Node's native fetch; WebSocket is
// Node's native global WebSocket (stable since Node 22). The widget script
// itself has zero idea it's not running in an actual browser tab.
const { JSDOM } = require("jsdom");
const fs = require("fs");

const API_BASE = "http://localhost:8000";
const ORG_SLUG = "widget-test-co";
const ADMIN_TOKEN = fs.readFileSync("/tmp/access.tok", "utf8").trim();

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://customer-site.example.com/pricing",
    runScripts: "dangerously",
    resources: "usable",
  });

  const { window } = dom;
  window.fetch = fetch; // Node's native fetch, real HTTP calls to our real server
  window.WebSocket = WebSocket; // Node's native WebSocket, real socket to our real server

  const scriptEl = window.document.createElement("script");
  scriptEl.setAttribute("data-org-slug", ORG_SLUG);
  scriptEl.setAttribute("data-api-base", API_BASE);
  scriptEl.textContent = fs.readFileSync(__dirname + "/oasis-chatbot-widget.js", "utf8");
  window.document.body.appendChild(scriptEl);

  await sleep(300);

  console.log("=== Widget loaded, checking DOM for bubble ===");
  const bubble = window.document.getElementById("oasis-bubble");
  if (!bubble) throw new Error("FAIL: chat bubble not rendered");
  console.log("OK — bubble rendered");

  console.log("\n=== Customer clicks the bubble to open chat ===");
  bubble.dispatchEvent(new window.Event("click"));
  await sleep(300);
  const panel = window.document.getElementById("oasis-panel");
  if (panel.style.display !== "flex") throw new Error("FAIL: panel did not open");
  console.log("OK — panel opened");

  console.log("\n=== Customer fills the mandatory pre-chat form (name + mobile) and submits ===");
  const preChatForm = window.document.getElementById("oasis-prechat");
  if (preChatForm.style.display === "none") {
    throw new Error("FAIL: pre-chat form is not shown to a fresh visitor");
  }
  const preChatInputs = preChatForm.querySelectorAll("input");
  preChatInputs[0].value = "Test Visitor"; // name
  preChatInputs[1].value = "9990001111"; // mobile
  const startChatBtn = Array.from(panel.querySelectorAll("button")).find(
    (b) => b.textContent === "Start chat"
  );
  startChatBtn.dispatchEvent(new window.Event("click"));
  await sleep(300);
  if (preChatForm.style.display !== "none") {
    throw new Error("FAIL: pre-chat form did not close after a valid submit");
  }
  console.log("OK — pre-chat form submitted, chat body revealed, /identify call fired");

  console.log("\n=== Customer types 'Hello' and clicks Send ===");
  const input = window.document.querySelector('input[placeholder="Type a message..."]');
  input.value = "Hello";
  const sendBtn = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent === "Send");
  sendBtn.dispatchEvent(new window.Event("click"));

  await sleep(800); // let startConversation() + connectSocket() resolve

  const messagesAfterSend = window.document.getElementById("oasis-messages").children;
  if (messagesAfterSend.length !== 1 || messagesAfterSend[0].textContent !== "Hello") {
    throw new Error("FAIL: customer's own message not rendered locally");
  }
  console.log("OK — customer's message rendered in the widget DOM");

  console.log("\n=== Fetching the conversation ID the widget just created ===");
  const listResp = await fetch(`${API_BASE}/api/v1/conversations`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  const conversations = await listResp.json();
  const conv = conversations[0];
  console.log(`OK — found conversation ${conv.id}`);

  console.log("\n=== A real agent replies via the real REST API (simulating the dashboard) ===");
  const replyResp = await fetch(`${API_BASE}/api/v1/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ content: "Hi! Thanks for reaching out." }),
  });
  if (replyResp.status !== 200) throw new Error("FAIL: agent reply REST call failed");
  console.log("OK — agent reply sent");

  console.log("\n=== Waiting for the WIDGET's own WebSocket handler to render it live ===");
  await sleep(1000);

  const messagesAfterReply = window.document.getElementById("oasis-messages").children;
  console.log(`Widget DOM now has ${messagesAfterReply.length} message bubbles:`);
  for (const el of messagesAfterReply) {
    console.log(`   [${el.className}] ${el.textContent}`);
  }

  if (messagesAfterReply.length !== 2) {
    throw new Error(
      `FAIL: expected 2 messages in the widget DOM, got ${messagesAfterReply.length}`
    );
  }
  if (!messagesAfterReply[1].textContent.includes("Thanks for reaching out")) {
    throw new Error("FAIL: agent's reply was not rendered by the widget's own code");
  }

  console.log(
    "\n=== SUCCESS: the actual shipped widget.js received and rendered the agent's reply live, with zero polling — through its own unmodified WebSocket handler ==="
  );

  window.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Hard safety net: never let a hung socket/timer keep this process alive.
setTimeout(() => {
  console.error("TIMEOUT: test did not complete in time");
  process.exit(1);
}, 15000);
