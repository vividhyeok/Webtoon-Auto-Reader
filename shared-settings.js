(function (root) {
  "use strict";
  const defaults = {
    version: 2,
    mode: "step",
    tempo: 50,
    speed: 80,
    autoNext: true,
    delaySeconds: 3,
    distance: 25,
    duration: 280,
    readingSeconds: 2.5,
    curve: "cubic",
    manualPause: true,
    autoResume: false,
    resumeSeconds: 5,
    lastSeconds: 3,
    preset: "custom",
  };
  function normalize(raw = {}) {
    const s = { ...defaults, ...raw };
    if (!raw.version && Object.hasOwn(raw, "speed")) s.mode = "continuous";
    for (const [key, min, max] of [
      ["tempo", 0, 100],
      ["speed", 10, 600],
      ["delaySeconds", 0, 10],
      ["distance", 10, 50],
      ["duration", 100, 800],
      ["readingSeconds", 0.5, 6],
      ["resumeSeconds", 1, 30],
      ["lastSeconds", 0.5, 15],
    ]) {
      const n = Number(s[key]);
      s[key] = Number.isFinite(n)
        ? Math.max(min, Math.min(max, n))
        : defaults[key];
    }
    if (!["continuous", "step", "hybrid"].includes(s.mode)) s.mode = "step";
    if (!["cubic", "linear"].includes(s.curve)) s.curve = "cubic";
    for (const k of ["manualPause", "autoNext", "autoResume"])
      s[k] = Boolean(s[k]);
    return Object.fromEntries(
      Object.keys(defaults).map((k) => [k, k === "version" ? 2 : s[k]]),
    );
  }
  function tempo(settings, value) {
    const t = Math.max(0, Math.min(100, Number(value)));
    const x = t / 100;
    return normalize({
      ...settings,
      version: 2,
      tempo: t,
      preset: "custom",
      speed: Math.round(10 + 590 * x),
      distance: settings.mode === "hybrid" ? 10 + 10 * x : 20 + 10 * x,
      duration: Math.round(400 - 240 * x),
      readingSeconds: settings.mode === "hybrid" ? 1.5 - x : 5 - 4 * x,
    });
  }
  function preset(name) {
    const s = { ...defaults, preset: name };
    if (name === "meal") return { ...s, readingSeconds: 3.5 };
    if (name === "gaming")
      return {
        ...s,
        tempo: 20,
        distance: 20,
        readingSeconds: 5,
        lastSeconds: 6,
      };
    if (name === "focus")
      return {
        ...s,
        mode: "hybrid",
        tempo: 75,
        distance: 15,
        readingSeconds: 0.8,
        duration: 220,
      };
    return s;
  }
  const api = { defaults, normalize, tempo, preset };
  root.ReaderSettings = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
