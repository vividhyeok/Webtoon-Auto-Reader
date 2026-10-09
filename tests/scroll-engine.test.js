const test = require("node:test");
const assert = require("node:assert/strict");
const ScrollEngine = require("../content/scroll-engine.js");

function harness() {
  const callbacks = new Map();
  let id = 0;
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const win = {
    requestAnimationFrame(callback) { callbacks.set(++id, callback); return id; },
    cancelAnimationFrame(frameId) { callbacks.delete(frameId); }
  };
  const target = { scrollTop: 0 };
  const engine = new ScrollEngine({ windowObject: win, documentObject: doc, getTarget: () => target });
  function frame(time) {
    const [frameId, callback] = callbacks.entries().next().value;
    callbacks.delete(frameId);
    callback(time);
  }
  return { engine, target, doc, callbacks, frame };
}

test("경과 시간 기준의 px/s 속도와 서브픽셀 누적을 유지한다", () => {
  const h = harness();
  h.engine.setSpeed(80);
  h.engine.start();
  h.frame(0);
  for (let time = 10; time <= 1000; time += 10) h.frame(time);
  assert.equal(h.target.scrollTop, 80);
});

test("중복 start가 애니메이션 루프를 추가하지 않는다", () => {
  const h = harness();
  h.engine.start();
  h.engine.start();
  assert.equal(h.callbacks.size, 1);
});

test("숨겨진 탭에서는 이동하지 않고 복귀 시 시간을 초기화한다", () => {
  const h = harness();
  h.engine.start();
  h.frame(0);
  h.doc.hidden = true;
  h.engine.onVisibility();
  assert.equal(h.callbacks.size, 0);
  h.doc.hidden = false;
  h.engine.onVisibility();
  h.frame(5000);
  assert.equal(h.target.scrollTop, 0);
});
