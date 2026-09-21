const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Throttle {
  constructor({ minIntervalMs = 2500, now = () => Date.now(), sleep = defaultSleep } = {}) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
    this._now = now;
    this._sleep = sleep;
    this._last = null;
    this._pauseUntil = 0;
    this._chain = Promise.resolve();
  }

  get pausedUntil() {
    return this._pauseUntil;
  }

  pause(seconds) {
    const secs = Math.max(0, Number(seconds) || 0);
    const until = this._now() + secs * 1000;
    if (until > this._pauseUntil) this._pauseUntil = until;
    return until;
  }

  submit(fn) {
    const run = this._chain.then(async () => {
      const readyAt =
        this._last === null ? this._pauseUntil : Math.max(this._pauseUntil, this._last + this.minIntervalMs);
      const wait = readyAt - this._now();
      if (wait > 0) await this._sleep(wait);
      try {
        return await fn();
      } finally {
        this._last = this._now();
      }
    });
    this._chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
