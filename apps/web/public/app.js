const $ = (id) => document.getElementById(id);

const CLUSTER = "devnet";
const EXPLORER_TX = (sig) =>
  `https://explorer.solana.com/tx/${encodeURIComponent(sig)}?cluster=${CLUSTER}`;

const API = {
  async health() {
    const res = await fetch("/api/health");
    return res.json();
  },
  async listTasks() {
    const res = await fetch("/api/tasks");
    return res.json();
  },
  async submitAnswer(taskId, body, demoToken) {
    const res = await fetch(`/api/tasks/${taskId}/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-token": demoToken || "",
      },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};

const State = {
  tasks: [],
  filter: "open",
  search: "",
  selectedTaskId: null,
  activity: [],
  wsConnected: false,
  draftsByTaskId: {},
};

function nowMs() {
  return Date.now();
}

function short(s, n = 6) {
  if (!s) return "";
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}...${s.slice(-n)}`;
}

function lamportsToSol(lamports) {
  if (!Number.isFinite(lamports)) return 0;
  return lamports / 1_000_000_000;
}

function fmtSol(lamports) {
  const sol = lamportsToSol(Number(lamports || 0));
  return `${sol.toFixed(sol >= 1 ? 2 : 3)} SOL`;
}

function fmtLamports(lamports) {
  if (!Number.isFinite(lamports)) return "N/A";
  return `${Number(lamports).toLocaleString()} lamports`;
}

function fmtAgo(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function getSettings() {
  return {
    resolverPubkey: (localStorage.getItem("resolverPubkey") || "").trim(),
    demoToken: (localStorage.getItem("demoToken") || "").trim(),
    soundEnabled: (localStorage.getItem("soundEnabled") || "1") === "1",
  };
}

function setSettings(next) {
  localStorage.setItem("resolverPubkey", (next.resolverPubkey || "").trim());
  localStorage.setItem("demoToken", (next.demoToken || "").trim());
  localStorage.setItem("soundEnabled", next.soundEnabled ? "1" : "0");
}

function toast(title, body) {
  const root = $("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="toastTitle"></div><div class="toastBody"></div>`;
  el.querySelector(".toastTitle").textContent = title;
  el.querySelector(".toastBody").textContent = body || "";
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function isTypingAnswer() {
  const el = document.activeElement;
  return el && el.id === "answerDraft";
}

function saveDraftFromDom() {
  const taskId = State.selectedTaskId;
  if (!taskId) return;
  const ta = document.getElementById("answerDraft");
  if (!ta) return;
  State.draftsByTaskId[taskId] = ta.value || "";
}

function pushActivity(kind, msg, meta) {
  State.activity.unshift({
    id: `${nowMs()}_${Math.random().toString(16).slice(2)}`,
    ts: nowMs(),
    kind,
    msg,
    meta: meta || "",
  });
  State.activity = State.activity.slice(0, 30);
  renderActivity();
}

function openModal(title, imgUrl) {
  $("modalTitle").textContent = title || "Preview";
  $("modalImg").src = imgUrl;
  $("modal").setAttribute("aria-hidden", "false");
}

function closeModal() {
  $("modal").setAttribute("aria-hidden", "true");
  $("modalImg").src = "";
}

function openSettings() {
  const s = getSettings();
  $("resolverPubkey").value = s.resolverPubkey;
  $("demoToken").value = s.demoToken;
  $("soundEnabled").checked = s.soundEnabled;
  $("settingsModal").setAttribute("aria-hidden", "false");
}

function closeSettings() {
  $("settingsModal").setAttribute("aria-hidden", "true");
}

function renderStats() {
  const tasks = State.tasks;
  const open = tasks.filter((t) => t.status === "OPEN").length;
  const answered = tasks.filter((t) => t.status === "ANSWERED").length;
  const paid = tasks.filter((t) => t.status === "CONFIRMED_PAID").length;
  const refunded = tasks.filter((t) => t.status === "REJECTED_REFUNDED" || t.status === "EXPIRED_REFUNDED").length;

  const totalLamports = tasks
    .filter((t) => t.status === "CONFIRMED_PAID")
    .reduce((acc, t) => acc + Number(t.bountyLamports || 0), 0);

  const stats = [
    { label: "Open", value: String(open), sub: "Awaiting resolver" },
    { label: "Answered", value: String(answered), sub: "Awaiting agent confirm" },
    { label: "Paid", value: String(paid), sub: fmtSol(totalLamports) },
    { label: "Refunded", value: String(refunded), sub: "Rejected/expired" },
  ];

  const root = $("stats");
  root.innerHTML = "";
  for (const s of stats) {
    const el = document.createElement("div");
    el.className = "stat";
    el.innerHTML = `<div class="statLabel"></div><div class="statValue"></div><div class="statSub"></div>`;
    el.querySelector(".statLabel").textContent = s.label;
    el.querySelector(".statValue").textContent = s.value;
    el.querySelector(".statSub").textContent = s.sub;
    root.appendChild(el);
  }
}

function filteredTasks() {
  const q = (State.search || "").toLowerCase().trim();
  const matchesQuery = (t) =>
    !q ||
    String(t.question || "").toLowerCase().includes(q) ||
    String(t.context || "").toLowerCase().includes(q);

  const byFilter = (t) => {
    if (State.filter === "all") return true;
    if (State.filter === "open") return t.status === "OPEN";
    if (State.filter === "answered") return t.status === "ANSWERED";
    if (State.filter === "paid") return t.status === "CONFIRMED_PAID";
    return true;
  };

  return State.tasks.filter((t) => byFilter(t) && matchesQuery(t));
}

function renderTaskList() {
  const root = $("taskList");
  const tasks = filteredTasks();
  root.innerHTML = "";

  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent =
      State.filter === "open"
        ? "No open tasks yet. Run the agent to create one."
        : "No tasks for this filter.";
    root.appendChild(empty);
    return;
  }

  // Keep selection stable if possible.
  if (!State.selectedTaskId || !tasks.some((t) => t.id === State.selectedTaskId)) {
    State.selectedTaskId = tasks[0].id;
  }

  for (const t of tasks) {
    const row = document.createElement("div");
    row.className = "taskRow";
    if (t.id === State.selectedTaskId) row.classList.add("selected");

    const createdAgo = fmtAgo(nowMs() - Number(t.createdAtMs || nowMs()));
    const top = document.createElement("div");
    top.className = "rowTop";
    top.innerHTML = `<div class="rowTitle"></div><div class="rowMeta"></div>`;
    top.querySelector(".rowTitle").textContent = t.question || "(no question)";
    top.querySelector(".rowMeta").textContent = `${fmtSol(Number(t.bountyLamports || 0))} · ${createdAgo}`;

    const bottom = document.createElement("div");
    bottom.style.display = "flex";
    bottom.style.justifyContent = "space-between";
    bottom.style.gap = "10px";
    bottom.style.alignItems = "center";

    const status = document.createElement("span");
    status.className = "pill";
    status.textContent = t.status;
    status.classList.add(t.status === "OPEN" ? "ok" : "bad");

    const id = document.createElement("span");
    id.className = "pill";
    id.textContent = short(t.id, 5);

    bottom.appendChild(status);
    bottom.appendChild(id);

    row.appendChild(top);
    row.appendChild(bottom);

    row.onclick = () => {
      State.selectedTaskId = t.id;
      renderTaskList();
      renderDetail();
    };

    root.appendChild(row);
  }
}

function kv(label, valueNode) {
  const el = document.createElement("div");
  el.className = "kv";
  const k = document.createElement("div");
  k.className = "k";
  k.textContent = label;
  const v = document.createElement("div");
  v.className = "v";
  v.appendChild(valueNode);
  el.appendChild(k);
  el.appendChild(v);
  return el;
}

function linkTx(sig) {
  const a = document.createElement("a");
  a.className = "link";
  a.href = EXPLORER_TX(sig);
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = short(sig, 8);
  return a;
}

function textNode(s) {
  const span = document.createElement("span");
  span.textContent = s || "";
  return span;
}

function renderDetail() {
  const root = $("detail");
  const task = State.tasks.find((t) => t.id === State.selectedTaskId);
  if (!task) {
    root.innerHTML = `<div class="emptyState">Select a task to view details.</div>`;
    return;
  }

  root.innerHTML = "";

  const header = document.createElement("div");
  header.className = "task";

  const th = document.createElement("div");
  th.className = "taskHeader";
  const left = document.createElement("div");
  left.innerHTML = `<div class="q"></div><div class="ctx"></div>`;
  left.querySelector(".q").textContent = task.question || "";
  left.querySelector(".ctx").textContent = task.context || "";

  const right = document.createElement("div");
  right.style.display = "grid";
  right.style.justifyItems = "end";
  right.style.gap = "8px";

  const bounty = document.createElement("div");
  bounty.className = "bounty";
  bounty.textContent = `${fmtSol(Number(task.bountyLamports || 0))}  (${fmtLamports(Number(task.bountyLamports || 0))})`;

  const status = document.createElement("span");
  status.className = "pill";
  status.classList.add(task.status === "OPEN" ? "ok" : "bad");
  status.textContent = task.status;

  right.appendChild(bounty);
  right.appendChild(status);

  th.appendChild(left);
  th.appendChild(right);

  header.appendChild(th);

  const imgs = document.createElement("div");
  imgs.className = "imgs";
  (task.imageUrls || []).slice(0, 2).forEach((u, idx) => {
    const img = document.createElement("img");
    img.src = u;
    img.alt = `context ${idx === 0 ? "A" : "B"}`;
    img.onclick = () => openModal(`Image ${idx === 0 ? "A" : "B"}`, u);
    imgs.appendChild(img);
  });
  if ((task.imageUrls || []).length) header.appendChild(imgs);

  // Answer box for OPEN tasks
  if (task.status === "OPEN") {
    const row = document.createElement("div");
    row.className = "answerRow";
    const ta = document.createElement("textarea");
    ta.id = "answerDraft";
    ta.placeholder = "Answer briefly. Explain the tradeoff.";
    ta.value = State.draftsByTaskId[task.id] || "";
    ta.addEventListener("input", () => {
      State.draftsByTaskId[task.id] = ta.value || "";
    });
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Submit Answer";

    btn.onclick = async () => {
      const settings = getSettings();
      if (!settings.resolverPubkey) return toast("Missing resolver pubkey", "Open Settings and set a pubkey.");
      const answerText = ta.value.trim();
      if (!answerText) return toast("Answer is empty", "Write 1-2 lines and submit.");

      btn.disabled = true;
      btn.textContent = "Submitting...";
      try {
        const resp = await API.submitAnswer(
          task.id,
          { resolverPubkey: settings.resolverPubkey, answerText },
          settings.demoToken
        );
        if (resp.error) {
          toast("Submit failed", String(resp.error));
          pushActivity("error", "Answer submit failed", String(resp.error));
        } else {
          // Clear draft on success so it doesn't linger if we switch back to this task.
          State.draftsByTaskId[task.id] = "";
          toast("Answer submitted", `Task ${short(task.id, 5)} is now ANSWERED`);
          pushActivity("answer", "Answer submitted", `task=${short(task.id, 5)}`);
        }
        await refresh();
      } finally {
        btn.disabled = false;
        btn.textContent = "Submit Answer";
      }
    };

    row.appendChild(ta);
    row.appendChild(btn);
    header.appendChild(row);
  } else if (task.status === "ANSWERED") {
    const note = document.createElement("div");
    note.className = "emptyState";
    note.textContent = "Answer submitted. Waiting for agent to confirm and release payment...";
    header.appendChild(note);
  }

  root.appendChild(header);

  // Key/value metadata
  const meta = document.createElement("div");
  meta.style.marginTop = "14px";
  meta.className = "task";

  meta.appendChild(kv("Task ID", textNode(task.id)));
  meta.appendChild(kv("Agent", textNode(short(task.agentPubkey || "", 8))));
  meta.appendChild(kv("Resolver", textNode(task.resolverPubkey ? short(task.resolverPubkey, 8) : "(not set)")));

  if (task.lockTxSig) meta.appendChild(kv("Lock tx", linkTx(task.lockTxSig)));
  else meta.appendChild(kv("Lock tx", textNode("(none)")));

  if (task.releaseTxSig) meta.appendChild(kv("Release tx", linkTx(task.releaseTxSig)));
  if (task.refundTxSig) meta.appendChild(kv("Refund tx", linkTx(task.refundTxSig)));

  root.appendChild(meta);
}

function renderActivity() {
  const root = $("activity");
  root.innerHTML = "";
  if (!State.activity.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "No activity yet. When the agent posts a task, events appear here.";
    root.appendChild(empty);
    return;
  }

  for (const e of State.activity) {
    const el = document.createElement("div");
    el.className = "event";
    const top = document.createElement("div");
    top.className = "eventTop";
    const l = document.createElement("div");
    l.textContent = e.kind.toUpperCase();
    const r = document.createElement("div");
    r.textContent = fmtAgo(nowMs() - e.ts);
    top.appendChild(l);
    top.appendChild(r);
    const msg = document.createElement("div");
    msg.className = "eventMsg";
    msg.textContent = e.msg + (e.meta ? ` (${e.meta})` : "");
    el.appendChild(top);
    el.appendChild(msg);
    root.appendChild(el);
  }
}

function setConn(ok, text) {
  $("statusText").textContent = text;
  const dot = $("connDot");
  dot.classList.remove("ok", "bad");
  dot.classList.add(ok ? "ok" : "bad");
}

function setActiveTab(filter) {
  State.filter = filter;
  for (const id of ["tabOpen", "tabAnswered", "tabPaid", "tabAll"]) {
    $(id).classList.remove("active");
  }
  const map = { open: "tabOpen", answered: "tabAnswered", paid: "tabPaid", all: "tabAll" };
  $(map[filter]).classList.add("active");
  renderTaskList();
  renderDetail();
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 680;
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 110);
  } catch {
    // ignore
  }
}

async function refresh() {
  try {
    // Preserve in-progress typing across polling/WS refreshes.
    saveDraftFromDom();

    const data = await API.listTasks();
    const prevIds = new Set(State.tasks.map((t) => t.id));
    State.tasks = (data && data.tasks) || [];

    renderStats();
    renderTaskList();
    // Avoid destroying the textarea while the user is typing.
    if (!isTypingAnswer()) renderDetail();

    // New task detection (for sound/toast)
    const newOnes = State.tasks.filter((t) => !prevIds.has(t.id));
    if (newOnes.length) {
      const s = getSettings();
      toast("New task posted", `${newOnes.length} new task(s)`);
      pushActivity("task", "New task posted", `count=${newOnes.length}`);
      if (s.soundEnabled) beep();
    }

    setConn(true, State.wsConnected ? "WS connected" : "Polling OK");
  } catch (e) {
    setConn(false, "Server unreachable");
  }
}

function connectWs() {
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    State.wsConnected = true;
    pushActivity("ws", "WebSocket connected");
    setConn(true, "WS connected");
  };
  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data || "{}");
      if (msg && msg.type) pushActivity("ws", msg.type, msg.taskId ? `task=${short(msg.taskId, 5)}` : "");
    } catch {
      // ignore
    }
    refresh();
  };
  ws.onclose = () => {
    State.wsConnected = false;
    pushActivity("ws", "WebSocket disconnected");
    setConn(true, "Polling OK");
    setTimeout(connectWs, 1200);
  };
}

function boot() {
  // Tabs
  for (const id of ["tabOpen", "tabAnswered", "tabPaid", "tabAll"]) {
    $(id).onclick = () => setActiveTab($(id).dataset.filter);
  }

  $("search").addEventListener("input", (e) => {
    State.search = e.target.value || "";
    renderTaskList();
    renderDetail();
  });

  $("refreshBtn").onclick = refresh;
  $("settingsBtn").onclick = openSettings;

  $("modalClose").onclick = closeModal;
  $("modalBackdrop").onclick = closeModal;

  $("settingsClose").onclick = closeSettings;
  $("settingsBackdrop").onclick = closeSettings;

  $("saveSettings").onclick = () => {
    setSettings({
      resolverPubkey: $("resolverPubkey").value,
      demoToken: $("demoToken").value,
      soundEnabled: $("soundEnabled").checked,
    });
    toast("Saved", "Settings stored locally.");
    closeSettings();
  };

  $("clearSettings").onclick = () => {
    setSettings({ resolverPubkey: "", demoToken: "", soundEnabled: true });
    toast("Cleared", "Settings cleared.");
    openSettings();
  };

  // Default state
  setActiveTab("open");
  connectWs();
  refresh();
  setInterval(refresh, 2000);
}

boot();
