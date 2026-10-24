const test = require("node:test");
const assert = require("node:assert/strict");
const ScrollEngine = require("../content/scroll-engine.js");

function harness() {
  const callbacks = new Map();
  let id = 0;
  const doc = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    requestAnimationFrame(callback) {
      callbacks.set(++id, callback);
      return id;
    },
    cancelAnimationFrame(frameId) {
      callbacks.delete(frameId);
    },
  };
  const target = { scrollTop: 0 };
  const engine = new ScrollEngine({
    windowObject: win,
    documentObject: doc,
    getTarget: () => target,
  });
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
  assert.ok(Math.abs(h.target.scrollTop - 80) < 0.000001);
});

test("저속에서도 프레임 이동량을 정수 픽셀로 반올림하지 않는다", () => {
  const h = harness();
  h.engine.setSpeed(80);
  h.engine.start();
  h.frame(0);
  h.frame(1000 / 60);
  assert.ok(h.target.scrollTop > 1 && h.target.scrollTop < 2);
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

test("읽기형은 정확한 거리만 이동한 뒤 정지하여 읽는다", () => {
  const h = harness();
  h.engine.win.innerHeight = 800;
  h.engine.configure({
    mode: "step",
    distance: 25,
    duration: 280,
    readingSeconds: 0.5,
  });
  h.engine.start();
  h.frame(0);
  for (let t = 20; t <= 280; t += 20) h.frame(t);
  assert.equal(h.target.scrollTop, 200);
  assert.equal(h.engine.state, "READING");
  for (let t = 300; t <= 760; t += 20) h.frame(t);
  assert.equal(h.target.scrollTop, 200);
  h.frame(780);
  assert.equal(h.engine.state, "MOVING");
});
test("프레임 지연과 일시정지는 이동량을 폭증시키지 않는다", () => {
  const h = harness();
  h.engine.configure({ mode: "step", distance: 25, duration: 800 });
  h.engine.start();
  h.frame(0);
  h.frame(10000);
  assert.ok(h.target.scrollTop < 50);
  h.engine.pause();
  const y = h.target.scrollTop;
  assert.equal(h.callbacks.size, 0);
  h.engine.start();
  h.frame(20000);
  assert.equal(h.target.scrollTop, y);
});
test("이전 1회와 3회 위치로 돌아가며 기록은 제한된다", () => {
  const h = harness();
  for (let i = 0; i < 300; i++) h.engine.remember(i * 100);
  assert.equal(h.engine.history.length, 200);
  h.engine.rewind(3);
  assert.equal(h.target.scrollTop, 29700);
  assert.equal(h.engine.state, "PAUSED");
  h.engine.rewind();
  assert.equal(h.target.scrollTop, 29600);
});
test("본문 경계와 실제 스크롤 범위를 넘지 않는다", () => {
  const h = harness();
  h.target.scrollHeight = 1000;
  h.target.clientHeight = 800;
  h.engine.getLimit = () => 100;
  h.engine.setSpeed(600);
  h.engine.start();
  h.frame(0);
  for (let t = 50; t <= 1000; t += 50) h.frame(t);
  assert.equal(h.target.scrollTop, 100);
});
test("대기 컨트롤러가 이동을 금지하면 스크롤하지 않는다", () => {
  const h = harness();
  h.engine.onFrame = () => false;
  h.engine.start();
  h.frame(0);
  h.frame(50);
  assert.equal(h.target.scrollTop, 0);
});
test("이동 중 설정 변경과 화면 높이 변경을 즉시 적용한다", () => {
  const h = harness();
  h.engine.win.innerHeight = 1000;
  h.engine.configure({ mode: "step", distance: 10, duration: 100 });
  h.engine.start();
  h.frame(0);
  h.frame(50);
  h.engine.configure({ distance: 50, duration: 100 });
  h.engine.win.innerHeight = 400;
  const y = h.target.scrollTop;
  h.frame(100);
  h.frame(150);
  assert.equal(h.target.scrollTop, y + 200);
  h.engine.destroy();
  assert.equal(h.callbacks.size, 0);
});

test("읽기 중 일시정지하면 남은 읽기 시간을 이어간다", () => {
  const h = harness();
  h.engine.configure({ mode: "step", duration: 100, readingSeconds: 0.5 });
  h.engine.start();
  h.frame(0);
  h.frame(50);
  h.frame(100);
  h.frame(300);
  assert.equal(h.engine.elapsed, 200);
  h.engine.pause();
  h.engine.start();
  h.frame(5000);
  assert.equal(h.engine.state, "READING");
  h.frame(5300);
  assert.equal(h.engine.state, "MOVING");
});
test("이동 불가능한 대상은 안전하게 중단한다", () => {
  const h = harness();
  Object.defineProperty(h.target, "scrollTop", { get: () => 0, set() {} });
  h.engine.start();
  h.frame(0);
  for (let t = 50; t <= 2100 && h.engine.running; t += 50) h.frame(t);
  assert.equal(h.engine.running, false);
});
