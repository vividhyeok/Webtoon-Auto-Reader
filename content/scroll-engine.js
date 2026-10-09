(function (root) {
  "use strict";

  class ScrollEngine {
    constructor({ windowObject = window, documentObject = document, getTarget, onFrame }) {
      this.win = windowObject;
      this.doc = documentObject;
      this.getTarget = getTarget;
      this.onFrame = onFrame;
      this.speed = 80;
      this.running = false;
      this.frameId = null;
      this.lastTime = null;
      this.remainder = 0;
      this.tick = this.tick.bind(this);
      this.onVisibility = this.onVisibility.bind(this);
      this.doc.addEventListener("visibilitychange", this.onVisibility);
    }

    setSpeed(value) {
      this.speed = Math.max(10, Math.min(600, Number(value) || 80));
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastTime = null;
      this.schedule();
    }

    pause() {
      this.running = false;
      this.lastTime = null;
      if (this.frameId !== null) this.win.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    stop() {
      this.pause();
      this.remainder = 0;
    }

    schedule() {
      if (this.running && this.frameId === null && !this.doc.hidden) {
        this.frameId = this.win.requestAnimationFrame(this.tick);
      }
    }

    onVisibility() {
      this.lastTime = null;
      if (this.doc.hidden && this.frameId !== null) {
        this.win.cancelAnimationFrame(this.frameId);
        this.frameId = null;
      }
      if (!this.doc.hidden) this.schedule();
    }

    tick(time) {
      this.frameId = null;
      if (!this.running || this.doc.hidden) return;
      if (this.lastTime !== null) {
        const elapsed = Math.min(100, Math.max(0, time - this.lastTime));
        this.remainder += (this.speed * elapsed) / 1000;
        const pixels = Math.floor(this.remainder);
        if (pixels > 0) {
          const target = this.getTarget();
          target.scrollTop += pixels;
          this.remainder -= pixels;
        }
      }
      this.lastTime = time;
      this.onFrame?.(time);
      this.schedule();
    }

    destroy() {
      this.stop();
      this.doc.removeEventListener("visibilitychange", this.onVisibility);
    }
  }

  root.WebtoonScrollEngine = ScrollEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = ScrollEngine;
})(typeof globalThis !== "undefined" ? globalThis : window);
