const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
function event() {
  const listeners = [];
  return {
    addListener(f) {
      listeners.push(f);
    },
    removeListener(f) {
      const i = listeners.indexOf(f);
      if (i >= 0) listeners.splice(i, 1);
    },
    listeners,
  };
}
function area() {
  const values = {};
  return {
    async get(k) {
      return typeof k === "string" ? { [k]: values[k] } : { ...values };
    },
    async set(v) {
      Object.assign(values, v);
    },
    async remove(k) {
      delete values[k];
    },
    values,
  };
}
function harness() {
  const local = area(),
    session = area(),
    onMessage = event();
  const chrome = {
    storage: { local, session },
    runtime: { onMessage, onInstalled: event() },
    tabs: {
      onRemoved: event(),
      async sendMessage() {
        throw Error("no content");
      },
    },
    commands: { onCommand: event() },
  };
  const context = vm.createContext({
    chrome,
    console,
    URL,
    crypto: require("node:crypto").webcrypto,
    importScripts(...paths) {
      for (const p of paths)
        vm.runInContext(
          fs.readFileSync(require("node:path").join("background", p), "utf8"),
          context,
        );
    },
  });
  vm.runInContext(
    fs.readFileSync("background/service-worker.js", "utf8"),
    context,
  );
  function send(message, tab) {
    return new Promise((resolve) =>
      onMessage.listeners[0](message, { tab }, resolve),
    );
  }
  return { chrome, send, local, session };
}
const url = (n) => "https://comic.naver.com/webtoon/detail?titleId=1&no=" + n;
test("동시 세션 저장은 탭별로 독립적이고 URL을 검증한다", async () => {
  const h = harness();
  await Promise.all([
    h.send(
      { type: "SESSION_UPDATE", patch: { url: url(1), status: "playing" } },
      { id: 1 },
    ),
    h.send(
      { type: "SESSION_UPDATE", patch: { url: url(2), status: "paused" } },
      { id: 2 },
    ),
  ]);
  assert.equal(h.session.values["tab:1"].status, "playing");
  assert.equal(h.session.values["tab:2"].status, "paused");
  assert.ok(
    (await h.send({ type: "CONTENT_READY", page: { url: url(1) } }, { id: 1 }))
      .session,
  );
  assert.equal(
    (await h.send({ type: "CONTENT_READY", page: { url: url(3) } }, { id: 1 }))
      .session,
    null,
  );
});
test("의도한 다음 회차만 자동 재개한다", async () => {
  const h = harness();
  await h.send(
    {
      type: "SESSION_UPDATE",
      patch: {
        url: url(1),
        nextUrl: url(2),
        resumeAfterNavigation: true,
        status: "playing",
      },
    },
    { id: 1 },
  );
  const r = await h.send(
    { type: "CONTENT_READY", page: { url: url(2), episode: 2 } },
    { id: 1 },
  );
  assert.equal(r.session.episode, 2);
  assert.equal(r.session.resumeAfterNavigation, false);
  assert.equal(
    (await h.send({ type: "GET_TAB_STATE", tabId: 1 })).supported,
    false,
  );
});
test("북마크는 현재 회차만 저장하고 태그와 메모를 갱신한다", async () => {
  const h = harness();
  const r = await h.send(
    {
      type: "BOOKMARK_ADD",
      item: { url: url(1), anchor: { index: 2, ratio: 0.4 } },
    },
    { id: 1, url: url(1) },
  );
  assert.equal(r.ok, true);
  assert.equal(h.local.values.bookmarks[0].anchor.index, 2);
  await h.send({
    type: "BOOKMARK_EDIT",
    id: r.item.id,
    tags: "좋아",
    note: "다시 보기",
  });
  assert.equal(h.local.values.bookmarks[0].note, "다시 보기");
  assert.equal(
    (
      await h.send(
        { type: "BOOKMARK_ADD", item: { url: url(2) } },
        { id: 1, url: url(1) },
      )
    ).ok,
    false,
  );
});

test("화면 캡처 권한 실패에도 위치 북마크를 유지한다", async () => {
  const h = harness();
  const saved = await h.send(
    {
      type: "BOOKMARK_ADD",
      item: { url: url(1), anchor: { index: 0, ratio: 0.5 } },
    },
    { id: 1, url: url(1) },
  );
  h.chrome.tabs.get = async () => ({ id: 1, windowId: 3, url: url(1) });
  h.chrome.tabs.query = async () => [{ id: 1 }];
  h.chrome.tabs.captureVisibleTab = async () => {
    throw Error("permission denied");
  };
  const r = await h.send({
    type: "SCENE_CAPTURE",
    id: saved.item.id,
    tabId: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /위치 북마크/);
  assert.equal(h.local.values.bookmarks.length, 1);
});
test("북마크를 새 탭에 열면 검증된 URL에서만 복원한다", async () => {
  const h = harness();
  const saved = await h.send(
    {
      type: "BOOKMARK_ADD",
      item: { url: url(1), anchor: { index: 2, ratio: 0.3 } },
    },
    { id: 1, url: url(1) },
  );
  h.chrome.tabs.create = async () => ({ id: 9 });
  let opened;
  h.chrome.tabs.update = async (id, patch) => {
    opened = patch.url;
  };
  assert.equal(
    (await h.send({ type: "BOOKMARK_OPEN", id: saved.item.id })).ok,
    true,
  );
  assert.equal(opened, url(1));
  const ready = await h.send(
    { type: "CONTENT_READY", page: { url: url(1) } },
    { id: 9 },
  );
  assert.equal(ready.anchor.index, 2);
  assert.equal(ready.anchor.ratio, 0.3);
});
