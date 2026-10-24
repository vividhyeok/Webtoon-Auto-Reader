const test = require("node:test"),
  assert = require("node:assert/strict");
const S = require("../shared-settings");
test("이전 속도 설정을 연속형으로 마이그레이션하고 범위를 정규화한다", () => {
  assert.equal(S.normalize({ speed: 120 }).mode, "continuous");
  assert.equal(S.normalize().mode, "step");
  assert.equal(
    S.normalize({ version: 2, readingSeconds: 100, distance: 0, speed: "bad" })
      .readingSeconds,
    6,
  );
  assert.equal(S.normalize({ distance: 0 }).distance, 10);
  assert.equal(S.normalize({ speed: "bad" }).speed, 80);
});
test("템포와 프리셋은 읽기 간격을 조절한다", () => {
  assert.ok(
    S.tempo(S.defaults, 100).readingSeconds <
      S.tempo(S.defaults, 0).readingSeconds,
  );
  assert.equal(S.preset("gaming").mode, "step");
  assert.equal(S.preset("focus").mode, "hybrid");
  assert.equal(S.tempo(S.preset("meal"), 70).preset, "custom");
});
