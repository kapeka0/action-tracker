const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const test = require("node:test");

function createBackgroundHarness(initialStorage = {}) {
  const storage = structuredClone(initialStorage);
  let onMessage;

  const chrome = {
    action: {
      setBadgeBackgroundColor() {},
      setBadgeText() {},
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          onMessage = listener;
        },
      },
    },
    storage: {
      local: {
        async get(key) {
          return Object.hasOwn(storage, key) ? { [key]: storage[key] } : {};
        },
        async set(values) {
          Object.assign(storage, structuredClone(values));
        },
      },
    },
    tabs: {
      onRemoved: { addListener() {} },
    },
  };

  const source = readFileSync("background.js", "utf8");
  runInNewContext(source, { chrome, Date, Map, Set });

  async function send(message) {
    return new Promise((resolve) => {
      const keepChannelOpen = onMessage(
        message,
        { tab: { id: 7 } },
        (response) => resolve(structuredClone(response)),
      );
      if (keepChannelOpen !== true) resolve(undefined);
    });
  }

  return { send, storage };
}

test("a rebuilt action replaces its previous hash instead of being duplicated", async () => {
  const { send, storage } = createBackgroundHarness();
  const domain = "example.com";

  const firstResult = await send({
    type: "actions-found",
    domain,
    actions: [{ name: "saveProfile", hash: "old-build-hash" }],
  });
  const originalFirstSeen = storage[`actions_${domain}`][0].firstSeen;
  await send({
    type: "mark-one-seen",
    domain,
    hash: "old-build-hash",
  });
  const rebuiltResult = await send({
    type: "actions-found",
    domain,
    actions: [{ name: "saveProfile", hash: "new-build-hash" }],
  });

  assert.equal(firstResult.newCount, 1);
  assert.deepEqual(rebuiltResult, { newCount: 0, total: 1 });
  assert.equal(storage[`actions_${domain}`].length, 1);
  assert.equal(storage[`actions_${domain}`][0].firstSeen, originalFirstSeen);
  assert.deepEqual(
    {
      name: storage[`actions_${domain}`][0].name,
      hash: storage[`actions_${domain}`][0].hash,
      isNew: storage[`actions_${domain}`][0].isNew,
    },
    { name: "saveProfile", hash: "new-build-hash", isNew: false },
  );
});

test("reading actions compacts duplicates saved by older extension versions", async () => {
  const domain = "example.com";
  const storageKey = `actions_${domain}`;
  const { send, storage } = createBackgroundHarness({
    [storageKey]: [
      {
        name: "saveProfile",
        hash: "old-build-hash",
        isNew: false,
        firstSeen: 100,
      },
      {
        name: "saveProfile",
        hash: "new-build-hash",
        isNew: true,
        firstSeen: 200,
      },
    ],
  });

  const actions = await send({ type: "get-actions", domain });

  assert.deepEqual(actions, [
    {
      name: "saveProfile",
      hash: "new-build-hash",
      isNew: false,
      firstSeen: 100,
    },
  ]);
  assert.deepEqual(storage[storageKey], actions);
});
