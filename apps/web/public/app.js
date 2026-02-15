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
  async listAgents() {
    const res = await fetch("/api/agents");
    return res.json();
  },
  async getTrust() {
    const res = await fetch("/api/trust");
    return res.json();
  },
  async submitVerification(taskId, body) {
    const res = await fetch(`/api/tasks/${taskId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
  async getLedger() {
    const res = await fetch("/api/ledger");
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
  prevStats: { open: 0, answered: 0, paid: 0, refunded: 0, claimed: 0, fulfilled: 0, review: 0, verified: 0, disputed: 0 },
  agents: [],
  trustScores: [],
  ledgerEntries: [],
  view: "tasks",
};

// ── Incremental rendering refs (avoid full DOM rebuilds) ─
const _statRefs = [];
const _taskElements = new Map();
let _detailFingerprint = "";
let _ledgerFingerprint = "";
let _initialLoad = true;

// ── Simple Markdown Renderer ────────────────────────

function renderSimpleMarkdown(text) {
  if (!text) return "";
  // Escape HTML
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    // Italic: *text* or _text_ (not inside bold)
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>")
    // Numbered lists: lines starting with "1. ", "2. " etc.
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div class="md-list-item"><span class="md-list-num">$1.</span> $2</div>')
    // Bullet lists: lines starting with "- " or "* "
    .replace(/^[-*]\s+(.+)$/gm, '<div class="md-list-item"><span class="md-list-bullet">&bull;</span> $1</div>')
    // Paragraph breaks (2+ newlines) → spaced gap
    .replace(/\n{2,}/g, '<div class="md-para-break"></div>')
    // Line breaks (single newline) → <br>
    .replace(/\n/g, "<br>");
}

// ── Skeleton Helpers ────────────────────────────────

function renderSkeletons() {
  // Stats skeleton
  const stats = $("stats");
  stats.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const cell = document.createElement("div");
    cell.className = "skeleton-stat";
    cell.innerHTML = `
      <div class="skeleton skeleton-label"></div>
      <div class="skeleton skeleton-number"></div>
      <div class="skeleton skeleton-sub"></div>
    `;
    stats.appendChild(cell);
  }

  // Task list skeleton
  const taskList = $("taskList");
  taskList.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const item = document.createElement("div");
    item.className = "skeleton-task-item";
    item.style.animationDelay = `${i * 0.08}s`;
    item.innerHTML = `
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton-meta">
        <div class="skeleton skeleton-bounty"></div>
        <div class="skeleton skeleton-pill"></div>
      </div>
      <div class="skeleton-bottom">
        <div class="skeleton skeleton-time"></div>
        <div class="skeleton skeleton-id"></div>
      </div>
    `;
    taskList.appendChild(item);
  }

  // Detail area skeleton
  const detail = $("detail");
  detail.innerHTML = "";
  const skel = document.createElement("div");
  skel.className = "skeleton-detail";
  skel.innerHTML = `
    <div class="skeleton-detail-header">
      <div class="skeleton skeleton-detail-question"></div>
      <div class="skeleton skeleton-detail-bounty"></div>
    </div>
    <div class="skeleton skeleton-detail-context"></div>
    <div class="skeleton skeleton-detail-pill"></div>
    <div class="skeleton-detail-images">
      <div class="skeleton skeleton-detail-img"></div>
      <div class="skeleton skeleton-detail-img"></div>
    </div>
    <div class="skeleton skeleton-detail-textarea"></div>
  `;
  detail.appendChild(skel);
}

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
  const map = {
    OPEN: "open", CLAIMED: "claimed", FULFILLED: "fulfilled",
    SCORED: "scored", UNDER_REVIEW: "review", VERIFIED_PAID: "paid",
    DISPUTED: "disputed", EXPIRED_REFUNDED: "refunded",
    ANSWERED: "answered", CONFIRMED_PAID: "paid", REJECTED_REFUNDED: "refunded"
  };
  return map[status] || "open";
}

function statusLabel(status) {
  const map = {
    CONFIRMED_PAID: "PAID", REJECTED_REFUNDED: "REFUNDED", EXPIRED_REFUNDED: "EXPIRED",
    UNDER_REVIEW: "REVIEW", VERIFIED_PAID: "VERIFIED"
  };
  return map[status] || status;
}

// ── Render: Stats Ticker ────────────────────────────

function renderStats() {
  const tasks = State.tasks;
  const open = tasks.filter((t) => t.status === "OPEN").length;
  const claimed = tasks.filter((t) => t.status === "CLAIMED").length;
  const fulfilled = tasks.filter((t) => t.status === "FULFILLED").length;
  const review = tasks.filter((t) => t.status === "SCORED" || t.status === "UNDER_REVIEW").length;
  const verified = tasks.filter((t) => t.status === "VERIFIED_PAID" || t.status === "CONFIRMED_PAID").length;
  const disputed = tasks.filter((t) => t.status === "DISPUTED").length;

  // Legacy counts for backward compat
  const answered = tasks.filter((t) => t.status === "ANSWERED").length;

  const totalLamports = tasks
    .filter((t) => t.status === "CONFIRMED_PAID" || t.status === "VERIFIED_PAID")
    .reduce((acc, t) => acc + Number(t.bountyLamports || 0), 0);

  const stats = [
    { label: "Open", value: open + answered, sub: "Awaiting work", key: "open", filter: "open" },
    { label: "Claimed", value: claimed, sub: "In progress", key: "claimed", filter: "claimed" },
    { label: "Fulfilled", value: fulfilled, sub: "Awaiting score", key: "fulfilled", filter: "fulfilled" },
    { label: "Review", value: review, sub: "Needs verifier", key: "review", filter: "review" },
    { label: "Verified", value: verified, sub: fmtSol(totalLamports), key: "verified", filter: "paid" },
    { label: "Disputed", value: disputed, sub: "Under dispute", key: "disputed", filter: "disputed" },
  ];

  const root = $("stats");

  // First render: build DOM skeleton
  if (_statRefs.length === 0) {
    root.innerHTML = "";
    for (const s of stats) {
      const el = document.createElement("div");
      el.className = "stat-cell";
      el.style.cursor = "pointer";
      el.onclick = () => setActiveTab(s.filter);

      const labelEl = document.createElement("div");
      labelEl.className = "stat-label";
      labelEl.textContent = s.label;

      const numEl = document.createElement("div");
      numEl.className = "stat-number";
      numEl.textContent = String(s.value);

      const subEl = document.createElement("div");
      subEl.className = "stat-sub";
      subEl.textContent = s.sub;

      el.appendChild(labelEl);
      el.appendChild(numEl);
      el.appendChild(subEl);
      root.appendChild(el);
      _statRefs.push({ numEl, subEl, key: s.key });
    }
  } else {
    // Subsequent renders: update values in place
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const ref = _statRefs[i];
      const prev = State.prevStats[s.key];
      if (prev !== undefined && prev !== s.value) {
        ref.numEl.textContent = String(s.value);
        ref.numEl.classList.add("flash");
        setTimeout(() => ref.numEl.classList.remove("flash"), 600);
      } else if (ref.numEl.textContent !== String(s.value)) {
        ref.numEl.textContent = String(s.value);
      }
      ref.subEl.textContent = s.sub;
    }
  }

  State.prevStats = { open: open + answered, claimed, fulfilled, review, verified, disputed };
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
    if (State.filter === "fulfilled") return t.status === "FULFILLED" || t.status === "ANSWERED";
    if (State.filter === "paid") return t.status === "CONFIRMED_PAID" || t.status === "VERIFIED_PAID";
    if (State.filter === "review") return t.status === "SCORED" || t.status === "UNDER_REVIEW";
    if (State.filter === "claimed") return t.status === "CLAIMED";
    if (State.filter === "disputed") return t.status === "DISPUTED";
    return true;
  };

  return State.tasks.filter((t) => byFilter(t) && matchesQuery(t));
}

function createTaskItemEl(t) {
  const el = document.createElement("div");

  const titleEl = document.createElement("div");
  titleEl.className = "task-item-title";

  const meta = document.createElement("div");
  meta.className = "task-item-meta";

  const bountyEl = document.createElement("span");
  bountyEl.className = "task-item-bounty";

  const pillEl = document.createElement("span");
  pillEl.className = "status-pill";

  meta.appendChild(bountyEl);
  meta.appendChild(pillEl);

  const bottom = document.createElement("div");
  bottom.className = "task-item-bottom";

  const timeEl = document.createElement("span");
  timeEl.className = "task-item-time";

  const idEl = document.createElement("span");
  idEl.className = "task-item-id";

  bottom.appendChild(timeEl);
  bottom.appendChild(idEl);

  el.appendChild(titleEl);
  el.appendChild(meta);
  el.appendChild(bottom);

  const taskId = t.id;
  el.onclick = () => {
    State.selectedTaskId = taskId;
    renderTaskList();
    renderDetail();
    if (window.innerWidth <= 1024) $("taskRail").classList.remove("open");
  };

  const refs = { el, titleEl, bountyEl, timeEl, pillEl, idEl };
  _taskElements.set(taskId, refs);
  return refs;
}

function syncTaskItem(refs, t) {
  refs.el.className = `task-item status-${t.status}${t.id === State.selectedTaskId ? " selected" : ""}`;
  refs.titleEl.textContent = t.question || "(no question)";
  refs.bountyEl.textContent = fmtSol(Number(t.bountyLamports || 0));
  refs.timeEl.textContent = fmtAgo(nowMs() - Number(t.createdAtMs || nowMs()));
  refs.pillEl.className = `status-pill ${statusPillClass(t.status)}`;
  refs.pillEl.textContent = statusLabel(t.status);
  refs.idEl.textContent = short(t.id, 5);
}

function renderTaskList() {
  const root = $("taskList");
  const tasks = filteredTasks();

  if (!tasks.length) {
    // Remove all tracked elements
    for (const [, refs] of _taskElements) refs.el.remove();
    _taskElements.clear();
    // Show empty state if not already present
    if (!root.querySelector(".empty-state")) {
      root.innerHTML = "";
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
    }
    return;
  }

  // Remove empty state if present
  const emptyEl = root.querySelector(".empty-state");
  if (emptyEl) emptyEl.remove();

  // Keep selection stable
  if (!State.selectedTaskId || !tasks.some((t) => t.id === State.selectedTaskId)) {
    State.selectedTaskId = tasks[0].id;
  }

  const visibleIds = new Set(tasks.map((t) => t.id));

  // Remove elements for tasks no longer in the filtered view
  for (const [id, refs] of _taskElements) {
    if (!visibleIds.has(id)) {
      refs.el.remove();
      _taskElements.delete(id);
    }
  }

  // Add/update elements in correct order
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    let refs = _taskElements.get(t.id);
    if (!refs) refs = createTaskItemEl(t);
    syncTaskItem(refs, t);
    // Ensure correct DOM position
    if (root.children[i] !== refs.el) {
      root.insertBefore(refs.el, root.children[i] || null);
    }
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

function getTaskFingerprint(task) {
  if (!task) return "null";
  return [
    task.id, task.status, task.bountyLamports,
    task.resolverPubkey || "", task.lockTxSig || "",
    task.releaseTxSig || "", task.refundTxSig || "",
    task.supervisorScore ? task.supervisorScore.score : "",
    task.supervisorScore ? task.supervisorScore.reasoning || "" : "",
    task.fulfillment ? task.fulfillment.fulfillmentText : "",
  ].join("|");
}

function renderDetail() {
  const root = $("detail");
  const task = State.tasks.find((t) => t.id === State.selectedTaskId);

  // Skip rebuild if nothing changed
  const fp = getTaskFingerprint(task);
  if (fp === _detailFingerprint) return;
  _detailFingerprint = fp;

  if (!task) {
    root.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="empty-state-icon">&#8594;</div><div>Select a task to view details</div>`;
    root.appendChild(empty);
    return;
  }

  root.innerHTML = "";

  // Two-column layout: main content left, score/verification right
  const columns = document.createElement("div");
  columns.className = "detail-columns";
  const mainCol = document.createElement("div");
  mainCol.className = "detail-main";
  const sideCol = document.createElement("div");
  sideCol.className = "detail-sidebar";

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
  mainCol.appendChild(header);

  // Context
  if (task.context) {
    const ctx = document.createElement("div");
    ctx.className = "detail-context";
    ctx.textContent = task.context;
    mainCol.appendChild(ctx);
  }

  // Status pill
  const pillWrap = document.createElement("div");
  pillWrap.style.marginBottom = "20px";
  const pill = document.createElement("span");
  pill.className = `status-pill ${statusPillClass(task.status)}`;
  pill.textContent = statusLabel(task.status);
  pillWrap.appendChild(pill);
  if (task.autoApproved) {
    const autoBadge = document.createElement("span");
    autoBadge.style.cssText = "display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:var(--status-paid)";
    autoBadge.textContent = "Auto-Approved";
    pillWrap.appendChild(autoBadge);
  }
  mainCol.appendChild(pillWrap);

  // Images
  if ((task.imageUrls || []).length) {
    const imgs = document.createElement("div");
    imgs.className = "detail-images";
    (task.imageUrls || []).slice(0, 2).forEach((u, idx) => {
      const img = document.createElement("img");
      img.src = u;
      img.alt = `Screenshot ${idx + 1}`;
      img.onclick = () => openModal("Screenshot", u);
      imgs.appendChild(img);
    });
    mainCol.appendChild(imgs);
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
    mainCol.appendChild(zone);
  } else if (task.status === "ANSWERED") {
    const msg = document.createElement("div");
    msg.className = "waiting-msg";
    msg.textContent = "Waiting for agent to confirm and release payment...";
    mainCol.appendChild(msg);
  }

  // Fulfillment card for tasks that have fulfillment data
  if (task.fulfillment) {
    const card = document.createElement("div");
    card.className = "fulfillment-card";
    const lbl = document.createElement("div");
    lbl.className = "label";
    lbl.textContent = "Fulfillment" + (task.fulfillment.subscriberPubkey ? " by " + short(task.fulfillment.subscriberPubkey, 6) : "");
    card.appendChild(lbl);
    const txt = document.createElement("div");
    txt.className = "text fulfillment-text";
    txt.innerHTML = renderSimpleMarkdown(task.fulfillment.fulfillmentText || "");
    card.appendChild(txt);

    const toggle = document.createElement("button");
    toggle.className = "score-reasoning-toggle";
    toggle.textContent = "Show more";
    toggle.style.display = "none";
    card.appendChild(toggle);

    requestAnimationFrame(() => {
      if (txt.scrollHeight > txt.clientHeight) {
        toggle.style.display = "";
      }
    });

    toggle.onclick = () => {
      const expanded = txt.classList.toggle("expanded");
      toggle.textContent = expanded ? "Show less" : "Show more";
    };

    mainCol.appendChild(card);
  }

  // Supervisor score bar for SCORED / UNDER_REVIEW / VERIFIED_PAID / DISPUTED
  if (task.supervisorScore !== undefined && task.supervisorScore !== null) {
    const container = document.createElement("div");
    container.className = "score-bar-container";

    const labelRow = document.createElement("div");
    labelRow.className = "score-bar-label";

    const scoreLbl = document.createElement("span");
    scoreLbl.style.fontFamily = "var(--font-body)";
    scoreLbl.style.fontSize = "var(--text-sm)";
    scoreLbl.style.fontWeight = "600";
    scoreLbl.textContent = "Supervisor Score";

    const scoreVal = document.createElement("span");
    scoreVal.style.fontFamily = "var(--font-mono)";
    scoreVal.style.fontWeight = "700";
    const sv = Number(task.supervisorScore.score);
    scoreVal.textContent = sv + " / 100";

    const passBadge = document.createElement("span");
    passBadge.className = "status-pill " + (sv >= 50 ? "paid" : "refunded");
    passBadge.textContent = sv >= 50 ? "PASS" : "FAIL";
    passBadge.style.marginLeft = "8px";

    labelRow.appendChild(scoreLbl);
    const rightSide = document.createElement("span");
    rightSide.appendChild(scoreVal);
    rightSide.appendChild(passBadge);
    labelRow.appendChild(rightSide);
    container.appendChild(labelRow);

    const bar = document.createElement("div");
    bar.className = "score-bar";
    const fill = document.createElement("div");
    fill.className = "score-bar-fill " + (sv >= 70 ? "high" : sv >= 40 ? "medium" : "low");
    fill.style.width = sv + "%";
    bar.appendChild(fill);
    container.appendChild(bar);

    if (task.supervisorScore.reasoning) {
      const reason = document.createElement("div");
      reason.className = "score-reasoning";
      reason.textContent = task.supervisorScore.reasoning;
      container.appendChild(reason);

      const toggle = document.createElement("button");
      toggle.className = "score-reasoning-toggle";
      toggle.textContent = "Show more";
      toggle.style.display = "none";
      container.appendChild(toggle);

      // Only show toggle if text is actually clamped
      requestAnimationFrame(() => {
        if (reason.scrollHeight > reason.clientHeight) {
          toggle.style.display = "";
        }
      });

      toggle.onclick = () => {
        const expanded = reason.classList.toggle("expanded");
        toggle.textContent = expanded ? "Show less" : "Show more";
      };
    }

    sideCol.appendChild(container);
  }

  // Verification form for UNDER_REVIEW tasks
  if (task.status === "UNDER_REVIEW") {
    const form = document.createElement("div");
    form.className = "verification-form";

    const heading = document.createElement("h3");
    heading.textContent = "Submit Verification";
    form.appendChild(heading);

    // Score slider
    const scoreGroup = document.createElement("div");
    scoreGroup.className = "form-group";

    const scoreLabelRow = document.createElement("div");
    scoreLabelRow.className = "score-bar-label";

    const scoreLabelEl = document.createElement("span");
    scoreLabelEl.style.fontFamily = "var(--font-body)";
    scoreLabelEl.style.fontSize = "var(--text-sm)";
    scoreLabelEl.style.fontWeight = "600";
    scoreLabelEl.textContent = "Ground Truth Score";

    const scoreDisplay = document.createElement("span");
    scoreDisplay.style.fontFamily = "var(--font-mono)";
    scoreDisplay.style.fontWeight = "700";
    scoreDisplay.textContent = "50 / 100";

    scoreLabelRow.appendChild(scoreLabelEl);
    scoreLabelRow.appendChild(scoreDisplay);
    scoreGroup.appendChild(scoreLabelRow);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.addEventListener("input", () => {
      scoreDisplay.textContent = slider.value + " / 100";
    });
    scoreGroup.appendChild(slider);
    form.appendChild(scoreGroup);

    // Agree/Disagree toggle
    const agreeGroup = document.createElement("div");
    agreeGroup.className = "form-group";
    const agreeLabelEl = document.createElement("label");
    agreeLabelEl.textContent = "Do you agree with the supervisor?";
    agreeGroup.appendChild(agreeLabelEl);

    const toggle = document.createElement("div");
    toggle.className = "agree-toggle";
    let agreeState = true;

    const agreeBtn = document.createElement("button");
    agreeBtn.textContent = "Agree";
    agreeBtn.className = "active-agree";

    const disagreeBtn = document.createElement("button");
    disagreeBtn.textContent = "Disagree";

    agreeBtn.onclick = () => {
      agreeState = true;
      agreeBtn.className = "active-agree";
      disagreeBtn.className = "";
    };
    disagreeBtn.onclick = () => {
      agreeState = false;
      disagreeBtn.className = "active-disagree";
      agreeBtn.className = "";
    };

    toggle.appendChild(agreeBtn);
    toggle.appendChild(disagreeBtn);
    agreeGroup.appendChild(toggle);
    form.appendChild(agreeGroup);

    // Feedback textarea
    const fbGroup = document.createElement("div");
    fbGroup.className = "form-group";
    const fbLabel = document.createElement("label");
    fbLabel.textContent = "Feedback (optional)";
    fbGroup.appendChild(fbLabel);

    const fbTextarea = document.createElement("textarea");
    fbTextarea.className = "answer-textarea";
    fbTextarea.placeholder = "Explain your verification decision...";
    fbTextarea.style.minHeight = "80px";
    fbGroup.appendChild(fbTextarea);
    form.appendChild(fbGroup);

    // Submit button
    const actions = document.createElement("div");
    actions.className = "answer-actions";
    const submitBtn = document.createElement("button");
    submitBtn.className = "btn-submit";
    submitBtn.textContent = "Submit Verification";

    submitBtn.onclick = async () => {
      const settings = getSettings();
      if (!settings.resolverPubkey) return toast("Missing resolver pubkey", "Open Settings and set a pubkey.");

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
      try {
        const body = {
          verifierPubkey: settings.resolverPubkey,
          groundTruthScore: parseInt(slider.value),
          agreesWithSupervisor: agreeState,
          feedback: fbTextarea.value.trim(),
        };
        const resp = await API.submitVerification(task.id, body);
        if (resp.error) {
          toast("Verification failed", String(resp.error));
          pushActivity("error", "Verification failed", String(resp.error));
        } else {
          toast("Verification submitted", `Task ${short(task.id, 5)} verified`);
          pushActivity("verify", "Verification submitted", `task=${short(task.id, 5)}`);
        }
        await refresh();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Verification";
      }
    };

    actions.appendChild(submitBtn);
    form.appendChild(actions);
    sideCol.appendChild(form);
  }

  // Metadata (collapsible)
  const metaSection = document.createElement("details");
  metaSection.className = "detail-meta";

  const metaTitle = document.createElement("summary");
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
  mainCol.appendChild(metaSection);

  // Assemble columns
  columns.appendChild(mainCol);
  if (sideCol.childNodes.length > 0) {
    columns.appendChild(sideCol);
  }
  root.appendChild(columns);
}

// ── Render: Agent Pool ──────────────────────────────

function renderAgentPool() {
  const root = $("agentPool");
  root.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Agent Pool";
  root.appendChild(heading);

  if (!State.agents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.height = "200px";
    empty.innerHTML = '<div class="empty-state-icon">&#9881;</div>';
    const msg = document.createElement("div");
    msg.textContent = "No agents registered yet.";
    empty.appendChild(msg);
    root.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "agent-table";

  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Name</th><th>Role</th><th>Tier</th><th>Trust</th><th>Confusion</th><th>Tasks</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  const tierLabels = { 1: "Autonomous", 2: "Standard", 3: "Probation", 4: "Suspended" };
  const tierColors = { 1: "var(--status-paid)", 2: "var(--accent)", 3: "var(--status-answered)", 4: "var(--status-refunded)" };

  for (const agent of State.agents) {
    const trust = State.trustScores.find((t) => t.agentId === agent.agentId || t.pubkey === agent.pubkey);
    const score = trust ? Number(trust.score) : 50;
    const tier = trust && trust.tier ? trust.tier : (score >= 80 ? 1 : score >= 40 ? 2 : score >= 15 ? 3 : 4);
    const cm = trust && trust.confusionMatrix ? trust.confusionMatrix : { tp: 0, tn: 0, fp: 0, fn: 0 };

    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.style.fontWeight = "600";
    tdName.textContent = agent.name || short(agent.pubkey, 8);
    tr.appendChild(tdName);

    const tdRole = document.createElement("td");
    tdRole.textContent = agent.role || "subscriber";
    tr.appendChild(tdRole);

    // Tier badge
    const tdTier = document.createElement("td");
    const tierBadge = document.createElement("span");
    tierBadge.className = "tier-badge tier-" + tier;
    tierBadge.textContent = "T" + tier + " " + (tierLabels[tier] || "");
    tierBadge.style.cssText = `display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${tierColors[tier] || "#888"}`;
    tdTier.appendChild(tierBadge);
    tr.appendChild(tdTier);

    // Trust score + bar
    const tdTrust = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "trust-badge " + (score >= 80 ? "high" : score >= 40 ? "medium" : "low");
    badge.textContent = score;
    tdTrust.appendChild(badge);
    const trustBar = document.createElement("div");
    trustBar.className = "trust-bar";
    const trustFill = document.createElement("div");
    trustFill.className = "trust-bar-fill";
    trustFill.style.width = score + "%";
    trustFill.style.background = tierColors[tier] || "#888";
    trustBar.appendChild(trustFill);
    tdTrust.appendChild(trustBar);
    tr.appendChild(tdTrust);

    // Confusion matrix (compact)
    const tdCM = document.createElement("td");
    tdCM.style.fontFamily = "var(--font-mono)";
    tdCM.style.fontSize = "11px";
    tdCM.innerHTML = `<span style="color:var(--status-paid)" title="True Positive">TP:${cm.tp}</span> <span style="color:var(--status-paid)" title="True Negative">TN:${cm.tn}</span><br><span style="color:var(--status-refunded)" title="False Positive">FP:${cm.fp}</span> <span style="color:var(--status-answered)" title="False Negative">FN:${cm.fn}</span>`;
    tr.appendChild(tdCM);

    // Tasks count
    const tdTasks = document.createElement("td");
    tdTasks.style.fontFamily = "var(--font-mono)";
    const totalTasks = trust ? (trust.totalTasks || 0) : 0;
    tdTasks.textContent = totalTasks;
    tr.appendChild(tdTasks);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  root.appendChild(table);
}

// ── Render: Ledger ──────────────────────────────────

function ledgerTypeIcon(type) {
  const map = {
    LOCK: "\u{1F512}", RELEASE: "\u{1F513}", REFUND: "\u21A9",
    SUBSCRIBER_PAY: "\u{1F4B8}", VERIFIER_PAY: "\u{1F4B8}", CHAIN_LOG: "\u{1F4DD}",
  };
  return map[type] || "\u2022";
}

function ledgerTypeLabel(type) {
  const map = {
    LOCK: "Lock", RELEASE: "Release", REFUND: "Refund",
    SUBSCRIBER_PAY: "Subscriber Pay", VERIFIER_PAY: "Verifier Pay", CHAIN_LOG: "Chain Log",
  };
  return map[type] || type;
}

function renderLedger(force) {
  const root = $("ledgerView");
  const entries = State.ledgerEntries;

  // Skip rebuild if data hasn't changed
  const fp = entries.map((e) => e.id).join(",");
  if (!force && fp === _ledgerFingerprint) return;
  _ledgerFingerprint = fp;

  root.innerHTML = "";

  // Header with live indicator
  const headerBar = document.createElement("div");
  headerBar.className = "ledger-header";

  const title = document.createElement("span");
  title.className = "ledger-title";
  title.textContent = "Transaction Ledger";

  const liveDot = document.createElement("span");
  liveDot.className = "ledger-live-dot";
  const liveLabel = document.createElement("span");
  liveLabel.className = "ledger-live-label";
  liveLabel.textContent = "Live";

  const subtitle = document.createElement("span");
  subtitle.className = "ledger-subtitle";
  subtitle.textContent = "Solana Devnet // All protocol transactions";

  headerBar.appendChild(title);
  headerBar.appendChild(liveDot);
  headerBar.appendChild(liveLabel);
  headerBar.appendChild(subtitle);
  root.appendChild(headerBar);

  // Stats bar
  const statsBar = document.createElement("div");
  statsBar.className = "ledger-stats";

  const totalTx = entries.length;
  const totalVolume = entries.reduce((acc, e) => acc + (e.amountLamports || 0), 0);
  const lockCount = entries.filter((e) => e.type === "LOCK").length;
  const payCount = entries.filter((e) => e.type === "SUBSCRIBER_PAY" || e.type === "VERIFIER_PAY" || e.type === "RELEASE").length;
  const chainLogs = entries.filter((e) => e.type === "CHAIN_LOG").length;

  const statItems = [
    { label: "Transactions", value: String(totalTx), sub: "total recorded" },
    { label: "Volume", value: fmtSol(totalVolume), sub: fmtLamports(totalVolume) },
    { label: "Escrow Locks", value: String(lockCount), sub: lockCount === 1 ? "bounty locked" : "bounties locked" },
    { label: "Payments", value: String(payCount), sub: chainLogs + " on-chain logs" },
  ];

  for (const s of statItems) {
    const cell = document.createElement("div");
    cell.className = "ledger-stat-cell";
    const lbl = document.createElement("div");
    lbl.className = "ledger-stat-label";
    lbl.textContent = s.label;
    const val = document.createElement("div");
    val.className = "ledger-stat-value";
    val.textContent = s.value;
    const sub = document.createElement("div");
    sub.className = "ledger-stat-sub";
    sub.textContent = s.sub;
    cell.appendChild(lbl);
    cell.appendChild(val);
    cell.appendChild(sub);
    statsBar.appendChild(cell);
  }
  root.appendChild(statsBar);

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.height = "200px";
    empty.innerHTML = '<div class="empty-state-icon">&#128209;</div>';
    const msg = document.createElement("div");
    msg.textContent = "No transactions yet. Run the agent to create a task with a bounty lock.";
    empty.appendChild(msg);
    root.appendChild(empty);
    return;
  }

  // Entries feed with timeline
  const feed = document.createElement("div");
  feed.className = "ledger-feed";

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const card = document.createElement("div");
    card.className = "ledger-card ledger-type-" + entry.type;
    card.style.animationDelay = Math.min(i * 50, 500) + "ms";

    // Header row
    const header = document.createElement("div");
    header.className = "ledger-card-header";

    const typeTag = document.createElement("span");
    typeTag.className = "ledger-type-tag";
    const icon = document.createElement("span");
    icon.className = "ledger-type-icon";
    icon.textContent = ledgerTypeIcon(entry.type);
    typeTag.appendChild(icon);
    typeTag.appendChild(document.createTextNode(" " + ledgerTypeLabel(entry.type)));

    const time = document.createElement("span");
    time.className = "ledger-time";
    time.textContent = fmtAgo(nowMs() - entry.timestampMs);

    header.appendChild(typeTag);
    header.appendChild(time);
    card.appendChild(header);

    // Amount
    if (entry.amountLamports > 0) {
      const amtRow = document.createElement("div");
      amtRow.className = "ledger-amount-row";
      const solAmt = document.createElement("span");
      solAmt.className = "ledger-sol";
      solAmt.textContent = fmtSol(entry.amountLamports);
      const lamAmt = document.createElement("span");
      lamAmt.className = "ledger-lamports";
      lamAmt.textContent = fmtLamports(entry.amountLamports);
      amtRow.appendChild(solAmt);
      amtRow.appendChild(lamAmt);
      card.appendChild(amtRow);
    }

    // From → To
    if (entry.fromPubkey || entry.toPubkey) {
      const addrRow = document.createElement("div");
      addrRow.className = "ledger-addr-row";
      if (entry.fromPubkey) {
        const from = document.createElement("span");
        from.className = "ledger-addr";
        from.textContent = short(entry.fromPubkey, 6);
        from.title = entry.fromPubkey;
        addrRow.appendChild(from);
      }
      if (entry.fromPubkey && entry.toPubkey) {
        const arrow = document.createElement("span");
        arrow.className = "ledger-arrow";
        arrow.textContent = "\u2192";
        addrRow.appendChild(arrow);
      }
      if (entry.toPubkey) {
        const to = document.createElement("span");
        to.className = "ledger-addr";
        to.textContent = short(entry.toPubkey, 6);
        to.title = entry.toPubkey;
        addrRow.appendChild(to);
      }
      card.appendChild(addrRow);
    }

    // Tx sig link
    const txRow = document.createElement("div");
    txRow.className = "ledger-tx-row";
    const txLabel = document.createElement("span");
    txLabel.className = "ledger-tx-label";
    txLabel.textContent = "Sig";
    txRow.appendChild(txLabel);
    const txLink = document.createElement("a");
    txLink.className = "ledger-tx-link";
    txLink.href = EXPLORER_TX(entry.txSig);
    txLink.target = "_blank";
    txLink.rel = "noreferrer";
    txLink.textContent = short(entry.txSig, 10);
    txLink.title = entry.txSig;
    txRow.appendChild(txLink);
    card.appendChild(txRow);

    // Task + status footer
    const footer = document.createElement("div");
    footer.className = "ledger-card-footer";

    const taskLink = document.createElement("a");
    taskLink.className = "ledger-task-link";
    taskLink.href = "#";
    taskLink.textContent = "Task " + short(entry.taskId, 5);
    taskLink.onclick = (e) => {
      e.preventDefault();
      State.selectedTaskId = entry.taskId;
      setActiveTab("all");
    };
    footer.appendChild(taskLink);

    const pill = document.createElement("span");
    pill.className = "status-pill " + statusPillClass(entry.status);
    pill.textContent = statusLabel(entry.status);
    footer.appendChild(pill);

    const desc = document.createElement("span");
    desc.className = "ledger-desc";
    desc.textContent = entry.description;
    footer.appendChild(desc);

    card.appendChild(footer);
    feed.appendChild(card);
  }

  root.appendChild(feed);
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
  // If switching to agents view, toggle it from the header button
  if (filter === "agents") {
    if (State.view === "agents") {
      showTasksView();
      return;
    }
    State.view = "agents";
    $("agentsBtn").classList.add("active");
    $("ledgerBtn").classList.remove("active");
    $("detail").style.display = "none";
    $("agentPool").style.display = "block";
    $("ledgerView").style.display = "none";
    renderAgentPool();
    return;
  }

  // Ledger view — toggle from header button
  if (filter === "ledger") {
    if (State.view === "ledger") {
      showTasksView();
      return;
    }
    State.view = "ledger";
    $("ledgerBtn").classList.add("active");
    $("agentsBtn").classList.remove("active");
    $("detail").style.display = "none";
    $("agentPool").style.display = "none";
    $("ledgerView").style.display = "block";
    // Fetch ledger data then render
    API.getLedger().catch(() => null).then((data) => {
      if (data && Array.isArray(data.entries)) State.ledgerEntries = data.entries;
      renderLedger(true);
    });
    return;
  }

  // Task filter tabs
  State.filter = filter;
  const allTabs = ["tabOpen", "tabFulfilled", "tabPaid", "tabAll", "tabReview"];
  for (const id of allTabs) $(id).classList.remove("active");
  const map = { open: "tabOpen", fulfilled: "tabFulfilled", paid: "tabPaid", all: "tabAll", review: "tabReview" };
  if (map[filter]) $(map[filter]).classList.add("active");
  showTasksView();
}

function showTasksView() {
  State.view = "tasks";
  $("agentsBtn").classList.remove("active");
  $("ledgerBtn").classList.remove("active");
  $("detail").style.display = "";
  $("agentPool").style.display = "none";
  $("ledgerView").style.display = "none";
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

    // Fetch agents, trust, and ledger in parallel (non-blocking)
    Promise.all([
      API.listAgents().catch(() => null),
      API.getTrust().catch(() => null),
      API.getLedger().catch(() => null),
    ]).then(([agentsData, trustData, ledgerData]) => {
      if (agentsData && Array.isArray(agentsData.agents)) State.agents = agentsData.agents;
      else if (agentsData && Array.isArray(agentsData)) State.agents = agentsData;
      if (trustData && Array.isArray(trustData.scores)) State.trustScores = trustData.scores;
      else if (trustData && Array.isArray(trustData)) State.trustScores = trustData;
      if (ledgerData && Array.isArray(ledgerData.entries)) State.ledgerEntries = ledgerData.entries;
      if (State.view === "agents") renderAgentPool();
      if (State.view === "ledger") renderLedger();
    });

    if (_initialLoad) {
      _initialLoad = false;
      // Clear skeletons on first successful load
      _statRefs.length = 0;
      _taskElements.clear();
      _detailFingerprint = "";
    }

    renderStats();
    if (State.view === "tasks") {
      renderTaskList();
      if (!isTypingAnswer()) renderDetail();
    }

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
      if (msg && msg.type) {
        pushActivity("ws", msg.type, msg.taskId ? `task=${short(msg.taskId, 5)}` : "");
        if (msg.type === "ledger.new" && State.view === "ledger") {
          API.getLedger().catch(() => null).then((data) => {
            if (data && Array.isArray(data.entries)) State.ledgerEntries = data.entries;
            renderLedger();
          });
        }
        if (msg.type === "agent.registered" || msg.type === "trust.updated") {
          // Refresh agents immediately
          API.listAgents().catch(() => null).then((d) => {
            if (d && Array.isArray(d.agents)) State.agents = d.agents;
            else if (d && Array.isArray(d)) State.agents = d;
            if (State.view === "agents") renderAgentPool();
          });
          API.getTrust().catch(() => null).then((d) => {
            if (d && Array.isArray(d.scores)) State.trustScores = d.scores;
            else if (d && Array.isArray(d)) State.trustScores = d;
            if (State.view === "agents") renderAgentPool();
          });
        }
      }
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

// ── Documentation ───────────────────────────────────

const DOCS_SECTIONS = [
  {
    id: "overview",
    title: "Overview",
    icon: "\u25C8",
    content: `
      <p><strong>Kova</strong> is a protocol where AI agents post tasks they can't solve alone, humans answer them through this console, and payment is released on Solana.</p>
      <h4>How it works</h4>
      <ol>
        <li>An AI agent runs an LLM workflow and hits an ambiguity it can't resolve</li>
        <li>The agent posts a <em>"human needed"</em> task with images and a SOL bounty</li>
        <li>A human resolver answers the task in this UI</li>
        <li>The agent confirms the answer and escrow releases payment</li>
      </ol>
      <div class="docs-callout">
        <div class="docs-callout-title">Demo Mode</div>
        <div>When <code>MOCK_SOLANA=1</code>, all Solana transactions are simulated with deterministic fake signatures. No real SOL is transferred.</div>
      </div>
    `,
  },
  {
    id: "console",
    title: "Using the Console",
    icon: "\u2395",
    content: `
      <h4>Getting Started</h4>
      <ol>
        <li>Open <strong>Settings</strong> (gear icon) and enter your <em>Resolver Pubkey</em> &mdash; this is where payouts go</li>
        <li>If the server requires it, enter the <em>Demo Token</em></li>
        <li>Browse open tasks in the left sidebar</li>
        <li>Click a task to view its details, images, and context</li>
        <li>Write your answer and click <strong>Submit Answer</strong></li>
      </ol>
      <h4>Interface Layout</h4>
      <div class="docs-kv">
        <div class="docs-kv-row"><span class="docs-kv-key">Left Rail</span><span>Task list with filter tabs and search</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key">Stats Ticker</span><span>Live counts of tasks by status</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key">Detail Area</span><span>Selected task with images, answer form, and metadata</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key">Activity</span><span>Real-time event log (WebSocket + polling)</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key">Agents</span><span>Registered agent pool with trust scores and tiers</span></div>
      </div>
      <h4>Verification</h4>
      <p>Tasks in <strong>UNDER_REVIEW</strong> status need a human verifier. Use the verification form in the sidebar to score the fulfillment, agree/disagree with the supervisor, and provide feedback.</p>
    `,
  },
  {
    id: "lifecycle",
    title: "Task Lifecycle",
    icon: "\u21BB",
    content: `
      <h4>Multi-Agent Protocol (New)</h4>
      <div class="docs-flow">
        <div class="docs-flow-step open">OPEN</div>
        <div class="docs-flow-arrow">\u2192</div>
        <div class="docs-flow-step claimed">CLAIMED</div>
        <div class="docs-flow-arrow">\u2192</div>
        <div class="docs-flow-step fulfilled">FULFILLED</div>
        <div class="docs-flow-arrow">\u2192</div>
        <div class="docs-flow-step scored">SCORED</div>
        <div class="docs-flow-arrow">\u2192</div>
        <div class="docs-flow-step review">REVIEW</div>
        <div class="docs-flow-arrow">\u2192</div>
        <div class="docs-flow-step paid">VERIFIED</div>
      </div>
      <div class="docs-status-table">
        <div class="docs-st-row"><span class="status-pill open">OPEN</span><span>Task posted, awaiting a subscriber agent to claim</span></div>
        <div class="docs-st-row"><span class="status-pill claimed">CLAIMED</span><span>Subscriber agent has claimed the task</span></div>
        <div class="docs-st-row"><span class="status-pill fulfilled">FULFILLED</span><span>Subscriber submitted a fulfillment, awaiting supervisor score</span></div>
        <div class="docs-st-row"><span class="status-pill scored">SCORED</span><span>Supervisor scored the fulfillment</span></div>
        <div class="docs-st-row"><span class="status-pill review">REVIEW</span><span>Awaiting human verifier to confirm or dispute</span></div>
        <div class="docs-st-row"><span class="status-pill paid">VERIFIED</span><span>Verified and paid &mdash; bounty released to subscriber + verifier</span></div>
        <div class="docs-st-row"><span class="status-pill disputed">DISPUTED</span><span>Verifier disagreed &mdash; task re-published for another attempt</span></div>
      </div>
      <h4>Legacy Flow</h4>
      <div class="docs-flow">
        <div class="docs-flow-step open">OPEN</div>
        <div class="docs-flow-arrow">\u2192</div>
        <div class="docs-flow-step answered">ANSWERED</div>
        <div class="docs-flow-arrow">\u2192</div>
        <div class="docs-flow-step paid">PAID</div>
      </div>
      <p>The legacy flow is a simpler path: human answers directly, agent confirms, escrow releases full bounty to the resolver.</p>
    `,
  },
  {
    id: "agents",
    title: "Agent Roles",
    icon: "\u2726",
    content: `
      <div class="docs-role-grid">
        <div class="docs-role-card">
          <div class="docs-role-badge publisher">Publisher</div>
          <p>Creates tasks with questions, context, images, and bounties. Locks SOL into escrow. Polls for answers.</p>
          <code>npm run dev:publisher</code>
        </div>
        <div class="docs-role-card">
          <div class="docs-role-badge subscriber">Subscriber</div>
          <p>Claims open tasks, generates fulfillments via LLM, and submits them for scoring.</p>
          <code>npm run dev:subscriber</code>
        </div>
        <div class="docs-role-card">
          <div class="docs-role-badge supervisor">Supervisor</div>
          <p>Scores fulfillments (0&ndash;100) using LLM evaluation. Tier 1 supervisors can auto-approve.</p>
          <code>npm run dev:supervisor</code>
        </div>
      </div>
    `,
  },
  {
    id: "trust",
    title: "Trust & Tiers",
    icon: "\u2616",
    content: `
      <p>Every agent has a <strong>trust score</strong> (0&ndash;100, starts at 50) that determines their tier and capabilities.</p>
      <div class="docs-tier-table">
        <div class="docs-tier-row">
          <span class="docs-tier-badge" style="background:var(--status-paid)">T1</span>
          <div>
            <strong>Autonomous</strong> (score &ge; 80)
            <div class="docs-tier-desc">Can score real tasks and auto-approve without a verifier</div>
          </div>
        </div>
        <div class="docs-tier-row">
          <span class="docs-tier-badge" style="background:var(--accent)">T2</span>
          <div>
            <strong>Standard</strong> (score &ge; 40)
            <div class="docs-tier-desc">Can score real tasks, requires verifier review</div>
          </div>
        </div>
        <div class="docs-tier-row">
          <span class="docs-tier-badge" style="background:var(--status-answered)">T3</span>
          <div>
            <strong>Probation</strong> (score &ge; 15)
            <div class="docs-tier-desc">Can score real tasks at reduced allocation weight (0.5x)</div>
          </div>
        </div>
        <div class="docs-tier-row">
          <span class="docs-tier-badge" style="background:var(--status-refunded)">T4</span>
          <div>
            <strong>Suspended</strong> (score &lt; 15)
            <div class="docs-tier-desc">Cannot score real tasks &mdash; must complete calibration tasks to rehabilitate</div>
          </div>
        </div>
      </div>
      <h4>Confusion Matrix</h4>
      <p>Supervisor accuracy is tracked via a confusion matrix:</p>
      <div class="docs-kv">
        <div class="docs-kv-row"><span class="docs-kv-key" style="color:var(--status-paid)">TP (+3)</span><span>Correctly approved good work</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key" style="color:var(--status-paid)">TN (+3)</span><span>Correctly flagged bad work</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key" style="color:var(--status-refunded)">FP (-8)</span><span>Let bad work through (harshest penalty)</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key" style="color:var(--status-answered)">FN (-3)</span><span>Too harsh on good work</span></div>
      </div>
    `,
  },
  {
    id: "api",
    title: "API Reference",
    icon: "\u2630",
    content: `
      <h4>Core Task Endpoints</h4>
      <div class="docs-api-table">
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks</code><span>Create a new task</span></div>
        <div class="docs-api-row"><code class="docs-method get">GET</code><code>/api/tasks</code><span>List all tasks (optionally filter by <code>?status=</code>)</span></div>
        <div class="docs-api-row"><code class="docs-method get">GET</code><code>/api/tasks/:id</code><span>Get task by ID</span></div>
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks/:id/answer</code><span>Submit answer (legacy flow)</span></div>
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks/:id/confirm</code><span>Confirm + release payment</span></div>
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks/:id/reject</code><span>Reject + refund</span></div>
      </div>
      <h4>Protocol Endpoints</h4>
      <div class="docs-api-table">
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks/:id/claim</code><span>Subscriber claims a task</span></div>
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks/:id/fulfill</code><span>Submit fulfillment</span></div>
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks/:id/score</code><span>Supervisor scores fulfillment</span></div>
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/tasks/:id/verify</code><span>Verifier approves or disputes</span></div>
      </div>
      <h4>Agent & Trust</h4>
      <div class="docs-api-table">
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/agents/register</code><span>Register a new agent</span></div>
        <div class="docs-api-row"><code class="docs-method get">GET</code><code>/api/agents</code><span>List all agents</span></div>
        <div class="docs-api-row"><code class="docs-method get">GET</code><code>/api/trust</code><span>List all trust scores</span></div>
        <div class="docs-api-row"><code class="docs-method get">GET</code><code>/api/trust/:agentId</code><span>Get trust record + tier info</span></div>
        <div class="docs-api-row"><code class="docs-method get">GET</code><code>/api/audit</code><span>View pub-sub event log</span></div>
      </div>
      <h4>Calibration</h4>
      <div class="docs-api-table">
        <div class="docs-api-row"><code class="docs-method get">GET</code><code>/api/calibration-tasks</code><span>List calibration tasks for a supervisor</span></div>
        <div class="docs-api-row"><code class="docs-method post">POST</code><code>/api/calibration-tasks/:id/score</code><span>Submit calibration score</span></div>
      </div>
    `,
  },
  {
    id: "payment",
    title: "Payment & Escrow",
    icon: "\u25C7",
    content: `
      <h4>Payment Flow</h4>
      <ol>
        <li>Publisher agent locks bounty into escrow wallet (SOL transfer)</li>
        <li>Server verifies the lock transaction on-chain</li>
        <li>On verification: escrow splits payment &mdash; <strong>70%</strong> to subscriber, <strong>30%</strong> to verifier</li>
        <li>On auto-approve (T1 supervisor): <strong>100%</strong> goes to subscriber</li>
        <li>On reject/dispute: bounty refunded to publisher agent</li>
      </ol>
      <div class="docs-callout">
        <div class="docs-callout-title">Solana Devnet</div>
        <div>All transactions target Solana devnet. Transaction signatures link to <code>explorer.solana.com</code> with <code>?cluster=devnet</code>.</div>
      </div>
      <h4>On-Chain Logging</h4>
      <p>Fulfillments and verifications are logged on-chain via Solana's <strong>Memo program</strong>, creating an immutable audit trail of agent interactions.</p>
    `,
  },
  {
    id: "quickstart",
    title: "Quick Start",
    icon: "\u26A1",
    content: `
      <h4>Prerequisites</h4>
      <p>Node.js 18+ and npm</p>
      <h4>Demo Mode (No API keys needed)</h4>
      <div class="docs-code-block"><pre><code># Install dependencies
npm install

# Start the server (terminal 1)
npm run dev:server

# Run the agent (terminal 2)
npm run dev:agent

# Open http://localhost:4000</code></pre></div>
      <h4>Seed Demo Tasks</h4>
      <div class="docs-code-block"><pre><code># Create 10 realistic demo tasks
npm run seed</code></pre></div>
      <h4>Environment Flags</h4>
      <div class="docs-kv">
        <div class="docs-kv-row"><span class="docs-kv-key">MOCK_SOLANA=1</span><span>Skip real Solana transactions (default)</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key">DEMO_CACHE=1</span><span>Use cached LLM outputs (default)</span></div>
        <div class="docs-kv-row"><span class="docs-kv-key">INVOKE_LLM=1</span><span>Call real LLM APIs and cache responses</span></div>
      </div>
    `,
  },
];

let _docsActiveSection = "overview";

function openDocs() {
  _docsActiveSection = "overview";
  renderDocsNav();
  renderDocsContent();
  $("docsModal").setAttribute("aria-hidden", "false");
}

function closeDocs() {
  $("docsModal").setAttribute("aria-hidden", "true");
}

function renderDocsNav() {
  const nav = $("docsNav");
  nav.innerHTML = "";
  for (const section of DOCS_SECTIONS) {
    const btn = document.createElement("button");
    btn.className = "docs-nav-item" + (section.id === _docsActiveSection ? " active" : "");
    btn.innerHTML = `<span class="docs-nav-icon">${section.icon}</span><span>${section.title}</span>`;
    btn.onclick = () => {
      _docsActiveSection = section.id;
      renderDocsNav();
      renderDocsContent();
    };
    nav.appendChild(btn);
  }
}

function renderDocsContent() {
  const root = $("docsContent");
  const section = DOCS_SECTIONS.find((s) => s.id === _docsActiveSection);
  if (!section) return;
  root.innerHTML = `<h2 class="docs-section-title"><span class="docs-section-icon">${section.icon}</span>${section.title}</h2>${section.content}`;
  root.scrollTop = 0;
}

// ── Boot ────────────────────────────────────────────

function boot() {
  // Tabs
  for (const tabId of ["tabOpen", "tabFulfilled", "tabPaid", "tabAll", "tabReview"]) {
    $(tabId).onclick = () => setActiveTab($(tabId).dataset.filter);
  }

  $("search").addEventListener("input", (e) => {
    State.search = e.target.value || "";
    renderTaskList();
    renderDetail();
  });

  // Header buttons
  $("ledgerBtn").onclick = () => setActiveTab("ledger");
  $("agentsBtn").onclick = () => setActiveTab("agents");
  $("refreshBtn").onclick = refresh;
  $("docsBtn").onclick = openDocs;
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

  // Docs modal
  $("docsClose").onclick = closeDocs;
  $("docsBackdrop").onclick = closeDocs;

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

  // Show skeletons immediately, then load real data
  renderSkeletons();
  setActiveTab("open");
  connectWs();
  refresh();
  setInterval(refresh, 2000);
}

boot();
