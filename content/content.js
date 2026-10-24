(function () {
  "use strict";
  if (globalThis.__webtoonAutoReaderLoaded) return;
  globalThis.__webtoonAutoReaderLoaded = true;
  const adapter = WebtoonAdapters.naver,
    page = adapter.getPageInfo(document, location);
  if (!page.supported) return;
  let settings = ReaderSettings.normalize(),
    status = "stopped",
    message = "",
    wait = 0,
    phase = "",
    resumeTimer,
    restoreTimer,
    readySince = null,
    endSince = null,
    disposed = false,
    images = [],
    lastScan = 0;
  const original = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  const target = () => adapter.getScrollElement(document);
  function scan(time) {
    if (time - lastScan > 500 || !images.length) {
      images = adapter.getImages(document);
      lastScan = time;
    }
  }
  function limit() {
    const last = images.at(-1);
    return last
      ? Math.max(
          0,
          target().scrollTop +
            last.getBoundingClientRect().bottom -
            window.innerHeight +
            24,
        )
      : target().scrollTop;
  }
  const engine = new WebtoonScrollEngine({
    getTarget: target,
    getLimit: limit,
    onFrame: frame,
    onState(s) {
      if (s === "BLOCKED")
        stop("더 이상 이동할 수 없어 멈췄습니다. 본문 로딩을 확인해 주세요.");
    },
  });
  function publicState() {
    return {
      ...settings,
      supported: true,
      status,
      phase:
        status === "playing"
          ? engine.state
          : status === "waiting"
            ? "WAITING_NEXT"
            : status.toUpperCase(),
      waitRemaining: Math.ceil(wait / 1000),
      title: page.title,
      episodeTitle: page.episodeTitle,
      seriesId: page.seriesId,
      episode: page.episode,
      url: location.href,
      message,
      hidden: document.hidden,
    };
  }
  function persist(extra = {}) {
    return chrome.runtime
      .sendMessage({
        type: "SESSION_UPDATE",
        patch: { ...publicState(), ...extra },
      })
      .catch(() => {});
  }
  function samePage() {
    const current = adapter.parseEpisodeUrl(location.href);
    return (
      current?.titleId === page.seriesId && current.episode === page.episode
    );
  }
  function play() {
    if (!samePage()) {
      stop("회차가 변경되었습니다. 페이지를 새로고침해 주세요.");
      return;
    }
    clearTimeout(restoreTimer);
    clearTimeout(resumeTimer);
    resumeTimer = null;
    if (status === "playing" || status === "waiting") return;
    status = status === "paused-waiting" ? "waiting" : "playing";
    message = "";
    engine.start();
    persist();
  }
  function pause() {
    clearTimeout(restoreTimer);
    clearTimeout(resumeTimer);
    resumeTimer = null;
    if (["stopped", "paused", "paused-waiting"].includes(status)) return;
    status = status === "waiting" ? "paused-waiting" : "paused";
    engine.pause();
    persist();
  }
  function stop(text = "") {
    clearTimeout(restoreTimer);
    clearTimeout(resumeTimer);
    resumeTimer = null;
    status = "stopped";
    wait = 0;
    phase = "";
    endSince = null;
    readySince = null;
    engine.stop();
    message = text;
    persist({ resumeAfterNavigation: false, nextUrl: null });
  }
  function frame(time, dt) {
    if (!samePage()) {
      stop("회차가 변경되었습니다. 페이지를 새로고침해 주세요.");
      return false;
    }
    if (status === "waiting") {
      wait = Math.max(0, wait - dt);
      if (wait === 0) {
        if (phase === "last") {
          if (!settings.autoNext) stop("본문 감상을 마쳤습니다.");
          else {
            phase = "next";
            wait = settings.delaySeconds * 1000;
          }
        } else navigate();
      }
      return false;
    }
    if (status !== "playing") return false;
    scan(time);
    if (!images.length) {
      readySince ??= time;
      if (time - readySince > 20000)
        stop("웹툰 본문을 찾을 수 없습니다. 페이지를 새로고침해 주세요.");
      return false;
    }
    const visible = images.filter((img) => {
      const r = img.getBoundingClientRect();
      return r.bottom >= 0 && r.top < window.innerHeight * 1.5;
    });
    if (visible.some((img) => !img.complete)) {
      readySince ??= time;
      message = "이미지를 불러오는 중입니다…";
      if (time - readySince < 12000) return false;
      message = "일부 이미지 로딩이 지연되어 계속 감상합니다.";
    } else {
      readySince = null;
      message = images.some((i) => i.complete && !i.naturalHeight)
        ? "일부 이미지를 불러오지 못했습니다."
        : "";
    }
    if (target().scrollTop >= limit() - 1) {
      endSince ??= time;
      if (time - endSince >= 500) {
        status = "waiting";
        phase = "last";
        wait = settings.lastSeconds * 1000;
        persist();
      }
      return false;
    }
    endSince = null;
    return true;
  }
  async function navigate() {
    if (!settings.autoNext) {
      stop("자동 이동을 껐습니다. 본문 감상을 마쳤습니다.");
      return;
    }
    if (phase === "navigating") return;
    phase = "navigating";
    const next = adapter.inspectNext(document, location);
    if (!next.ok) {
      stop(
        next.reason === "paid-or-locked"
          ? "다음 회차가 유료이거나 잠겨 있습니다."
          : "다음 무료 회차를 확인할 수 없어 감상을 마쳤습니다.",
      );
      return;
    }
    await persist({
      status: "playing",
      resumeAfterNavigation: true,
      nextUrl: next.url,
    });
    if (status === "waiting" && phase === "navigating")
      location.assign(next.url);
  }
  function manual(event) {
    clearTimeout(restoreTimer);
    if (
      event.type === "keydown" &&
      (![
        "ArrowDown",
        "ArrowUp",
        "PageDown",
        "PageUp",
        "Home",
        "End",
        " ",
      ].includes(event.key) ||
        event.target.closest?.("input,textarea,select,[contenteditable]"))
    )
      return;
    if (!["playing", "waiting"].includes(status)) {
      if (resumeTimer && ["paused", "paused-waiting"].includes(status)) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
        resumeTimer = setTimeout(play, settings.resumeSeconds * 1000);
      }
      return;
    }
    if (settings.manualPause) {
      pause();
      message = "직접 조작하여 일시정지했습니다.";
      if (settings.autoResume)
        resumeTimer = setTimeout(play, settings.resumeSeconds * 1000);
    } else {
      engine.segment = null;
      engine.elapsed = 0;
      engine.lastTime = null;
      engine.yieldFrames = 2;
    }
  }
  function scrollInput() {
    if (
      engine.expectedTop !== undefined &&
      Math.abs(target().scrollTop - engine.expectedTop) > 2
    )
      manual({ type: "scroll" });
  }
  function pointer(e) {
    if (
      e.pointerType === "touch" ||
      e.clientX >= document.documentElement.clientWidth - 18
    )
      manual(e);
  }
  function anchor() {
    scan(performance.now());
    let index = images.findIndex((i) => i.getBoundingClientRect().bottom > 0);
    if (index < 0) index = images.length - 1;
    const r = images[index]?.getBoundingClientRect();
    return {
      index,
      ratio: r && r.height ? -r.top / r.height : 0,
      scrollTop: target().scrollTop,
    };
  }
  function restore(a) {
    scan(performance.now());
    const img = images[a?.index];
    if (img) {
      const r = img.getBoundingClientRect();
      target().scrollTop += r.top + r.height * (Number(a.ratio) || 0);
    } else target().scrollTop = Number(a?.scrollTop) || 0;
  }
  async function bookmark() {
    if (!samePage()) throw Error("회차를 새로고침한 뒤 저장해 주세요.");
    const result = await chrome.runtime.sendMessage({
      type: "BOOKMARK_ADD",
      item: {
        title: page.title,
        episodeTitle: page.episodeTitle,
        seriesId: page.seriesId,
        episode: page.episode,
        url: location.href,
        anchor: anchor(),
        tags: "",
        note: "",
      },
    });
    if (!result.ok) throw Error(result.error);
    message = result.ok ? "장면 위치를 저장했습니다." : result.error;
    return result;
  }
  async function handle(m) {
    if (m.type === "PLAY") play();
    if (m.type === "PAUSE") pause();
    if (m.type === "STOP") stop();
    if (m.type === "TOGGLE")
      (["playing", "waiting"].includes(status) ? pause : play)();
    if (m.type === "REWIND") {
      pause();
      engine.rewind(m.count || 1);
      endSince = null;
      wait = 0;
      status = "paused";
    }
    let bookmarkId;
    if (m.type === "BOOKMARK") bookmarkId = (await bookmark()).item.id;
    if (m.type === "RESTORE") {
      pause();
      status = "paused";
      restore(m.anchor);
    }
    return { ok: true, ...publicState(), bookmarkId };
  }
  const listener = (m, s, reply) => {
    handle(m)
      .then(reply)
      .catch(() => reply({ ok: false, error: "요청을 처리하지 못했습니다." }));
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  function storage(changes, area) {
    if (area !== "local") return;
    const patch = {};
    for (const k of Object.keys(ReaderSettings.defaults))
      if (changes[k]) patch[k] = changes[k].newValue;
    if (Object.keys(patch).length) {
      settings = ReaderSettings.normalize({ ...settings, ...patch });
      engine.configure(settings);
      if (status === "waiting")
        wait = Math.min(
          wait,
          (phase === "last" ? settings.lastSeconds : settings.delaySeconds) *
            1000,
        );
      persist();
    }
  }
  chrome.storage.onChanged.addListener(storage);
  function shortcut(e) {
    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.target.closest?.("input,textarea,select,[contenteditable]")
    ) {
      const type = { p: "TOGGLE", b: "BOOKMARK", z: "REWIND" }[
        e.key.toLowerCase()
      ];
      if (type) {
        e.preventDefault();
        handle({ type });
      }
    }
  }
  window.addEventListener("scroll", scrollInput, { passive: true });
  window.addEventListener("wheel", manual, { passive: true });
  window.addEventListener("touchstart", manual, { passive: true });
  window.addEventListener("pointerdown", pointer, { passive: true });
  window.addEventListener("keydown", manual);
  window.addEventListener("keydown", shortcut);
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) {
      pause();
      return;
    }
    disposed = true;
    clearTimeout(resumeTimer);
    resumeTimer = null;
    clearTimeout(restoreTimer);
    engine.destroy();
    chrome.runtime.onMessage.removeListener(listener);
    chrome.storage.onChanged.removeListener(storage);
    window.removeEventListener("scroll", scrollInput);
    window.removeEventListener("wheel", manual);
    window.removeEventListener("touchstart", manual);
    window.removeEventListener("pointerdown", pointer);
    window.removeEventListener("keydown", manual);
    window.removeEventListener("keydown", shortcut);
    document.documentElement.style.scrollBehavior = original;
  });
  (async () => {
    settings = ReaderSettings.normalize(await chrome.storage.local.get(null));
    engine.configure(settings);
    const response = await chrome.runtime.sendMessage({
      type: "CONTENT_READY",
      page: { ...page, url: location.href },
    });
    if (disposed) return;
    const saved = response?.session;
    if (response?.anchor) {
      status = "paused";
      let attempts = 0;
      function restoreWhenReady() {
        if (disposed) return;
        scan(performance.now());
        const img = images[response.anchor.index];
        if (
          (img?.complete && img.getBoundingClientRect().height > 0) ||
          attempts++ >= 48
        ) {
          restore(response.anchor);
          return;
        }
        restoreTimer = setTimeout(restoreWhenReady, 250);
      }
      restoreWhenReady();
    } else if (
      saved &&
      saved.seriesId === page.seriesId &&
      saved.episode === page.episode &&
      ["playing", "waiting"].includes(saved.status)
    )
      play();
    persist();
  })().catch(() =>
    stop("초기화에 실패했습니다. 확장 프로그램을 다시 로드해 주세요."),
  );
})();
