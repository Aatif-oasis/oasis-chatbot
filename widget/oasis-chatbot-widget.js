/**
 * Oasis Chatbot embeddable chat widget.
 *
 * Usage on any website:
 *   <script src="https://cdn.example.com/oasis-chatbot-widget.js"
 *           data-org-slug="acme-corp"
 *           data-api-base="https://api.oasis_chatbot.example.com"></script>
 *
 * Deliberately vanilla JS, not React/Vue: this has to run correctly on
 * whatever framework (or no framework) the HOST site uses, so it can't
 * assume anything about the page it's embedded in. Everything lives
 * inside one script tag's execution — no bundler, no build step for the
 * business embedding it.
 */
(function () {
  "use strict";

  var scriptTag = document.currentScript;
  var ORG_SLUG = scriptTag.getAttribute("data-org-slug");
  var API_BASE = scriptTag.getAttribute("data-api-base") || "";
  var STORAGE_KEY = "oasis_external_id_" + ORG_SLUG;

  if (!ORG_SLUG) {
    console.error("[Oasis Chatbot] Missing required data-org-slug attribute.");
    return;
  }

  // ---------- Visitor identity (NOT a login — just a stable per-browser id) ----------

  function getOrCreateExternalId() {
    var existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    var generated =
      "visitor-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  }

  var externalId = getOrCreateExternalId();
  var socket = null;
  var historyLoaded = false;
  var reconnectAttempts = 0;
  var reconnectTimer = null;

  // ---------- Conversation continuity across page loads ----------
  // Without this, a page refresh dropped the thread: the visitor saw an
  // empty box and their next message opened a brand new conversation, so
  // one person showed up in the dashboard (and in any CRM listening to
  // webhooks) as several unrelated chats.
  var CONVERSATION_STORAGE_KEY = "oasis_conversation_" + ORG_SLUG;

  function getSavedConversationId() {
    return window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
  }

  function saveConversationId(id) {
    if (id) window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
  }

  function clearConversationId() {
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    conversationId = null;
    historyLoaded = false;
  }

  var conversationId = getSavedConversationId();

  // ---------- Pre-chat visitor details (name + mobile, mandatory) ----------
  // Persisted per-visitor so a returning visitor isn't asked again — same
  // "known once, known forever" idea as externalId itself.
  var DETAILS_STORAGE_KEY = "oasis_visitor_details_" + ORG_SLUG;
  var COUNTRY_STORAGE_KEY = "oasis_country_" + ORG_SLUG;

  function getSavedDetails() {
    try {
      var raw = window.localStorage.getItem(DETAILS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveDetails(details) {
    window.localStorage.setItem(DETAILS_STORAGE_KEY, JSON.stringify(details));
  }

  var visitorDetails = getSavedDetails();

  // ---------- Country dialling codes ----------
  // Bundled rather than fetched: the widget must work on any website with
  // no extra network calls and no build step. Ordered by how commonly the
  // code is needed, then alphabetically, so the list is quick to scan.
  var COUNTRIES = [
    { iso: "IN", name: "India", dial: "91" },
    { iso: "US", name: "United States", dial: "1" },
    { iso: "GB", name: "United Kingdom", dial: "44" },
    { iso: "AE", name: "United Arab Emirates", dial: "971" },
    { iso: "AU", name: "Australia", dial: "61" },
    { iso: "BD", name: "Bangladesh", dial: "880" },
    { iso: "BR", name: "Brazil", dial: "55" },
    { iso: "CA", name: "Canada", dial: "1" },
    { iso: "CN", name: "China", dial: "86" },
    { iso: "DE", name: "Germany", dial: "49" },
    { iso: "EG", name: "Egypt", dial: "20" },
    { iso: "ES", name: "Spain", dial: "34" },
    { iso: "FR", name: "France", dial: "33" },
    { iso: "ID", name: "Indonesia", dial: "62" },
    { iso: "IE", name: "Ireland", dial: "353" },
    { iso: "IL", name: "Israel", dial: "972" },
    { iso: "IT", name: "Italy", dial: "39" },
    { iso: "JP", name: "Japan", dial: "81" },
    { iso: "KE", name: "Kenya", dial: "254" },
    { iso: "KR", name: "South Korea", dial: "82" },
    { iso: "KW", name: "Kuwait", dial: "965" },
    { iso: "LK", name: "Sri Lanka", dial: "94" },
    { iso: "MX", name: "Mexico", dial: "52" },
    { iso: "MY", name: "Malaysia", dial: "60" },
    { iso: "NG", name: "Nigeria", dial: "234" },
    { iso: "NL", name: "Netherlands", dial: "31" },
    { iso: "NP", name: "Nepal", dial: "977" },
    { iso: "NZ", name: "New Zealand", dial: "64" },
    { iso: "OM", name: "Oman", dial: "968" },
    { iso: "PH", name: "Philippines", dial: "63" },
    { iso: "PK", name: "Pakistan", dial: "92" },
    { iso: "PL", name: "Poland", dial: "48" },
    { iso: "QA", name: "Qatar", dial: "974" },
    { iso: "RU", name: "Russia", dial: "7" },
    { iso: "SA", name: "Saudi Arabia", dial: "966" },
    { iso: "SE", name: "Sweden", dial: "46" },
    { iso: "SG", name: "Singapore", dial: "65" },
    { iso: "TH", name: "Thailand", dial: "66" },
    { iso: "TR", name: "Turkey", dial: "90" },
    { iso: "UA", name: "Ukraine", dial: "380" },
    { iso: "VN", name: "Vietnam", dial: "84" },
    { iso: "ZA", name: "South Africa", dial: "27" }
  ];

  var TIMEZONE_HINTS = {
    "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Karachi": "PK",
    "Asia/Dhaka": "BD", "Asia/Kathmandu": "NP", "Asia/Colombo": "LK",
    "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Singapore": "SG",
    "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE",
    "Europe/Paris": "FR", "Europe/Madrid": "ES", "Europe/Rome": "IT",
    "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
    "America/Los_Angeles": "US", "America/Toronto": "CA", "Australia/Sydney": "AU"
  };

  /**
   * Best guess at the visitor's country, so most people never touch the
   * dropdown. Locale region first (a UK visitor with a US browser locale
   * is rarer than the reverse), then timezone, then India as the default
   * for this deployment.
   */
  function detectCountry() {
    var saved = window.localStorage.getItem(COUNTRY_STORAGE_KEY);
    if (saved && findCountry(saved)) return saved;

    try {
      var locale = navigator.language || "";
      var parts = locale.split("-");
      var region = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
      if (findCountry(region)) return region;
    } catch (e) { /* fall through */ }

    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (TIMEZONE_HINTS[tz]) return TIMEZONE_HINTS[tz];
    } catch (e) { /* fall through */ }

    return "IN";
  }

  function findCountry(iso) {
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].iso === iso) return COUNTRIES[i];
    }
    return null;
  }

  // ---------- API calls ----------

  function apiUrl(path) {
    return API_BASE + "/api/v1/public/" + ORG_SLUG + path;
  }

  function identify() {
    var payload = {
      external_id: externalId,
      browser: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      current_page: window.location.href,
    };
    if (visitorDetails) {
      payload.full_name = visitorDetails.name;
      payload.phone = visitorDetails.phone;
    }
    return fetch(apiUrl("/customers/identify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(function () {
      // Identify is best-effort context, never worth blocking the chat over.
    });
  }

  function startConversation(message) {
    return fetch(apiUrl("/conversations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        external_id: externalId,
        initial_message: message,
        full_name: visitorDetails.name,
        phone: visitorDetails.phone,
      }),
    }).then(function (res) {
      if (!res.ok) throw new Error("start_failed_" + res.status);
      return res.json();
    });
  }

  function sendMessage(message) {
    return fetch(apiUrl("/conversations/" + conversationId + "/messages"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_id: externalId, content: message }),
    }).then(function (res) {
      if (!res.ok) throw new Error("send_failed_" + res.status);
      return res.json();
    });
  }

  function loadHistory() {
    if (!conversationId || historyLoaded) return Promise.resolve();
    return fetch(
      apiUrl("/conversations/" + conversationId + "?external_id=" + encodeURIComponent(externalId))
    )
      .then(function (res) {
        if (res.status === 403 || res.status === 404) {
          // The stored id no longer belongs to this visitor (cleared DB,
          // different org, closed and purged). Start clean rather than
          // leaving the widget pointed at a thread it can't use.
          clearConversationId();
          return null;
        }
        if (!res.ok) throw new Error("history_failed_" + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        historyLoaded = true;
        messageList.innerHTML = "";
        data.messages.forEach(function (m) {
          renderMessage(m.sender_type, m.content);
        });
        if (data.status === "closed") {
          renderNotice("This conversation was closed. Sending a message will start a new one.");
          clearConversationId();
        } else {
          connectSocket();
        }
      })
      .catch(function () {
        renderNotice("Couldn't load your earlier messages. You can still send a new one.");
      });
  }

  function connectSocket() {
    if (!conversationId) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    var wsBase = API_BASE.replace(/^http/, "ws");
    var url =
      wsBase +
      "/api/v1/public/" +
      ORG_SLUG +
      "/conversations/" +
      conversationId +
      "/ws?external_id=" +
      encodeURIComponent(externalId);

    socket = new WebSocket(url);

    socket.onopen = function () {
      reconnectAttempts = 0;
    };

    socket.onmessage = function (event) {
      var payload;
      try {
        payload = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (payload.type === "new_message" && payload.message.sender_type !== "customer") {
        renderMessage(payload.message.sender_type, payload.message.content);
      }
    };

    socket.onclose = function () {
      // Networks drop, laptops sleep, servers redeploy. Without this the
      // visitor's widget looked fine but silently stopped receiving agent
      // replies until they reloaded the page.
      if (!conversationId) return;
      var delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectAttempts += 1;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectSocket, delay);
    };
  }

  // ---------- UI ----------

  var panel, messageList, input, preChatForm, chatBody;

  function buildUI() {
    var bubble = document.createElement("button");
    bubble.id = "oasis-bubble";
    bubble.setAttribute("aria-label", "Open chat");
    bubble.textContent = "💬";
    bubble.style.cssText =
      "position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;" +
      "background:#0e7c66;color:#fff;border:none;font-size:23px;cursor:pointer;z-index:99999;" +
      "box-shadow:0 6px 20px rgba(11,43,39,0.28);transition:transform 140ms ease;";
    bubble.onmouseenter = function () { bubble.style.transform = "scale(1.06)"; };
    bubble.onmouseleave = function () { bubble.style.transform = "scale(1)"; };

    panel = document.createElement("div");
    panel.id = "oasis-panel";
    panel.style.cssText =
      "position:fixed;bottom:88px;right:20px;width:336px;height:440px;background:#fff;" +
      "border-radius:14px;box-shadow:0 12px 40px rgba(11,43,39,0.22);display:none;flex-direction:column;" +
      "z-index:99999;overflow:hidden;border:1px solid #dce5e2;" +
      "font-family:Inter,'Segoe UI',system-ui,sans-serif;font-size:14px;color:#10201e;";

    // ---- Pre-chat form: name + mobile number, both mandatory. Chat body
    // stays hidden until this is submitted (or was already submitted on a
    // previous visit, per visitorDetails loaded from localStorage). ----
    preChatForm = document.createElement("div");
    preChatForm.id = "oasis-prechat";
    preChatForm.style.cssText = "flex:1;display:flex;flex-direction:column;padding:16px;gap:10px;";

    var formTitle = document.createElement("div");
    formTitle.textContent = "Start a conversation";
    formTitle.style.cssText =
      "font-size:16px;font-weight:600;color:#10201e;letter-spacing:-0.01em;margin-bottom:2px;";

    var formLede = document.createElement("div");
    formLede.textContent = "Tell us who you are and we'll reply here.";
    formLede.style.cssText = "font-size:13px;color:#5d716d;margin-bottom:6px;";

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Your name";
    nameInput.required = true;
    nameInput.style.cssText =
      "border:1px solid #dce5e2;border-radius:6px;padding:10px;font-size:14px;font-family:inherit;color:#10201e;";

    // Country picker + number, side by side. The visitor's country is
    // guessed up front, so most people only type their local number —
    // exactly what they'd write on paper.
    var phoneRow = document.createElement("div");
    phoneRow.style.cssText = "display:flex;gap:6px;";

    var countrySelect = document.createElement("select");
    countrySelect.setAttribute("aria-label", "Country code");
    countrySelect.style.cssText =
      "border:1px solid #dce5e2;border-radius:6px;padding:10px 6px;font-size:14px;" +
      "font-family:inherit;color:#10201e;background:#fff;max-width:118px;flex-shrink:0;";

    var detectedIso = detectCountry();
    COUNTRIES.forEach(function (c) {
      var option = document.createElement("option");
      option.value = c.iso;
      // Name in the open list, dial code is what matters once collapsed.
      option.textContent = c.name + " +" + c.dial;
      if (c.iso === detectedIso) option.selected = true;
      countrySelect.appendChild(option);
    });

    var phoneInput = document.createElement("input");
    phoneInput.type = "tel";
    phoneInput.placeholder = "Mobile number";
    phoneInput.required = true;
    phoneInput.style.cssText =
      "flex:1;min-width:0;border:1px solid #dce5e2;border-radius:6px;padding:10px;" +
      "font-size:14px;font-family:inherit;color:#10201e;";

    phoneRow.appendChild(countrySelect);
    phoneRow.appendChild(phoneInput);

    function selectedDialCode() {
      var country = findCountry(countrySelect.value);
      return country ? country.dial : "";
    }

    var formError = document.createElement("div");
    formError.style.cssText = "color:#a32b2b;font-size:12.5px;min-height:15px;";

    var startBtn = document.createElement("button");
    startBtn.textContent = "Start chat";
    startBtn.style.cssText =
      "margin-top:4px;background:#0e7c66;color:#fff;border:none;border-radius:6px;padding:11px;" +
      "font-size:14.5px;font-family:inherit;cursor:pointer;";

    preChatForm.appendChild(formTitle);
    preChatForm.appendChild(formLede);
    preChatForm.appendChild(nameInput);
    preChatForm.appendChild(phoneRow);
    preChatForm.appendChild(formError);
    preChatForm.appendChild(startBtn);

    // Mirrors the server-side rule in backend/app/shared/phone.py. The
    // point of checking here is to tell the person what's wrong while
    // they're still looking at the field — the server check is what
    // actually protects the data.
    function phoneProblem(nationalNumber) {
      if (!nationalNumber) return "Enter your mobile number.";
      if (!/^[0-9()\-.\s]+$/.test(nationalNumber)) {
        return "A mobile number can only contain digits, spaces, and - ( ) .";
      }
      var digits = nationalNumber.replace(/\D/g, "");
      // Length is checked without the country code, since that part is
      // chosen from the list and can't be wrong.
      if (digits.length < 6) return "That number is too short.";
      if (digits.length > 13) return "That number is too long.";
      if (/^(\d)\1+$/.test(digits)) return "Enter a real mobile number.";
      return null;
    }

    function submitPreChatForm() {
      var name = nameInput.value.trim();
      var phone = phoneInput.value.trim();
      if (name.length < 2) {
        formError.textContent = "Enter your name.";
        nameInput.focus();
        return;
      }
      var problem = phoneProblem(phone);
      if (problem) {
        formError.textContent = problem;
        phoneInput.focus();
        return;
      }

      // Stored in full international form so an agent (or a CRM) can dial
      // it without guessing where the customer is.
      var fullPhone = "+" + selectedDialCode() + phone.replace(/\D/g, "");
      window.localStorage.setItem(COUNTRY_STORAGE_KEY, countrySelect.value);
      visitorDetails = { name: name, phone: fullPhone };
      saveDetails(visitorDetails);
      showChatBody();
      identify();
    }

    phoneInput.setAttribute("inputmode", "tel");
    phoneInput.setAttribute("maxlength", "20");
    phoneInput.addEventListener("input", function () {
      // Strip anything that could never belong in a phone number as it is
      // typed, so pasted junk is visibly rejected instead of silently sent.
      var cleaned = phoneInput.value.replace(/[^0-9()\-.\s]/g, "");
      if (cleaned !== phoneInput.value) {
        phoneInput.value = cleaned;
        formError.textContent = "Only digits are allowed in a mobile number.";
      } else if (formError.textContent) {
        formError.textContent = "";
      }
    });
    nameInput.addEventListener("input", function () {
      if (formError.textContent) formError.textContent = "";
    });

    startBtn.addEventListener("click", submitPreChatForm);
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") phoneInput.focus();
    });
    phoneInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submitPreChatForm();
    });
    countrySelect.addEventListener("change", function () {
      if (formError.textContent) formError.textContent = "";
      phoneInput.focus();
    });

    // ---- Chat body: message list + input, shown only after the form ----
    chatBody = document.createElement("div");
    chatBody.style.cssText = "flex:1;display:none;flex-direction:column;overflow:hidden;";

    messageList = document.createElement("div");
    messageList.id = "oasis-messages";
    messageList.style.cssText = "flex:1;overflow-y:auto;padding:14px;background:#f4f8f6;";

    var inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;border-top:1px solid #dce5e2;padding:10px;background:#fff;";

    input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type a message...";
    input.style.cssText =
      "flex:1;border:1px solid #dce5e2;border-radius:6px;padding:9px 11px;font-size:14px;font-family:inherit;color:#10201e;";

    var sendBtn = document.createElement("button");
    sendBtn.textContent = "Send";
    sendBtn.style.cssText =
      "margin-left:8px;background:#0e7c66;color:#fff;border:none;border-radius:6px;padding:9px 14px;" +
      "font-size:14px;font-family:inherit;cursor:pointer;";

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    chatBody.appendChild(messageList);
    chatBody.appendChild(inputRow);
    panel.appendChild(preChatForm);
    panel.appendChild(chatBody);

    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    function showChatBody() {
      preChatForm.style.display = "none";
      chatBody.style.display = "flex";
      input.focus();
      loadHistory();
    }

    // If we already know this visitor (returning visit), skip the form.
    if (visitorDetails) {
      preChatForm.style.display = "none";
      chatBody.style.display = "flex";
    }

    bubble.addEventListener("click", function () {
      var isOpen = panel.style.display === "flex";
      panel.style.display = isOpen ? "none" : "flex";
      if (!isOpen && visitorDetails) {
        identify();
        loadHistory();
        input.focus();
      }
    });

    function handleSend() {
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      var row = renderMessage("customer", text);
      setPending(row, true);

      var request = conversationId
        ? sendMessage(text).then(function () {
            return null;
          })
        : startConversation(text).then(function (data) {
            conversationId = data.id;
            historyLoaded = true;
            saveConversationId(conversationId);
            connectSocket();
            return null;
          });

      request
        .then(function () {
          setPending(row, false);
        })
        .catch(function () {
          // The message never left the browser — say so instead of showing
          // it as delivered and letting the visitor wait for a reply that
          // can never come.
          setFailed(row, text);
        });
    }

    sendBtn.addEventListener("click", handleSend);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") handleSend();
    });

    // If the visitor already had an open thread, restore it right away so
    // the unread agent replies are there when they open the bubble.
    if (visitorDetails && conversationId) {
      loadHistory();
    }
  }

  function renderMessage(senderType, content) {
    var row = document.createElement("div");
    row.className = "oasis-message oasis-message--" + senderType;
    row.textContent = content;
    row.style.cssText =
      "margin:6px 0;padding:9px 12px;border-radius:12px;max-width:80%;font-size:14px;" +
      "line-height:1.45;white-space:pre-wrap;word-break:break-word;" +
      (senderType === "customer"
        ? "background:#0e7c66;color:#fff;margin-left:auto;border-bottom-right-radius:3px;"
        : "background:#fff;color:#10201e;border:1px solid #dce5e2;border-bottom-left-radius:3px;");
    messageList.appendChild(row);
    messageList.scrollTop = messageList.scrollHeight;
    return row;
  }

  function renderNotice(text) {
    var row = document.createElement("div");
    row.textContent = text;
    row.style.cssText =
      "margin:6px 0;padding:6px 10px;font-size:12.5px;color:#5d716d;text-align:center;";
    messageList.appendChild(row);
    messageList.scrollTop = messageList.scrollHeight;
  }

  function setPending(row, pending) {
    row.style.opacity = pending ? "0.6" : "1";
  }

  function setFailed(row, text) {
    row.style.opacity = "1";
    row.style.background = "#a32b2b";
    row.style.border = "none";
    row.title = "Not delivered — tap to retry";
    row.style.cursor = "pointer";
    row.onclick = function () {
      row.remove();
      input.value = text;
      input.focus();
    };
    renderNotice("Message not sent. Check your connection and tap the red message to retry.");
  }

  buildUI();

  // Exposed for host pages that want programmatic control (rare, but the
  // architecture doc calls for the widget to be scriptable, not just clickable).
  window.OasisChatbot = {
    open: function () {
      panel.style.display = "flex";
      // Only identify() here if the pre-chat form is already satisfied —
      // otherwise the visitor lands on the form, same as clicking the bubble.
      if (visitorDetails) {
        identify();
        loadHistory();
      }
    },
    reset: function () {
      clearConversationId();
      window.localStorage.removeItem(DETAILS_STORAGE_KEY);
      window.localStorage.removeItem(COUNTRY_STORAGE_KEY);
      window.localStorage.removeItem(STORAGE_KEY);
    },
    externalId: externalId,
  };
})();
