"use strict";
importScripts(
  "../shared-settings.js",
  "../content/adapters/naver.js",
  "../scene-db.js",
);
let queue = Promise.resolve();
function serial(fn) {
  const task = queue.then(fn);
  queue = task.catch(() => {});
  return task;
}
const sessionKey = (id) => "tab:" + id;
async function getSession(id) {
  return (
    (await chrome.storage.session.get(sessionKey(id)))[sessionKey(id)] || null
  );
}
async function setSession(id, patch) {
  const s = { ...(await getSession(id)), ...patch, updatedAt: Date.now() };
  await chrome.storage.session.set({ [sessionKey(id)]: s });
  return s;
}
async function bookmarks() {
  return (await chrome.storage.local.get("bookmarks")).bookmarks || [];
}
function same(a, b) {
  const parse = WebtoonAdapters.naver.parseEpisodeUrl;
  const x = parse(a),
    y = parse(b);
  return !!x && !!y && x.titleId === y.titleId && x.episode === y.episode;
}
chrome.runtime.onInstalled.addListener(() =>
  serial(async () => {
    const raw = await chrome.storage.local.get(null);
    await chrome.storage.local.set(ReaderSettings.normalize(raw));
  }),
);
chrome.tabs.onRemoved.addListener((id) =>
  serial(() => chrome.storage.session.remove(sessionKey(id))),
);
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id)
    chrome.tabs
      .sendMessage(tab.id, {
        type: {
          "toggle-reading": "TOGGLE",
          "save-scene": "BOOKMARK",
          "rewind-reading": "REWIND",
        }[command],
      })
      .catch(() => {});
});
async function route(m, sender) {
  const id = sender.tab?.id ?? m.tabId;
  if (m.type === "CONTENT_READY")
    return serial(async () => {
      const old = await getSession(id);
      if (old?.restoreUrl && same(old.restoreUrl, m.page.url)) {
        await chrome.storage.session.remove(sessionKey(id));
        return { anchor: old.anchor };
      }
      if (old && same(old.url, m.page.url)) return { session: old };
      if (old?.resumeAfterNavigation && same(old.nextUrl, m.page.url)) {
        const updated = {
          ...old,
          url: m.page.url,
          episode: m.page.episode,
          resumeAfterNavigation: false,
          nextUrl: null,
        };
        await setSession(id, updated);
        return { session: updated };
      }
      await chrome.storage.session.remove(sessionKey(id));
      return { session: null };
    });
  if (m.type === "SESSION_UPDATE" && sender.tab?.id !== undefined)
    return serial(async () => ({ session: await setSession(id, m.patch) }));
  if (m.type === "GET_TAB_STATE") {
    try {
      return await chrome.tabs.sendMessage(id, { type: "GET_STATE" });
    } catch {
      return { supported: false, status: "unsupported" };
    }
  }
  if (m.type === "TAB_COMMAND") {
    try {
      return await chrome.tabs.sendMessage(id, m.command);
    } catch {
      return {
        ok: false,
        error: "네이버 웹툰 회차 페이지를 열거나 새로고침해 주세요.",
      };
    }
  }
  if (m.type === "BOOKMARK_ADD")
    return serial(async () => {
      if (!same(m.item.url, sender.tab?.url))
        throw Error("현재 회차를 확인할 수 없습니다.");
      const items = await bookmarks();
      if (items.length >= 1000)
        throw Error("수집함이 가득 찼습니다. 일부 장면을 삭제해 주세요.");
      const item = {
        ...m.item,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      items.unshift(item);
      await chrome.storage.local.set({ bookmarks: items });
      return { ok: true, item };
    });
  if (m.type === "SCENE_CAPTURE")
    return serial(async () => {
      const items = await bookmarks(),
        item = items.find((i) => i.id === m.id);
      const tab = await chrome.tabs.get(m.tabId);
      const [active] = await chrome.tabs.query({
        active: true,
        windowId: tab.windowId,
      });
      if (!item || active?.id !== tab.id || !same(item.url, tab.url))
        throw Error(
          "저장한 회차를 활성 탭으로 연 뒤 캡처해 주세요. 위치 북마크는 보관됩니다.",
        );
      let data;
      try {
        data = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
      } catch {
        return {
          ok: false,
          error:
            "화면 캡처 권한이 없거나 현재 화면을 저장할 수 없습니다. 위치 북마크는 저장되었습니다.",
        };
      }
      await SceneDB.run("readwrite", item.id, data);
      item.hasImage = true;
      await chrome.storage.local.set({ bookmarks: items });
      return { ok: true };
    });
  if (m.type === "BOOKMARK_EDIT" || m.type === "BOOKMARK_DELETE")
    return serial(async () => {
      let items = await bookmarks();
      const item = items.find((i) => i.id === m.id);
      if (!item) throw Error("장면을 찾을 수 없습니다.");
      if (m.type === "BOOKMARK_EDIT") {
        item.note = String(m.note || "").slice(0, 4000);
        item.tags = String(m.tags || "").slice(0, 300);
      } else {
        await SceneDB.run("readwrite", m.id, null);
        items = items.filter((i) => i.id !== m.id);
      }
      await chrome.storage.local.set({ bookmarks: items });
      return { ok: true };
    });
  if (m.type === "IMAGE_DELETE")
    return serial(async () => {
      await SceneDB.run("readwrite", m.id, null);
      const items = await bookmarks();
      const item = items.find((i) => i.id === m.id);
      if (item) item.hasImage = false;
      await chrome.storage.local.set({ bookmarks: items });
      return { ok: true };
    });
  if (m.type === "BOOKMARK_OPEN")
    return serial(async () => {
      const item = (await bookmarks()).find((i) => i.id === m.id);
      if (!item || !WebtoonAdapters.naver.parseEpisodeUrl(item.url))
        throw Error("유효하지 않은 장면 주소입니다.");
      const tab = await chrome.tabs.create({ url: "about:blank" });
      await setSession(tab.id, {
        restoreUrl: item.url,
        anchor: item.anchor,
        status: "paused",
      });
      await chrome.tabs.update(tab.id, { url: item.url });
      return { ok: true };
    });
  return { ok: false, error: "알 수 없는 요청입니다." };
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  route(m, sender)
    .then(reply)
    .catch((e) =>
      reply({ ok: false, error: e.message || "요청을 처리하지 못했습니다." }),
    );
  return true;
});
