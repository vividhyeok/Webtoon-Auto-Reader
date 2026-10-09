(function () {
  "use strict";

  if (globalThis.__webtoonAutoReaderLoaded) return;
  globalThis.__webtoonAutoReaderLoaded = true;

  const adapter = globalThis.WebtoonAdapters?.naver;
  const page = adapter?.getPageInfo(document, location);
  if (!adapter || !page?.supported) return;

  const defaults = { speed: 80, autoNext: true, delaySeconds: 3 };
  const state = {
    status: "stopped",
    speed: defaults.speed,
    autoNext: defaults.autoNext,
    delaySeconds: defaults.delaySeconds,
    waitRemainingMs: 0,
    endStableSince: null,
    lastWaitTick: null,
    navigating: false,
    noImagesSince: null,
    message: ""
  };

  const originalScrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";

  const engine = new WebtoonScrollEngine({
    getTarget: () => adapter.getScrollElement(document),
    onFrame: handleFrame
  });

  function publicState() {
    return {
      supported: true,
      status: state.status,
      speed: state.speed,
      autoNext: state.autoNext,
      delaySeconds: state.delaySeconds,
      waitRemaining: Math.ceil(state.waitRemainingMs / 1000),
      title: page.title,
      episodeTitle: page.episodeTitle,
      episode: page.episode,
      seriesId: page.seriesId,
      message: state.message
    };
  }

  function persist(extra = {}) {
    return chrome.runtime.sendMessage({
      type: "SESSION_UPDATE",
      patch: { ...publicState(), ...extra, seriesId: page.seriesId, episode: page.episode }
    }).catch(() => {});
  }

  function setStatus(status, message = "") {
    state.status = status;
    state.message = message;
    persist();
  }

  function play() {
    state.navigating = false;
    state.lastWaitTick = null;
    if (["waiting", "paused-waiting"].includes(state.status) && state.waitRemainingMs > 0) {
      setStatus("waiting");
    } else {
      state.endStableSince = null;
      state.waitRemainingMs = 0;
      setStatus("playing");
    }
    engine.setSpeed(state.speed);
    engine.start();
  }

  function pause() {
    if (state.status === "stopped") return;
    state.status = state.status === "waiting" ? "paused-waiting" : "paused";
    engine.pause();
    state.lastWaitTick = null;
    persist();
  }

  function stop(message = "") {
    engine.stop();
    Object.assign(state, {
      status: "stopped",
      waitRemainingMs: 0,
      endStableSince: null,
      lastWaitTick: null,
      navigating: false,
      message
    });
    persist({ resumeAfterNavigation: false });
  }

  function imagesReady(images) {
    return images.length > 0 && images.every((img) => img.complete && img.naturalHeight > 0);
  }

  function reachedEnd() {
    const images = adapter.getImages(document);
    if (!images.length) {
      state.noImagesSince ??= performance.now();
      return false;
    }
    state.noImagesSince = null;
    if (!imagesReady(images)) return false;
    const last = images[images.length - 1];
    const rect = last.getBoundingClientRect();
    return rect.height > 0 && rect.bottom <= window.innerHeight - 24;
  }

  function handleFrame(time) {
    if (state.status === "waiting") {
      if (state.lastWaitTick !== null) state.waitRemainingMs -= Math.min(100, time - state.lastWaitTick);
      state.lastWaitTick = time;
      if (state.waitRemainingMs <= 0) navigateNext();
      return;
    }
    if (state.status !== "playing") return;
    if (state.noImagesSince !== null && time - state.noImagesSince > 20000) {
      stop("웹툰 본문 이미지를 찾지 못해 자동 재생을 종료했습니다.");
      return;
    }
    if (!reachedEnd()) {
      state.endStableSince = null;
      return;
    }
    if (state.endStableSince === null) state.endStableSince = time;
    if (time - state.endStableSince < 750) return;
    if (!state.autoNext) {
      stop("본문의 끝에 도달했습니다.");
      return;
    }
    state.status = "waiting";
    state.waitRemainingMs = state.delaySeconds * 1000;
    state.lastWaitTick = time;
    persist();
    if (state.waitRemainingMs === 0) navigateNext();
  }

  async function navigateNext() {
    if (state.navigating || state.status !== "waiting") return;
    state.navigating = true;
    const next = adapter.inspectNext(document, location);
    if (!next.ok) {
      const messages = {
        "paid-or-locked": "다음 회차가 유료이거나 잠겨 있어 자동 재생을 종료했습니다.",
        "no-next": "접근 가능한 다음 무료 회차를 찾지 못했습니다."
      };
      stop(messages[next.reason] || "다음 회차를 확인할 수 없습니다.");
      return;
    }
    await persist({ status: "playing", resumeAfterNavigation: true, nextUrl: next.url });
    location.assign(next.url);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_STATE") {
      sendResponse(publicState());
      return;
    }
    if (message.type === "PLAY") play();
    if (message.type === "PAUSE") pause();
    if (message.type === "STOP") stop();
    if (message.type === "SETTINGS") {
      state.speed = Math.max(10, Math.min(600, Number(message.settings.speed) || 80));
      state.autoNext = Boolean(message.settings.autoNext);
      state.delaySeconds = Math.max(0, Math.min(10, Number(message.settings.delaySeconds) || 0));
      engine.setSpeed(state.speed);
      persist();
    }
    sendResponse({ ok: true, ...publicState() });
  });

  async function initialize() {
    const settings = await chrome.storage.local.get(defaults);
    Object.assign(state, settings);
    engine.setSpeed(state.speed);
    const response = await chrome.runtime.sendMessage({ type: "CONTENT_READY", page });
    const saved = response?.session;
    if (saved?.seriesId === page.seriesId && ["playing", "waiting"].includes(saved.status)) {
      state.speed = saved.speed ?? state.speed;
      state.autoNext = saved.autoNext ?? state.autoNext;
      state.delaySeconds = saved.delaySeconds ?? state.delaySeconds;
      play();
    } else {
      persist({ resumeAfterNavigation: false });
    }
  }

  initialize().catch(() => stop("초기화 중 오류가 발생했습니다."));
  document.addEventListener("visibilitychange", () => { state.lastWaitTick = null; });
  window.addEventListener("pagehide", () => {
    engine.destroy();
    document.documentElement.style.scrollBehavior = originalScrollBehavior;
  }, { once: true });
})();
