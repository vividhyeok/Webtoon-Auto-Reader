"use strict";
const $ = (id) => document.getElementById(id);
let tabId,
  settings = ReaderSettings.normalize(),
  state = { supported: false },
  saveQueue = Promise.resolve();
const fields = [
  ["speed", "연속형 속도 (px/s)", 10, 2400, 1],
  ["distance", "한 번에 이동할 화면 비율 (%)", 10, 300, 1],
  ["duration", "이동 애니메이션 (ms)", 100, 800, 10],
  ["readingSeconds", "이동 후 읽기 대기 (초)", 0.5, 6, 0.1],
  ["lastSeconds", "마지막 컷 감상 (초)", 0.5, 15, 0.5],
  ["delaySeconds", "다음 회차 이동 대기 (초)", 0, 10, 1],
  ["resumeSeconds", "수동 조작 후 재개 대기 (초)", 1, 30, 1],
];
for (const [key, label, min, max, step] of fields) {
  const l = document.createElement("label");
  l.textContent = label + " ";
  const o = document.createElement("output");
  o.id = key + "Value";
  const i = document.createElement("input");
  Object.assign(i, { id: key, type: "range", min, max, step });
  l.append(o, i);
  $("advanced").append(l);
}
for (const [key, label] of [
  ["manualPause", "수동 조작 시 일시정지"],
  ["autoResume", "수동 조작 후 자동 재개"],
]) {
  const l = document.createElement("label");
  l.className = "switch-row";
  l.textContent = label;
  const i = document.createElement("input");
  i.type = "checkbox";
  i.id = key;
  l.append(i);
  $("advanced").append(l);
}
const curve = document.createElement("label");
curve.textContent = "감속 곡선";
const select = document.createElement("select");
select.id = "curve";
for (const [v, t] of [
  ["cubic", "부드러운 감속"],
  ["linear", "일정한 이동"],
]) {
  const o = document.createElement("option");
  o.value = v;
  o.textContent = t;
  select.append(o);
}
curve.append(select);
$("advanced").append(curve);
function renderSettings() {
  for (const k of [
    "mode",
    "preset",
    "tempo",
    "autoNext",
    "manualPause",
    "autoResume",
    "curve",
    ...fields.map((f) => f[0]),
  ]) {
    const e = $(k);
    if (e.type === "checkbox") e.checked = settings[k];
    else e.value = settings[k];
    const out = $(k + "Value");
    if (out)
      out.textContent = Number(settings[k]).toFixed(
        k.includes("Seconds") ? 1 : 0,
      );
  }
}
function render(s) {
  state = s;
  const active = ["playing", "waiting"].includes(s.status);
  $("status").textContent =
    s.hidden && active
      ? "숨김 · 대기"
      : {
          playing: s.phase === "READING" ? "읽는 중" : "이동 중",
          waiting: "회차 대기",
          paused: "일시정지",
          "paused-waiting": "대기 정지",
          stopped: "중지",
        }[s.status] || "페이지 확인";
  $("episode").textContent = s.supported
    ? [s.title, s.episodeTitle].filter(Boolean).join(" · ")
    : "네이버 웹툰 회차를 열어 주세요";
  $("toggle").textContent = active ? "Ⅱ 일시정지" : "▶ 재생";
  for (const k of [
    "toggle",
    "stop",
    "rewind",
    "rewind3",
    "bookmark",
    "capture",
  ])
    $(k).disabled = !s.supported;
  $("message").textContent =
    s.message || (s.status === "waiting" ? `${s.waitRemaining}초 대기` : "");
}
async function command(type, extra = {}) {
  const r = await chrome.runtime.sendMessage({
    type: "TAB_COMMAND",
    tabId,
    command: { type, ...extra },
  });
  if (r.ok === false) throw Error(r.error);
  render(r);
  return r;
}
function fail(e) {
  $("message").textContent = e.message || "요청을 처리하지 못했습니다.";
}
function save() {
  renderSettings();
  const snapshot = { ...settings };
  saveQueue = saveQueue
    .then(() => chrome.storage.local.set(snapshot))
    .catch(fail);
}
for (const k of [
  "mode",
  "tempo",
  "autoNext",
  "manualPause",
  "autoResume",
  "curve",
  ...fields.map((f) => f[0]),
])
  $(k).addEventListener("input", () => {
    const e = $(k);
    settings[k] =
      e.type === "checkbox"
        ? e.checked
        : e.type === "range"
          ? Number(e.value)
          : e.value;
    settings.preset = "custom";
    if (k === "tempo" || k === "mode")
      settings = ReaderSettings.tempo(settings, settings.tempo);
    save();
  });
$("preset").onchange = () => {
  settings = ReaderSettings.preset($("preset").value);
  save();
};
$("reset").onclick = () => {
  settings = { ...ReaderSettings.defaults };
  save();
};
$("toggle").onclick = () =>
  command(
    ["playing", "waiting"].includes(state.status) ? "PAUSE" : "PLAY",
  ).catch(fail);
$("stop").onclick = () => command("STOP").catch(fail);
$("rewind").onclick = () => command("REWIND", { count: 1 }).catch(fail);
$("rewind3").onclick = () => command("REWIND", { count: 3 }).catch(fail);
$("bookmark").onclick = () => command("BOOKMARK").catch(fail);
$("capture").onclick = async () => {
  try {
    await command("PAUSE");
    const saved = await command("BOOKMARK");
    const r = await chrome.runtime.sendMessage({
      type: "SCENE_CAPTURE",
      id: saved.bookmarkId,
      tabId,
    });
    $("message").textContent = r.ok
      ? "현재 보이는 화면을 저장했습니다."
      : r.error;
  } catch (e) {
    fail(e);
  }
};
$("gallery").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("gallery/gallery.html") });
(async () => {
  settings = ReaderSettings.normalize(await chrome.storage.local.get(null));
  renderSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  async function poll() {
    if (!tabId) return;
    render(await chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId }));
  }
  await poll();
  const timer = setInterval(() => poll().catch(fail), 400);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
})().catch(fail);
