/** Keep sub-frame precision here: HTML range inputs round values to their step. */
export function createFlightClock(duration = 40) {
  let time = 0;
  return {
    get time() { return time; },
    seek(seconds: number) { time = Math.max(0, Math.min(duration, seconds)); },
    advance(deltaMs: number) {
      // A background-tab interruption should not teleport through the scene.
      time = Math.min(duration, time + Math.max(0, Math.min(deltaMs, 100)) / 1000);
      return time;
    },
  };
}
