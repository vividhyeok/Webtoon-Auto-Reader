"use strict";

const defaults = { speed: 80, autoNext: true, delaySeconds: 3 };
const elements = {
  status: document.querySelector("#status"),
  episode: document.querySelector("#episode"),
  speed: document.querySelector("#speed"),
  speedValue: document.querySelector("#speedValue"),
  toggle: document.querySelector("#toggle"),
  stop: document.querySelector("#stop"),
  autoNext: document.querySelector("#autoNext"),
  delay: document.querySelector("#delay"),
  delayValue: document.querySelector("#delayValue"),
  message: document.querySelector("#message")
};

let tabId;
let currentState = { supported: false, status: "unsupported" };
let updateTimer;

const statusLabels = {
  playing: "재생 중",
  paused: "일시정지",
  waiting: "다음 회차 대기 중",
  "paused-waiting": "대기 일시정지",
  stopped: "중지",
  unsupported: "지원하지 않는 페이지"
};

function render(state) {
  currentState = state;
  const status = state.status || "stopped";
  elements.status.textContent = statusLabels[status] || statusLabels.stopped;
  elements.status.className = `status ${status}`;
  elements.episode.textContent = state.supported
    ? [state.title, state.episodeTitle].filter(Boolean).join(" · ")
    : "네이버 웹툰 회차 페이지를 열어 주세요";
  elements.message.textContent = state.message || (status === "waiting" ? `${state.waitRemaining ?? 0}초 후 이동` : "");
  elements.toggle.textContent = ["playing", "waiting"].includes(status) ? "Ⅱ 일시정지" : "▶ 재생";
  elements.toggle.disabled = !state.supported;
  elements.stop.disabled = !state.supported || status === "stopped";
}

async function command(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type: "TAB_COMMAND", tabId, command: { type, ...payload } });
  if (response?.ok === false) elements.message.textContent = response.error;
  else if (response) render(response);
}

async function saveSettings() {
  const settings = {
    speed: Number(elements.speed.value),
    autoNext: elements.autoNext.checked,
    delaySeconds: Number(elements.delay.value)
  };
  elements.speedValue.textContent = `${settings.speed} px/s`;
  elements.delayValue.textContent = `${settings.delaySeconds}초`;
  await chrome.storage.local.set(settings);
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => command("SETTINGS", { settings }), 40);
}

elements.speed.addEventListener("input", saveSettings);
elements.delay.addEventListener("input", saveSettings);
elements.autoNext.addEventListener("change", saveSettings);
elements.toggle.addEventListener("click", () => {
  command(["playing", "waiting"].includes(currentState.status) ? "PAUSE" : "PLAY");
});
elements.stop.addEventListener("click", () => command("STOP"));

(async function initialize() {
  const settings = await chrome.storage.local.get(defaults);
  elements.speed.value = settings.speed;
  elements.autoNext.checked = settings.autoNext;
  elements.delay.value = settings.delaySeconds;
  elements.speedValue.textContent = `${settings.speed} px/s`;
  elements.delayValue.textContent = `${settings.delaySeconds}초`;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!tabId) return render(currentState);
  const state = await chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId });
  render(state || currentState);
  setInterval(async () => {
    const fresh = await chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId });
    if (fresh) render(fresh);
  }, 500);
})().catch((error) => { elements.message.textContent = error.message; });
