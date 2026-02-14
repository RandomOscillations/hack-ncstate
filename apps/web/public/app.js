const $ = (id) => document.getElementById(id);

const API = {
  async listTasks() {
    const res = await fetch("/api/tasks");
    return res.json();
  },
  async submitAnswer(taskId, body, demoToken) {
    const res = await fetch(`/api/tasks/${taskId}/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-token": demoToken || ""
      },
      body: JSON.stringify(body)
    });
    return res.json();
  }
};

function formatLamports(lamports) {
  if (!Number.isFinite(lamports)) return "N/A";
  // For the demo UI, show lamports directly to avoid SOL conversion disputes.
  return `${lamports.toLocaleString()} lamports`;
}

function loadSettings() {
  $("resolverPubkey").value = localStorage.getItem("resolverPubkey") || "";
  $("demoToken").value = localStorage.getItem("demoToken") || "";
}

function saveSettings() {
  localStorage.setItem("resolverPubkey", $("resolverPubkey").value.trim());
  localStorage.setItem("demoToken", $("demoToken").value.trim());
}

function taskCard(task) {
  const el = document.createElement("div");
  el.className = "task";

  const statusPill = document.createElement("span");
  statusPill.className = "pill";
  statusPill.textContent = task.status;
  if (task.status === "OPEN") statusPill.classList.add("ok");
  if (task.status !== "OPEN") statusPill.classList.add("bad");

  const header = document.createElement("div");
  header.className = "taskHeader";
  header.innerHTML = `
    <div>
      <div class="q"></div>
      <div class="ctx"></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <span class="bounty">${formatLamports(task.bountyLamports)}</span>
    </div>
  `;
  header.querySelector(".q").textContent = task.question || "";
  header.querySelector(".ctx").textContent = task.context || "";
  header.lastElementChild.prepend(statusPill);

  const imgs = document.createElement("div");
  imgs.className = "imgs";
  (task.imageUrls || []).slice(0, 2).forEach((u) => {
    const img = document.createElement("img");
    img.src = u;
    img.alt = "task context";
    imgs.appendChild(img);
  });

  const answerRow = document.createElement("div");
  answerRow.className = "answerRow";
  const ta = document.createElement("textarea");
  ta.placeholder = "Answer briefly...";
  const btn = document.createElement("button");
  btn.textContent = "Submit";

  btn.onclick = async () => {
    const resolverPubkey = (localStorage.getItem("resolverPubkey") || "").trim();
    const demoToken = (localStorage.getItem("demoToken") || "").trim();
    const answerText = ta.value.trim();

    if (!resolverPubkey) return alert("Set Resolver Pubkey first.");
    if (!answerText) return alert("Answer is empty.");

    btn.disabled = true;
    btn.textContent = "Submitting...";
    try {
      const resp = await API.submitAnswer(
        task.id,
        { resolverPubkey, answerText },
        demoToken
      );
      if (resp.error) alert(`Error: ${resp.error}`);
      await refresh();
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit";
    }
  };

  answerRow.appendChild(ta);
  answerRow.appendChild(btn);

  el.appendChild(header);
  if ((task.imageUrls || []).length) el.appendChild(imgs);
  if (task.status === "OPEN") el.appendChild(answerRow);

  if (task.status === "CONFIRMED_PAID" && task.releaseTxSig) {
    const paid = document.createElement("div");
    paid.className = "pill ok";
    paid.textContent = `PAID: ${task.releaseTxSig}`;
    el.appendChild(paid);
  }

  return el;
}

async function refresh() {
  $("statusText").textContent = "Refreshing...";
  try {
    const data = await API.listTasks();
    const tasks = (data && data.tasks) || [];
    const container = $("tasks");
    container.innerHTML = "";
    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "pill";
      empty.textContent = "No tasks yet. Run the agent to create one.";
      container.appendChild(empty);
    } else {
      tasks.forEach((t) => container.appendChild(taskCard(t)));
    }
    $("statusText").textContent = `OK (${tasks.length} tasks)`;
  } catch (e) {
    $("statusText").textContent = "Error";
  }
}

function connectWs() {
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => $("statusText").textContent = "WS connected";
  ws.onmessage = () => refresh();
  ws.onclose = () => {
    $("statusText").textContent = "WS disconnected (polling)";
  };
}

// Boot
loadSettings();
$("saveSettings").onclick = () => {
  saveSettings();
  refresh();
};
$("refreshBtn").onclick = refresh;
connectWs();
setInterval(refresh, 2000);
refresh();

