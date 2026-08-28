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
  const compacted = compactActions(result[storageKey] || []);
  const stored = compacted.actions;
  const existingActions = new Map(
    stored.map((action) => [getActionIdentity(action), action]),
  );

  let newCount = 0;
  let hasChanges = compacted.changed;
  const now = Date.now();

  for (const action of actions) {
    const identity = getActionIdentity(action);
    const existing = existingActions.get(identity);

    if (existing) {
      if (existing.hash !== action.hash) {
        existing.hash = action.hash;
        hasChanges = true;
      }
    } else {
      const storedAction = {
        hash: action.hash,
        name: action.name,
        isNew: true,
        firstSeen: now,
      };
      stored.push(storedAction);
      existingActions.set(identity, storedAction);
      newCount++;
      hasChanges = true;
    }
  }

  if (hasChanges) {
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
  const compacted = compactActions(result[storageKey] || []);

  if (compacted.changed) {
    await chrome.storage.local.set({ [storageKey]: compacted.actions });
  }

  return compacted.actions;
}

function getActionIdentity(action) {
  return action.name || action.hash;
}

function compactActions(actions) {
  const compacted = [];
  const byIdentity = new Map();
  let changed = false;

  for (const action of actions) {
    const identity = getActionIdentity(action);
    const existing = byIdentity.get(identity);

    if (!existing) {
      const storedAction = { ...action };
      compacted.push(storedAction);
      byIdentity.set(identity, storedAction);
      continue;
    }

    // Storage order follows discovery order, so the last duplicate has the
    // current build's hash. Keep the original seen state and discovery date.
    existing.hash = action.hash;
    changed = true;
  }

  return { actions: compacted, changed };
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
