(function (root) {
  "use strict";
  class ScrollEngine {
    constructor({
      windowObject = window,
      documentObject = document,
      getTarget,
      onFrame,
      getLimit,
      onState,
    }) {
      Object.assign(this, {
        win: windowObject,
        doc: documentObject,
        getTarget,
        onFrame,
        getLimit,
        onState,
        speed: 80,
        mode: "continuous",
        distance: 25,
        duration: 280,
        readingSeconds: 2.5,
        curve: "cubic",
        running: false,
        frameId: null,
        lastTime: null,
        state: "STOPPED",
        history: [],
        elapsed: 0,
        blocked: 0,
      });
      this.onResize = () => {
        this.segment = null;
        if (this.state === "MOVING") this.elapsed = 0;
      };
      this.win.addEventListener?.("resize", this.onResize);
      this.tick = this.tick.bind(this);
      this.onVisibility = this.onVisibility.bind(this);
      this.doc.addEventListener("visibilitychange", this.onVisibility);
    }
    transition(s) {
      if (this.state !== s) {
        this.state = s;
        this.onState?.(s);
      }
    }
    configure(s) {
      this.blocked = 0;
      this.pausedState = null;
      Object.assign(
        this,
        Object.fromEntries(
          ["mode", "distance", "duration", "readingSeconds", "curve"]
            .filter((k) => k in s)
            .map((k) => [k, s[k]]),
        ),
      );
      if ("speed" in s) this.setSpeed(s.speed);
      this.elapsed = 0;
      this.segment = null;
      if (this.running) this.transition("MOVING");
    }
    setSpeed(v) {
      this.speed = Math.max(10, Math.min(600, Number(v) || 80));
    }
    remember(y) {
      if (this.history.at(-1) !== y) {
        this.history.push(y);
        if (this.history.length > 200) this.history.shift();
      }
    }
    rewind(count = 1) {
      this.pause();
      const index = Math.max(0, this.history.length - count);
      const y = this.history[index];
      if (y !== undefined) {
        this.getTarget().scrollTop = y;
        this.history.splice(index);
      }
      this.segment = null;
      return y;
    }
    start() {
      if (this.running) return;
      const reading = this.state === "PAUSED" && this.pausedState === "READING";
      this.blocked = 0;
      this.running = true;
      this.lastTime = null;
      this.segment = null;
      if (!reading) this.elapsed = 0;
      this.expectedTop = this.getTarget().scrollTop;
      this.transition(reading ? "READING" : "MOVING");
      this.schedule();
    }
    pause() {
      if (this.running) this.pausedState = this.state;
      this.running = false;
      this.lastTime = null;
      if (this.frameId !== null) this.win.cancelAnimationFrame(this.frameId);
      this.frameId = null;
      this.segment = null;
      this.transition("PAUSED");
    }
    stop() {
      this.pause();
      this.transition("STOPPED");
    }
    schedule() {
      if (this.running && this.frameId === null && !this.doc.hidden)
        this.frameId = this.win.requestAnimationFrame(this.tick);
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
      const elapsed =
        this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
      const dt = Math.min(50, elapsed);
      this.lastTime = time;
      // The controller checks image readiness and the body boundary before any movement.
      let allowed = this.onFrame?.(time, elapsed) !== false;
      if (this.yieldFrames > 0) {
        this.yieldFrames--;
        allowed = false;
      }
      if (this.running && allowed) {
        const target = this.getTarget();
        const y = target.scrollTop;
        const physical = Number.isFinite(target.scrollHeight)
          ? Math.max(
              0,
              target.scrollHeight -
                (target.clientHeight || this.win.innerHeight || 0),
            )
          : Infinity;
        const limit = Math.min(physical, this.getLimit?.() ?? Infinity);
        const attemptedMove =
          this.mode === "continuous" || this.state !== "READING";
        if (this.mode === "continuous") {
          if (
            !this.history.length ||
            time - (this.sampleTime ?? -Infinity) >= 1500
          ) {
            this.remember(y);
            this.sampleTime = time;
          }
          target.scrollTop = Math.min(limit, y + (this.speed * dt) / 1000);
        } else if (this.state === "READING") {
          this.elapsed += elapsed;
          if (this.elapsed >= this.readingSeconds * 1000) {
            this.elapsed = 0;
            this.segment = null;
            this.transition("MOVING");
          }
        } else {
          if (!this.segment) {
            this.remember(y);
            this.segment = {
              from: y,
              to: Math.min(
                limit,
                y + ((this.win.innerHeight || 800) * this.distance) / 100,
              ),
            };
            this.elapsed = 0;
          }
          this.elapsed += dt;
          const p = Math.min(1, this.elapsed / this.duration);
          const eased = this.curve === "linear" ? p : 1 - (1 - p) ** 3;
          target.scrollTop = Math.min(
            limit,
            this.segment.from + (this.segment.to - this.segment.from) * eased,
          );
          if (p === 1) {
            this.elapsed = 0;
            this.segment = null;
            this.transition("READING");
          }
        }
        this.expectedTop = target.scrollTop;
        if (attemptedMove && dt > 0 && Math.abs(target.scrollTop - y) < 0.01)
          this.blocked += dt;
        else if (Math.abs(target.scrollTop - y) >= 0.01) this.blocked = 0;
        if (this.blocked > 2000) {
          this.pause();
          this.onState?.("BLOCKED");
        }
      }
      this.schedule();
    }
    destroy() {
      this.stop();
      this.doc.removeEventListener("visibilitychange", this.onVisibility);
      this.win.removeEventListener?.("resize", this.onResize);
    }
  }
  root.WebtoonScrollEngine = ScrollEngine;
  if (typeof module !== "undefined") module.exports = ScrollEngine;
})(globalThis);
