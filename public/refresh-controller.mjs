export function createRefreshController({ read, apply, isVisible, intervalMs = 60000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let running = false, timer = null, inFlight = null, generation = 0, flightGeneration = 0;
  function clearScheduled() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule() {
    clearScheduled();
    if (running && isVisible() && !inFlight) timer = setTimer(() => { timer = null; return refresh(); }, intervalMs);
  }
  function refresh() {
    if (!running || !isVisible()) return Promise.resolve();
    clearScheduled();
    if (inFlight) return flightGeneration === generation ? inFlight : inFlight.then(refresh);
    const owner = generation;
    flightGeneration = owner;
    inFlight = Promise.resolve().then(read).then((value) => {
      if (running && owner === generation && isVisible()) apply(value);
    }).catch(() => {}).finally(() => { inFlight = null; schedule(); });
    return inFlight;
  }
  return {
    start() { if (running) return; running = true; generation++; schedule(); },
    stop() { running = false; generation++; clearScheduled(); },
    visibilityChanged() { if (!isVisible()) { clearScheduled(); return Promise.resolve(); } return refresh(); },
    online: refresh,
  };
}
