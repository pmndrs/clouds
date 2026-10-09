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


/** Visible failure overlay: pages must never fail to a black screen (iOS Safari has no console in the way). */
const overlayLines: string[] = [];
let overlayEl: HTMLPreElement | undefined;
function describeGpu(): string {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  const ua = navigator.userAgent.replace(/^Mozilla\/5.0 /, '');
  if (!gpu) return `navigator.gpu: MISSING (WebGPU unavailable)\n${ua}`;
  return `navigator.gpu: present, preferred format ${gpu.getPreferredCanvasFormat?.()}\n${ua}`;
}
/** `?logto=http://host:port` mirrors overlay messages (and READY) to a listener, for devices with no console (iOS simulator, Safari on a phone). */
function beacon(message: string): void {
  try {
    const target = new URLSearchParams(location.search).get('logto');
    if (target) new Image().src = `${target}/log?${encodeURIComponent(message.slice(0, 1800))}`;
  } catch { /* logging must never throw */ }
}
export function showErrorOverlay(message: string): void {
  if (overlayLines.includes(message)) return;
  overlayLines.push(message);
  beacon(message);
  const show = () => {
    if (!overlayEl) {
      overlayEl = document.createElement('pre');
      overlayEl.id = 'clouds-error-overlay';
      overlayEl.style.cssText = 'position:fixed;inset:0;z-index:2147483647;margin:0;padding:16px;overflow:auto;background:rgba(20,0,0,.92);color:#ffb4a8;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word';
      document.body.appendChild(overlayEl);
    }
    overlayEl.textContent = `CLOUDS ERROR\n${describeGpu()}\n\n${overlayLines.join('\n\n')}`;
  };
  if (document.body) show(); else addEventListener('DOMContentLoaded', show, { once: true });
}
const errText = (e: unknown) => e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}` : String(e);
if (typeof window !== 'undefined') {
  window.addEventListener('error', e => showErrorOverlay(`${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', e => showErrorOverlay(`Unhandled rejection: ${errText(e.reason)}`));
  // WGSL compile and validation errors surface as uncaptured device errors (and may never reach console.error).
  const proto = (globalThis as { GPUAdapter?: { prototype: GPUAdapter } }).GPUAdapter?.prototype;
  if (proto) {
    const requestDevice = proto.requestDevice;
    proto.requestDevice = async function (this: GPUAdapter, descriptor?: GPUDeviceDescriptor) {
      const device = await requestDevice.call(this, descriptor);
      device.addEventListener('uncapturederror', e => showErrorOverlay(`GPU error: ${(e as GPUUncapturedErrorEvent).error.message}`));
      device.lost.then(info => showErrorOverlay(`GPU device lost: ${info.reason} ${info.message}`));
      return device;
    };
  }
  // three.js and the runtime report shader and pipeline failures through console.error.
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => { consoleError(...args); showErrorOverlay(`console.error: ${args.map(errText).join(' ').slice(0, 1500)}`); };
}

/** Names the root cause up front: three silently falls back to WebGL without an adapter and then fails with an unrelated message. */
function preflightWebGpu(): void {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) { showErrorOverlay('WebGPU unavailable: navigator.gpu is missing. Needs Safari 26+, Chrome 113+ or Firefox 141+, over https or localhost.'); return; }
  gpu.requestAdapter().then(adapter => {
    if (!adapter) showErrorOverlay('WebGPU unavailable: navigator.gpu.requestAdapter() returned null. The iOS Simulator and some VMs or blocklisted GPUs do this; use a physical device.');
  }, error => showErrorOverlay(`WebGPU requestAdapter failed: ${errText(error)}`));
}
export function installCloudsHarness(): CloudsHarness {
  let frames = 0;
  const waiters: { target: number; resolve: () => void }[] = [];
  const state: Record<string, unknown> = { ready: false };
  window.__clouds = state;
  preflightWebGpu();
  window.addEventListener('error', e => { state.error ??= e.message; });
  window.addEventListener('unhandledrejection', e => { state.error ??= String(e.reason?.message ?? e.reason); });
  return {
    ready(options = {}) {
      state.report = options.report;
      state.bookmark = options.bookmark;
      state.settle = (n: number) => new Promise<void>(resolve => waiters.push({ target: frames + n, resolve }));
      state.ready = true;
      beacon('READY');
    },
    fail(message) { state.error = message; showErrorOverlay(message); },
    frame() {
      frames++;
      for (let i = waiters.length - 1; i >= 0; i--) if (frames >= waiters[i].target) { waiters[i].resolve(); waiters.splice(i, 1); }
    },
  };
}
