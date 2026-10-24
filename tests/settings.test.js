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

test("넓어진 이동 거리와 연속 속도를 저장하고 최대값을 제한한다", () => {
  const settings = S.normalize({ version: 2, distance: 300, speed: 2400 });
  assert.equal(settings.distance, 300);
  assert.equal(settings.speed, 2400);
  assert.equal(S.normalize({ distance: 999, speed: 9999 }).distance, 300);
  assert.equal(S.normalize({ distance: 999, speed: 9999 }).speed, 2400);
  assert.equal(S.tempo({ ...S.defaults, mode: "step" }, 100).distance, 300);
  assert.equal(S.tempo({ ...S.defaults, mode: "hybrid" }, 100).distance, 150);
  assert.equal(S.tempo({ ...S.defaults, mode: "continuous" }, 100).speed, 2400);
  assert.equal(S.tempo(S.defaults, 50).distance, 25);
});
