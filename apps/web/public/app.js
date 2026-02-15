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
  prevStats: { open: 0, answered: 0, paid: 0, refunded: 0 },
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

// ── Toasts ──────────────────────────────────────────

function toast(title, body) {
  const root = $("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="toast-title"></div><div class="toast-body"></div>`;
  el.querySelector(".toast-title").textContent = title;
  el.querySelector(".toast-body").textContent = body || "";
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Helpers ─────────────────────────────────────────

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

// ── Modals ──────────────────────────────────────────

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

// ── Activity Drawer ─────────────────────────────────

function openDrawer() {
  $("activityDrawer").classList.add("open");
  $("drawerBackdrop").classList.add("visible");
}

function closeDrawer() {
  $("activityDrawer").classList.remove("open");
  $("drawerBackdrop").classList.remove("visible");
}

// ── Mobile Rail Toggle ──────────────────────────────

function toggleRail() {
  $("taskRail").classList.toggle("open");
}

// ── Status Pill Helper ──────────────────────────────

function statusPillClass(status) {
  if (status === "OPEN") return "open";
  if (status === "ANSWERED") return "answered";
  if (status === "CONFIRMED_PAID") return "paid";
  return "refunded";
}

function statusLabel(status) {
  if (status === "CONFIRMED_PAID") return "PAID";
  if (status === "REJECTED_REFUNDED") return "REFUNDED";
  if (status === "EXPIRED_REFUNDED") return "EXPIRED";
  return status;
}

// ── Render: Stats Ticker ────────────────────────────

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
    { label: "Open", value: open, sub: "Awaiting resolver", key: "open" },
    { label: "Answered", value: answered, sub: "Awaiting confirm", key: "answered" },
    { label: "Paid", value: paid, sub: fmtSol(totalLamports), key: "paid" },
    { label: "Refunded", value: refunded, sub: "Rejected / expired", key: "refunded" },
  ];

  const root = $("stats");
  root.innerHTML = "";
  for (const s of stats) {
    const el = document.createElement("div");
    el.className = "stat-cell";

    const numEl = document.createElement("div");
    numEl.className = "stat-number";
    numEl.textContent = String(s.value);

    // Flash if value changed
    if (State.prevStats[s.key] !== undefined && State.prevStats[s.key] !== s.value) {
      numEl.classList.add("flash");
      setTimeout(() => numEl.classList.remove("flash"), 600);
    }

    el.innerHTML = `<div class="stat-label"></div>`;
    el.querySelector(".stat-label").textContent = s.label;
    el.appendChild(numEl);
    const sub = document.createElement("div");
    sub.className = "stat-sub";
    sub.textContent = s.sub;
    el.appendChild(sub);
    root.appendChild(el);
  }

  State.prevStats = { open, answered, paid, refunded };
}

// ── Render: Task List ───────────────────────────────

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
    empty.className = "empty-state";
    empty.style.margin = "16px";
    empty.style.height = "200px";
    empty.innerHTML = `<div class="empty-state-icon">&#9744;</div>`;
    const msg = document.createElement("div");
    msg.textContent = State.filter === "open"
      ? "No open tasks yet. Run the agent to create one."
      : "No tasks for this filter.";
    empty.appendChild(msg);
    root.appendChild(empty);
    return;
  }

  // Keep selection stable
  if (!State.selectedTaskId || !tasks.some((t) => t.id === State.selectedTaskId)) {
    State.selectedTaskId = tasks[0].id;
  }

  for (const t of tasks) {
    const item = document.createElement("div");
    item.className = `task-item status-${t.status}`;
    if (t.id === State.selectedTaskId) item.classList.add("selected");

    const title = document.createElement("div");
    title.className = "task-item-title";
    title.textContent = t.question || "(no question)";

    const meta = document.createElement("div");
    meta.className = "task-item-meta";

    const bounty = document.createElement("span");
    bounty.className = "task-item-bounty";
    bounty.textContent = fmtSol(Number(t.bountyLamports || 0));

    const time = document.createElement("span");
    time.className = "task-item-time";
    time.textContent = fmtAgo(nowMs() - Number(t.createdAtMs || nowMs()));

    meta.appendChild(bounty);
    meta.appendChild(time);

    const bottom = document.createElement("div");
    bottom.className = "task-item-bottom";

    const pill = document.createElement("span");
    pill.className = `status-pill ${statusPillClass(t.status)}`;
    pill.textContent = statusLabel(t.status);

    const id = document.createElement("span");
    id.className = "task-item-id";
    id.textContent = short(t.id, 5);

    bottom.appendChild(pill);
    bottom.appendChild(id);

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(bottom);

    item.onclick = () => {
      State.selectedTaskId = t.id;
      renderTaskList();
      renderDetail();
      // Close rail on mobile after selecting
      if (window.innerWidth <= 1024) $("taskRail").classList.remove("open");
    };

    root.appendChild(item);
  }
}

// ── Render: Detail ──────────────────────────────────

function kvRow(label, valueNode) {
  const k = document.createElement("div");
  k.className = "kv-key";
  k.textContent = label;
  const v = document.createElement("div");
  v.className = "kv-value";
  v.appendChild(valueNode);
  const frag = document.createDocumentFragment();
  frag.appendChild(k);
  frag.appendChild(v);
  return frag;
}

function linkTx(sig) {
  const a = document.createElement("a");
  a.className = "kv-link";
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
    root.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="empty-state-icon">&#8594;</div><div>Select a task to view details</div>`;
    root.appendChild(empty);
    return;
  }

  root.innerHTML = "";

  // Header: question + bounty
  const header = document.createElement("div");
  header.className = "detail-header";

  const questionEl = document.createElement("div");
  questionEl.className = "detail-question";
  questionEl.textContent = task.question || "";

  const bountyTag = document.createElement("div");
  bountyTag.className = "bounty-tag";
  const bountyAmt = document.createElement("div");
  bountyAmt.className = "bounty-amount";
  bountyAmt.textContent = lamportsToSol(Number(task.bountyLamports || 0)).toFixed(3);
  const bountyUnit = document.createElement("div");
  bountyUnit.className = "bounty-unit";
  bountyUnit.textContent = "SOL";
  bountyTag.appendChild(bountyAmt);
  bountyTag.appendChild(bountyUnit);

  header.appendChild(questionEl);
  header.appendChild(bountyTag);
  root.appendChild(header);

  // Context
  if (task.context) {
    const ctx = document.createElement("div");
    ctx.className = "detail-context";
    ctx.textContent = task.context;
    root.appendChild(ctx);
  }

  // Status pill
  const pillWrap = document.createElement("div");
  pillWrap.style.marginBottom = "20px";
  const pill = document.createElement("span");
  pill.className = `status-pill ${statusPillClass(task.status)}`;
  pill.textContent = statusLabel(task.status);
  pillWrap.appendChild(pill);
  root.appendChild(pillWrap);

  // Images
  if ((task.imageUrls || []).length) {
    const imgs = document.createElement("div");
    imgs.className = "detail-images";
    (task.imageUrls || []).slice(0, 2).forEach((u, idx) => {
      const img = document.createElement("img");
      img.src = u;
      img.alt = `Landing page ${idx === 0 ? "A" : "B"}`;
      img.onclick = () => openModal(`Page ${idx === 0 ? "A" : "B"}`, u);
      imgs.appendChild(img);
    });
    root.appendChild(imgs);
  }

  // Answer zone for OPEN tasks
  if (task.status === "OPEN") {
    const zone = document.createElement("div");
    zone.className = "answer-zone";

    const label = document.createElement("div");
    label.className = "answer-label";
    label.textContent = "Your Answer";
    zone.appendChild(label);

    const ta = document.createElement("textarea");
    ta.id = "answerDraft";
    ta.className = "answer-textarea";
    ta.placeholder = "Answer briefly. Explain the tradeoff.";
    ta.value = State.draftsByTaskId[task.id] || "";
    ta.addEventListener("input", () => {
      State.draftsByTaskId[task.id] = ta.value || "";
    });
    zone.appendChild(ta);

    const actions = document.createElement("div");
    actions.className = "answer-actions";
    const btn = document.createElement("button");
    btn.className = "btn-submit";
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

    actions.appendChild(btn);
    zone.appendChild(actions);
    root.appendChild(zone);
  } else if (task.status === "ANSWERED") {
    const msg = document.createElement("div");
    msg.className = "waiting-msg";
    msg.textContent = "Waiting for agent to confirm and release payment...";
    root.appendChild(msg);
  }

  // Metadata
  const metaSection = document.createElement("div");
  metaSection.className = "detail-meta";

  const metaTitle = document.createElement("div");
  metaTitle.className = "meta-title";
  metaTitle.textContent = "Metadata";
  metaSection.appendChild(metaTitle);

  const grid = document.createElement("div");
  grid.className = "kv-grid";

  grid.appendChild(kvRow("Task ID", textNode(task.id)));
  grid.appendChild(kvRow("Agent", textNode(short(task.agentPubkey || "", 8))));
  grid.appendChild(kvRow("Resolver", textNode(task.resolverPubkey ? short(task.resolverPubkey, 8) : "(not set)")));
  grid.appendChild(kvRow("Lock tx", task.lockTxSig ? linkTx(task.lockTxSig) : textNode("(none)")));
  if (task.releaseTxSig) grid.appendChild(kvRow("Release tx", linkTx(task.releaseTxSig)));
  if (task.refundTxSig) grid.appendChild(kvRow("Refund tx", linkTx(task.refundTxSig)));

  metaSection.appendChild(grid);
  root.appendChild(metaSection);
}

// ── Render: Activity ────────────────────────────────

function renderActivity() {
  const root = $("activity");
  root.innerHTML = "";
  if (!State.activity.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.height = "120px";
    empty.textContent = "No activity yet.";
    root.appendChild(empty);
    return;
  }

  for (const e of State.activity) {
    const el = document.createElement("div");
    el.className = "event-item";

    const top = document.createElement("div");
    top.className = "event-top";

    const kind = document.createElement("span");
    kind.className = "event-kind";
    kind.textContent = e.kind.toUpperCase();

    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = fmtAgo(nowMs() - e.ts);

    top.appendChild(kind);
    top.appendChild(time);
    el.appendChild(top);

    const msg = document.createElement("div");
    msg.className = "event-msg";
    msg.textContent = e.msg;
    el.appendChild(msg);

    if (e.meta) {
      const meta = document.createElement("div");
      meta.className = "event-meta";
      meta.textContent = e.meta;
      el.appendChild(meta);
    }

    root.appendChild(el);
  }
}

// ── Connection ──────────────────────────────────────

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
    saveDraftFromDom();

    const data = await API.listTasks();
    const prevIds = new Set(State.tasks.map((t) => t.id));
    State.tasks = (data && data.tasks) || [];

    renderStats();
    renderTaskList();
    if (!isTypingAnswer()) renderDetail();

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

// ── Boot ────────────────────────────────────────────

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

  // Activity drawer
  $("activityBtn").onclick = openDrawer;
  $("activityClose").onclick = closeDrawer;
  $("drawerBackdrop").onclick = closeDrawer;

  // Mobile rail toggle
  $("railToggle").onclick = toggleRail;

  // Image modal
  $("modalClose").onclick = closeModal;
  $("modalBackdrop").onclick = closeModal;

  // Settings modal
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
