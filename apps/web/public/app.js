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
  view: "tasks",
};

// ── Incremental rendering refs (avoid full DOM rebuilds) ─
const _statRefs = [];
const _taskElements = new Map();
let _detailFingerprint = "";

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
    { label: "Open", value: open + answered, sub: "Awaiting work", key: "open" },
    { label: "Claimed", value: claimed, sub: "In progress", key: "claimed" },
    { label: "Fulfilled", value: fulfilled, sub: "Awaiting score", key: "fulfilled" },
    { label: "Review", value: review, sub: "Needs verifier", key: "review" },
    { label: "Verified", value: verified, sub: fmtSol(totalLamports), key: "verified" },
    { label: "Disputed", value: disputed, sub: "Under dispute", key: "disputed" },
  ];

  const root = $("stats");

  // First render: build DOM skeleton
  if (_statRefs.length === 0) {
    root.innerHTML = "";
    for (const s of stats) {
      const el = document.createElement("div");
      el.className = "stat-cell";

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
    if (State.filter === "answered") return t.status === "ANSWERED";
    if (State.filter === "paid") return t.status === "CONFIRMED_PAID" || t.status === "VERIFIED_PAID";
    if (State.filter === "review") return t.status === "SCORED" || t.status === "UNDER_REVIEW";
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

  const timeEl = document.createElement("span");
  timeEl.className = "task-item-time";

  meta.appendChild(bountyEl);
  meta.appendChild(timeEl);

  const bottom = document.createElement("div");
  bottom.className = "task-item-bottom";

  const pillEl = document.createElement("span");
  pillEl.className = "status-pill";

  const idEl = document.createElement("span");
  idEl.className = "task-item-id";

  bottom.appendChild(pillEl);
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
    task.supervisorScore ?? "", task.supervisorReasoning || "",
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
  if (task.autoApproved) {
    const autoBadge = document.createElement("span");
    autoBadge.style.cssText = "display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:var(--status-paid)";
    autoBadge.textContent = "Auto-Approved";
    pillWrap.appendChild(autoBadge);
  }
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

  // Fulfillment card for tasks that have fulfillment data
  if (task.fulfillment) {
    const card = document.createElement("div");
    card.className = "fulfillment-card";
    const lbl = document.createElement("div");
    lbl.className = "label";
    lbl.textContent = "Fulfillment" + (task.fulfillment.subscriberPubkey ? " by " + short(task.fulfillment.subscriberPubkey, 6) : "");
    card.appendChild(lbl);
    const txt = document.createElement("div");
    txt.className = "text";
    txt.textContent = task.fulfillment.fulfillmentText || "";
    card.appendChild(txt);
    root.appendChild(card);
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
    const sv = Number(task.supervisorScore);
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

    if (task.supervisorReasoning) {
      const reason = document.createElement("div");
      reason.style.marginTop = "8px";
      reason.style.fontSize = "var(--text-sm)";
      reason.style.color = "var(--text-secondary)";
      reason.style.lineHeight = "1.5";
      reason.textContent = task.supervisorReasoning;
      container.appendChild(reason);
    }

    root.appendChild(container);
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
    const scoreLabelEl = document.createElement("label");
    scoreLabelEl.textContent = "Ground Truth Score";
    scoreGroup.appendChild(scoreLabelEl);

    const scoreDisplay = document.createElement("div");
    scoreDisplay.className = "score-display";
    scoreDisplay.textContent = "50";
    scoreGroup.appendChild(scoreDisplay);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.addEventListener("input", () => {
      scoreDisplay.textContent = slider.value;
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
    root.appendChild(form);
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
      // Toggle back to tasks
      showTasksView();
      return;
    }
    State.view = "agents";
    $("agentsBtn").classList.add("active");
    $("taskRail").style.display = "none";
    $("detail").style.display = "none";
    $("agentPool").style.display = "block";
    renderAgentPool();
    return;
  }

  // Task filter tabs
  State.filter = filter;
  const allTabs = ["tabOpen", "tabAnswered", "tabPaid", "tabAll", "tabReview"];
  for (const id of allTabs) {
    $(id).classList.remove("active");
  }
  const map = { open: "tabOpen", answered: "tabAnswered", paid: "tabPaid", all: "tabAll", review: "tabReview" };
  $(map[filter]).classList.add("active");
  showTasksView();
}

function showTasksView() {
  State.view = "tasks";
  $("agentsBtn").classList.remove("active");
  $("taskRail").style.display = "";
  $("detail").style.display = "";
  $("agentPool").style.display = "none";
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

    // Fetch agents and trust in parallel (non-blocking)
    Promise.all([
      API.listAgents().catch(() => null),
      API.getTrust().catch(() => null),
    ]).then(([agentsData, trustData]) => {
      if (agentsData && Array.isArray(agentsData.agents)) State.agents = agentsData.agents;
      else if (agentsData && Array.isArray(agentsData)) State.agents = agentsData;
      if (trustData && Array.isArray(trustData.scores)) State.trustScores = trustData.scores;
      else if (trustData && Array.isArray(trustData)) State.trustScores = trustData;
      if (State.view === "agents") renderAgentPool();
    });

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

// ── Boot ────────────────────────────────────────────

function boot() {
  // Tabs
  for (const id of ["tabOpen", "tabAnswered", "tabPaid", "tabAll", "tabReview"]) {
    $(id).onclick = () => setActiveTab($(id).dataset.filter);
  }

  $("search").addEventListener("input", (e) => {
    State.search = e.target.value || "";
    renderTaskList();
    renderDetail();
  });

  // Header buttons
  $("agentsBtn").onclick = () => setActiveTab("agents");
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
