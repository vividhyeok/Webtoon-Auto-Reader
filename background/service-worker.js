"use strict";

const SESSION_KEY = "tabSessions";
const DEFAULT_SETTINGS = { speed: 80, autoNext: true, delaySeconds: 3 };

async function readSessions() {
  return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || {};
}

async function writeSessions(sessions) {
  await chrome.storage.session.set({ [SESSION_KEY]: sessions });
}

async function getSession(tabId) {
  const sessions = await readSessions();
  return sessions[String(tabId)] || null;
}

async function setSession(tabId, patch) {
  const sessions = await readSessions();
  const key = String(tabId);
  sessions[key] = { ...(sessions[key] || {}), ...patch, updatedAt: Date.now() };
  await writeSessions(sessions);
  return sessions[key];
}

async function removeSession(tabId) {
  const sessions = await readSessions();
  delete sessions[String(tabId)];
  await writeSessions(sessions);
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...stored });
  await chrome.storage.session.remove(SESSION_KEY);
});

chrome.runtime.onStartup.addListener(() => chrome.storage.session.remove(SESSION_KEY));
chrome.tabs.onRemoved.addListener((tabId) => removeSession(tabId));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id ?? message.tabId;
    if (message.type === "CONTENT_READY") {
      const existing = await getSession(tabId);
      if (existing?.seriesId && existing.seriesId !== message.page.seriesId) {
        await removeSession(tabId);
        sendResponse({ session: null });
        return;
      }
      sendResponse({ session: existing });
      return;
    }
    if (message.type === "SESSION_UPDATE" && sender.tab?.id !== undefined) {
      sendResponse({ session: await setSession(sender.tab.id, message.patch) });
      return;
    }
    if (message.type === "GET_TAB_STATE") {
      const session = await getSession(message.tabId);
      try {
        const live = await chrome.tabs.sendMessage(message.tabId, { type: "GET_STATE" });
        sendResponse(live);
      } catch (_) {
        sendResponse(session ? { ...session, supported: true } : { status: "unsupported", supported: false });
      }
      return;
    }
    if (message.type === "TAB_COMMAND") {
      try {
        const result = await chrome.tabs.sendMessage(message.tabId, message.command);
        sendResponse(result);
      } catch (_) {
        sendResponse({ ok: false, error: "지원되는 네이버 웹툰 페이지를 열어 주세요." });
      }
      return;
    }
    sendResponse({ ok: false });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
