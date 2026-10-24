"use strict";
window.addEventListener("load", async () => {
  const results = [];
  let listener, storageListener, savedAnchor;
  const pending = new Map();
  let seq = 0,
    time = 0;
  window.requestAnimationFrame = (fn) => {
    pending.set(++seq, fn);
    return seq;
  };
  window.cancelAnimationFrame = (id) => pending.delete(id);
  WebtoonAdapters.naver.parseEpisodeUrl = () => ({ titleId: "1", episode: 1 });
  WebtoonAdapters.naver.getPageInfo = () => ({
    supported: true,
    title: "테스트 웹툰",
    episodeTitle: "1화",
    seriesId: "1",
    episode: 1,
  });
  chrome.storage = {
    local: {
      async get() {
        return {
          ...ReaderSettings.defaults,
          lastSeconds: 0.5,
          autoNext: false,
        };
      },
    },
    onChanged: {
      addListener(f) {
        storageListener = f;
      },
      removeListener() {},
    },
  };
  chrome.runtime = {
    onMessage: {
      addListener(f) {
        listener = f;
      },
      removeListener() {},
    },
    async sendMessage(m) {
      if (m.type === "BOOKMARK_ADD") {
        savedAnchor = m.item.anchor;
        return { ok: true, item: { id: "fixture-scene" } };
      }
      return m.type === "CONTENT_READY" ? { session: null } : { ok: true };
    },
  };
  const script = document.createElement("script");
  script.src = "../../content/content.js";
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const cmd = (m) => new Promise((resolve) => listener(m, {}, resolve));
  function assert(ok, label) {
    if (!ok) throw Error(label);
    results.push(label);
  }
  function frames(n) {
    for (let i = 0; i < n; i++) {
      time += 20;
      const entry = pending.entries().next().value;
      if (entry) {
        pending.delete(entry[0]);
        entry[1](time);
      }
    }
  }
  try {
    await cmd({ type: "PLAY" });
    window.dispatchEvent(new Event("blur"));
    frames(16);
    assert(
      (await cmd({ type: "GET_STATE" })).phase === "READING",
      "MOVING → READING",
    );
    await cmd({ type: "BOOKMARK" });
    const pos = scrollY;
    frames(20);
    assert(scrollY === pos, "읽기 중 화면 고정");
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    assert(
      (await cmd({ type: "GET_STATE" })).status === "paused",
      "수동 휠 즉시 일시정지",
    );
    assert(pending.size === 0, "애니메이션 취소");
    await cmd({ type: "REWIND", count: 1 });
    assert(scrollY === 0, "이전 위치 복귀");
    await cmd({ type: "RESTORE", anchor: savedAnchor });
    assert(Math.abs(scrollY - pos) < 2, "이미지 상대 위치 북마크 복귀");
    storageListener(
      { mode: { newValue: "continuous" }, speed: { newValue: 600 } },
      "local",
    );
    await cmd({ type: "PLAY" });
    frames(260);
    const ended = await cmd({ type: "GET_STATE" });
    assert(ended.status === "stopped", "마지막 컷 대기 후 종료");
    const last = document.querySelector("img").getBoundingClientRect();
    assert(
      last.bottom >= innerHeight - 25 && last.bottom <= innerHeight + 2,
      "댓글로 넘어가지 않는 본문 경계",
    );
    // Remove the body images while playing: the controller must hold its position.
    await cmd({ type: "PLAY" });
    const bodyImage = document.querySelector("#sectionContWide img");
    document.querySelector("#sectionContWide").replaceChildren();
    const before = scrollY;
    frames(30);
    assert(scrollY === before, "DOM 본문 제거 시 안전 정지");
    frames(1100);
    assert(
      (await cmd({ type: "GET_STATE" })).status === "stopped",
      "본문 누락 타임아웃",
    );
    document.querySelector("#sectionContWide").append(bodyImage);
    scrollTo(0, 0);
    Object.defineProperty(bodyImage, "complete", {
      configurable: true,
      value: false,
    });
    await cmd({ type: "PLAY" });
    frames(40);
    assert(scrollY === 0, "이미지 준비 전 이동 보류");
    Object.defineProperty(bodyImage, "complete", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(bodyImage, "naturalHeight", {
      configurable: true,
      value: 0,
    });
    frames(300);
    assert(
      (await cmd({ type: "GET_STATE" })).status === "stopped",
      "실패 이미지로 영구 대기하지 않음",
    );
    await SceneDB.run("readwrite", "fixture", "data:image/png;base64,AA==");
    assert(
      (await SceneDB.run("readonly", "fixture")) ===
        "data:image/png;base64,AA==",
      "IndexedDB 이미지 저장과 조회",
    );
    await SceneDB.run("readwrite", "fixture", null);
    assert(
      (await SceneDB.run("readonly", "fixture")) === undefined,
      "IndexedDB 이미지 삭제",
    );
    document.getElementById("results").textContent =
      "PASS: " + results.join(" | ");
  } catch (e) {
    document.getElementById("results").textContent = "FAIL: " + e.message;
  }
});
