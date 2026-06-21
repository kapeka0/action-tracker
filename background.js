chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });

const tabState = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "not-nextjs") {
    if (sender.tab?.id) {
      tabState.set(sender.tab.id, { isNextJs: false });
      chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
    }
    return;
  }

  if (message.type === "nextjs-detected") {
    if (sender.tab?.id) {
      tabState.set(sender.tab.id, { isNextJs: true });
    }
    return;
  }

  if (message.type === "actions-found") {
    handleActionsFound(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "get-actions") {
    getActionsForDomain(message.domain).then(sendResponse);
    return true;
  }

  if (message.type === "mark-seen") {
    markAllSeen(message.domain).then(sendResponse);
    return true;
  }

  if (message.type === "mark-one-seen") {
    markOneSeen(message.domain, message.hash).then(sendResponse);
    return true;
  }

  if (message.type === "get-tab-state") {
    sendResponse(tabState.get(message.tabId) || null);
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

async function handleActionsFound(message, sender) {
  const { domain, actions } = message;
  const tabId = sender.tab?.id;
  const storageKey = `actions_${domain}`;

  if (tabId) {
    tabState.set(tabId, { isNextJs: true });
  }

  const result = await chrome.storage.local.get(storageKey);
  const stored = result[storageKey] || [];
  const existingHashes = new Set(stored.map((a) => a.hash));

  let newCount = 0;
  const now = Date.now();

  for (const action of actions) {
    if (!existingHashes.has(action.hash)) {
      stored.push({
        hash: action.hash,
        name: action.name,
        isNew: true,
        firstSeen: now,
      });
      existingHashes.add(action.hash);
      newCount++;
    }
  }

  if (newCount > 0) {
    await chrome.storage.local.set({ [storageKey]: stored });
  }

  const totalNew = stored.filter((a) => a.isNew).length;

  if (tabId) {
    chrome.action.setBadgeText({
      text: totalNew > 0 ? String(totalNew) : "",
      tabId,
    });
  }

  return { newCount, total: stored.length };
}

async function getActionsForDomain(domain) {
  const storageKey = `actions_${domain}`;
  const result = await chrome.storage.local.get(storageKey);
  return result[storageKey] || [];
}

async function markOneSeen(domain, hash) {
  const storageKey = `actions_${domain}`;
  const result = await chrome.storage.local.get(storageKey);
  const stored = result[storageKey] || [];

  const action = stored.find((a) => a.hash === hash);
  if (action) {
    action.isNew = false;
    await chrome.storage.local.set({ [storageKey]: stored });
  }

  return { ok: true };
}

async function markAllSeen(domain) {
  const storageKey = `actions_${domain}`;
  const result = await chrome.storage.local.get(storageKey);
  const stored = result[storageKey] || [];

  for (const action of stored) {
    action.isNew = false;
  }

  await chrome.storage.local.set({ [storageKey]: stored });
  return { ok: true };
}
