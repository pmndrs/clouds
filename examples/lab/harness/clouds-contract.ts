/**
 * The window.__clouds contract read by scripts/gpu/capture.mjs.
 * Pages call ready() once their first frame is renderable, frame() once per rendered frame,
 * and may provide bookmarks (named camera/scene states) and a report() of timings.
 */
export interface CloudsHarnessOptions {
  report?: () => unknown;
  bookmark?: (name: string) => void | Promise<void>;
}
export interface CloudsHarness {
  ready(options?: CloudsHarnessOptions): void;
  fail(message: string): void;
  frame(): void;
}
declare global { interface Window { __clouds?: Record<string, unknown> } }

export function installCloudsHarness(): CloudsHarness {
  let frames = 0;
  const waiters: { target: number; resolve: () => void }[] = [];
  const state: Record<string, unknown> = { ready: false };
  window.__clouds = state;
  window.addEventListener('error', e => { state.error ??= e.message; });
  window.addEventListener('unhandledrejection', e => { state.error ??= String(e.reason?.message ?? e.reason); });
  return {
    ready(options = {}) {
      state.report = options.report;
      state.bookmark = options.bookmark;
      state.settle = (n: number) => new Promise<void>(resolve => waiters.push({ target: frames + n, resolve }));
      state.ready = true;
    },
    fail(message) { state.error = message; },
    frame() {
      frames++;
      for (let i = waiters.length - 1; i >= 0; i--) if (frames >= waiters[i].target) { waiters[i].resolve(); waiters.splice(i, 1); }
    },
  };
}
