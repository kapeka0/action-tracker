const ACTION_REGEX =
  /createServerReference\)?\(\s*"([0-9a-fA-F]+)"[\s\S]*?,\s*"([^"]+)"\s*[,)]/g;

const domain = location.hostname;
const scannedSrcs = new Set();
const foundActions = new Map();
let sendTimer = null;

function isNextJs() {
  if (document.getElementById("__next")) return true;
  if (document.getElementById("__NEXT_DATA__")) return true;
  const scripts = document.querySelectorAll("script[src]");
  for (const s of scripts) {
    if (s.src.includes("/_next/")) return true;
  }
  return false;
}

function extractActions(text) {
  const actions = [];
  let match;
  ACTION_REGEX.lastIndex = 0;
  while ((match = ACTION_REGEX.exec(text)) !== null) {
    actions.push({ hash: match[1], name: match[2] });
  }
  return actions;
}

function registerActions(actions) {
  let hasNew = false;
  for (const a of actions) {
    if (!foundActions.has(a.hash)) {
      foundActions.set(a.hash, a);
      hasNew = true;
      console.log(`[AT] Found: ${a.name} (${a.hash.slice(0, 12)}...)`);
    }
  }
  if (hasNew) scheduleSend();
}

function scheduleSend() {
  if (sendTimer) return;
  sendTimer = setTimeout(() => {
    sendTimer = null;
    const actions = Array.from(foundActions.values());
    try {
      chrome.runtime.sendMessage({
        type: "actions-found",
        domain,
        actions,
      });
    } catch {}
  }, 300);
}

function scanScript(script) {
  if (script.src) {
    if (scannedSrcs.has(script.src)) return;
    scannedSrcs.add(script.src);
    fetch(script.src)
      .then((r) => r.text())
      .then((text) => {
        const actions = extractActions(text);
        if (actions.length > 0) {
          console.log(`[AT] ${actions.length} action(s) in ${script.src.split("/").pop()}`);
          registerActions(actions);
        }
      })
      .catch(() => {});
  } else if (script.textContent) {
    const actions = extractActions(script.textContent);
    if (actions.length > 0) {
      console.log(`[AT] ${actions.length} action(s) in inline script`);
      registerActions(actions);
    }
  }
}

function scanAllScripts() {
  const scripts = document.querySelectorAll("script");
  console.log(`[AT] Scanning ${scripts.length} scripts`);
  for (const s of scripts) {
    scanScript(s);
  }
}

function startObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName === "SCRIPT") {
          scanScript(node);
        } else if (node.querySelectorAll) {
          const scripts = node.querySelectorAll("script");
          for (const s of scripts) {
            scanScript(s);
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function watchNavigations() {
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log(`[AT] Navigation: ${location.pathname}`);
      scanAllScripts();
    }
  }, 1000);
}

if (!isNextJs()) {
  console.log("[AT] Not a Next.js app");
  try {
    chrome.runtime.sendMessage({ type: "not-nextjs" });
  } catch {}
} else {
  console.log("[AT] Next.js detected");
  try {
    chrome.runtime.sendMessage({ type: "nextjs-detected", domain });
  } catch {}
  scanAllScripts();
  startObserver();
  watchNavigations();
}
