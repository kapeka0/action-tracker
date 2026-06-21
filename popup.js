const statusEl = document.getElementById("status");
const listEl = document.getElementById("actions-list");
const footerEl = document.getElementById("footer");
const countEl = document.getElementById("count");
const markSeenBtn = document.getElementById("mark-seen");
const copyAllBtn = document.getElementById("copy-all");
const searchEl = document.getElementById("search");
const toastEl = document.getElementById("toast");

let currentDomain = null;
let currentActions = [];
let renderedActions = [];
let toastTimer = null;

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1500);
}

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.add("visible");
  listEl.innerHTML = "";
  footerEl.classList.add("hidden");
}

function renderActions(actions, filter) {
  statusEl.classList.remove("visible");
  listEl.innerHTML = "";

  if (actions.length === 0) {
    showStatus("No server actions found");
    return;
  }

  const query = (filter || "").toLowerCase();
  const filtered = query
    ? actions.filter((a) => a.name.toLowerCase().includes(query))
    : actions;

  if (filtered.length === 0) {
    showStatus("No matches");
    return;
  }

  const sorted = [...filtered].sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return (b.firstSeen || 0) - (a.firstSeen || 0);
  });

  renderedActions = sorted;

  for (const action of sorted) {
    const item = document.createElement("div");
    item.className = "action-item";
    item.title = `Click to copy hash: ${action.hash}`;

    const info = document.createElement("div");
    info.className = "action-info";

    const name = document.createElement("div");
    name.className = "action-name";
    name.textContent = action.name;

    const hash = document.createElement("div");
    hash.className = "action-hash";
    hash.textContent = action.hash;

    info.appendChild(name);
    info.appendChild(hash);
    item.appendChild(info);

    const right = document.createElement("div");
    right.className = "action-right";

    if (action.isNew) {
      const badge = document.createElement("span");
      badge.className = "badge-new";
      badge.textContent = "new";
      right.appendChild(badge);

      const dismiss = document.createElement("button");
      dismiss.className = "btn-dismiss";
      dismiss.textContent = "×";
      dismiss.title = "Mark as seen";
      dismiss.addEventListener("click", (e) => {
        e.stopPropagation();
        markOneSeen(action.hash);
      });
      right.appendChild(dismiss);
    }

    item.appendChild(right);

    item.addEventListener("click", () => {
      navigator.clipboard.writeText(action.hash).then(() => {
        showToast("Hash copied");
      });
    });

    listEl.appendChild(item);
  }

  const newCount = actions.filter((a) => a.isNew).length;
  countEl.textContent = `${actions.length} action${actions.length !== 1 ? "s" : ""}${newCount > 0 ? ` · ${newCount} new` : ""}`;
  footerEl.classList.remove("hidden");
  markSeenBtn.style.display = newCount > 0 ? "" : "none";
}

async function refreshActions() {
  currentActions =
    (await chrome.runtime.sendMessage({
      type: "get-actions",
      domain: currentDomain,
    })) || [];
  renderActions(currentActions, searchEl.value);
  await updateBadge();
}

async function updateBadge() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const newCount = currentActions.filter((a) => a.isNew).length;
  chrome.action.setBadgeText({
    text: newCount > 0 ? String(newCount) : "",
    tabId: tab.id,
  });
}

async function markOneSeen(hash) {
  await chrome.runtime.sendMessage({
    type: "mark-one-seen",
    domain: currentDomain,
    hash,
  });
  await refreshActions();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showStatus("No active tab");
    return;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    showStatus("Invalid URL");
    return;
  }

  currentDomain = url.hostname;

  const tabState = await chrome.runtime.sendMessage({
    type: "get-tab-state",
    tabId: tab.id,
  });

  if (tabState && !tabState.isNextJs) {
    showStatus("Not a Next.js application");
    return;
  }

  currentActions =
    (await chrome.runtime.sendMessage({
      type: "get-actions",
      domain: currentDomain,
    })) || [];

  if (currentActions.length === 0) {
    showStatus(
      tabState ? "No server actions found" : "Waiting for page scan...",
    );
    return;
  }

  renderActions(currentActions, "");
}

searchEl.addEventListener("input", () => {
  renderActions(currentActions, searchEl.value);
});

copyAllBtn.addEventListener("click", () => {
  if (renderedActions.length === 0) return;
  const text = renderedActions.map((a) => `${a.name} ${a.hash}`).join("\n");
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${renderedActions.length} action(s) copied`);
  });
});

markSeenBtn.addEventListener("click", async () => {
  if (!currentDomain) return;
  await chrome.runtime.sendMessage({
    type: "mark-seen",
    domain: currentDomain,
  });
  await refreshActions();
  showToast("All marked as seen");
});

init();
