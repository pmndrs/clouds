// The sky inside the <Canvas>: R3F makes the renderer, scene and camera; the compare page's pane (../../compare/panes/ours.ts) sets them up
// and drives them exactly as the vanilla bench does. No JSX sky: the setup is imperative and the per-frame work is three scheduler jobs:
//   input   'bench-rig'     the camera rig (WASD QE, drag)
//   update  'bench-sky'     pane.update: camera, sun, coverage, sky.update
//   render  (R3F's job)     pane.present through setRenderOverride: the post pipeline (clouds over the scene pass), GPU timestamps
//   finish  'bench-finish'  the harness's frame count, the HUD text, ready
import { useEffect } from 'react';
import { setRenderOverride, useFrame, useStore as useRootStore, useThree, type RootStore } from '@react-three/fiber';
import type { PerspectiveCamera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createOursPane } from '../../compare/panes/ours';
import { createHzdTuner } from '../tune';
import type { CloudsHarness } from '../../harness/clouds-contract';
import { applySettingOverrides, paneQuery, type Sources } from '../bench/url';
import { START_QUERY, bench, bookmark, scheduleUrl, setRef, settingsChanged, viewChanged, type BenchRuntime } from '../bench/store';
import { VIEWS } from '../bench/views';
import { weatherFromQuery, weatherTick } from '../bench/weather';
import { startStyle } from '../bench/style';

/** One sky per renderer: StrictMode and Fast Refresh remount components, but the pane attaches to the scene and lives as long as the page. */
const started = new WeakMap<WebGPURenderer, Promise<BenchRuntime>>();

function startSky(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): Promise<BenchRuntime> {
  let p = started.get(renderer);
  if (p) return p;
  p = (async () => {
    const query = START_QUERY;
    const pane = createOursPane(renderer.domElement as HTMLCanvasElement, paneQuery(query, bench.getState().quality), { model: 'procedural', shaper: 'hzd' }, { renderer, scene, camera });
    await pane.init();
    const { clouds, proc } = pane.internals();
    if (!proc) throw new Error('the procedural model did not start');
    const core = clouds.core;
    const sources: Sources = {
      proc: proc.settings as unknown as Record<string, unknown>,
      hzd: proc.settings.hzd as unknown as Record<string, unknown>,
      ndf: proc.settings.hzd.ndf as unknown as Record<string, unknown>,
      c: core.settings as unknown as Record<string, unknown>,
      sky: core.skyLayer.settings as unknown as Record<string, unknown>,
      cirrus: core.cirrus.settings as unknown as Record<string, unknown>,
      shadow: core.shadowMap.settings as unknown as Record<string, unknown>,
    };
    const get = bench.getState;
    const tuner = createHzdTuner({
      sources,
      onChange: () => settingsChanged(),
      view: () => { const { view, viewName } = get(); return { name: viewName, position: [...view.position], lookAz: view.lookAz, pitch: view.pitch, fov: view.fov, sunEl: view.sunEl, sunAz: view.sunAz, coverage: view.coverage, exposure: view.exposure }; },
      applyView: v => {
        const s = get();
        if (VIEWS[v.name]) bench.setState({ viewName: v.name });
        Object.assign(s.view, { position: [...v.position], lookAz: v.lookAz, pitch: v.pitch, fov: v.fov, sunEl: v.sunEl, sunAz: v.sunAz, coverage: v.coverage, exposure: v.exposure });
        viewChanged();
      },
      ref: () => get().ref.id,
      setRef: id => setRef(id, false),
    });
    // The tuner's starting values are the code defaults; the URL's overrides go on top (so a link's changes show amber).
    tuner.start();
    startStyle(sources, tuner, bench.getState().style);   // S1: the look first, so a link's own setting keys win over it
    applySettingOverrides(query, sources);
    tuner.refresh();
    weatherFromQuery(query);
    (window as unknown as { __tune: unknown }).__tune = tuner;
    (window as unknown as { __hzd: unknown }).__hzd = { core, proc };   // console / capture scripts: settings, shadow map info, the procedural model
    (window as unknown as { __proc: unknown }).__proc = proc;   // debug: window.__proc.readHzdBounds()
    return { pane, clouds, proc, core, sources, renderer, tuner };
  })();
  started.set(renderer, p);
  return p;
}

export function SkyHost({ harness }: { harness: CloudsHarness }) {
  const root = useRootStore() as RootStore;
  const renderer = useThree(s => s.renderer) as unknown as WebGPURenderer;
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera) as PerspectiveCamera;

  useEffect(() => {
    let live = true;
    // Nothing is drawn until the sky is up (R3F's default job would render the bare scene).
    if (!bench.getState().rt) setRenderOverride(root, () => {});
    startSky(renderer, scene, camera).then(rt => {
      if (!live) return;
      bench.setState({ rt });
      setRenderOverride(root, () => rt.pane.present());
      scheduleUrl();
    }, (e: unknown) => {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      bench.setState({ error: msg, hud: `failed: ${e instanceof Error ? e.message : String(e)}` });
      harness.fail(msg);
    });
    return () => { live = false; };
  }, [root, renderer, scene, camera, harness]);

  useFrame((_, dt) => {
    const { rig, view, rt } = bench.getState();
    if (!rt) return;
    rig?.update(Math.min(0.25, dt));
    view.position[1] = Math.max(0.5, view.position[1]);
  }, { id: 'bench-rig', phase: 'input' });

  useFrame((_, dt) => {
    const { rt, view } = bench.getState();
    if (rt) weatherTick(dt, rt);
    rt?.pane.update(view);
  }, { id: 'bench-sky', phase: 'update' });

  useFrame(state => {
    harness.frame();
    const s = bench.getState();
    if (!s.rt) return;
    if (!reported && s.rt.pane.ready()) { reported = true; reportReady(harness, renderer); }
    if (state.frame % 15 === 0 && !s.uiHidden) {
      const hud = hudText(renderer);
      if (hud !== s.hud) bench.setState({ hud });
    }
  }, { id: 'bench-finish', phase: 'finish' });

  return null;
}

let reported = false;
function reportReady(harness: CloudsHarness, renderer: WebGPURenderer) {
  const canvas = renderer.domElement as HTMLCanvasElement;
  harness.ready({
    bookmark,
    report: () => {
      const s = bench.getState(), v = s.view;
      return { view: s.viewName, style: s.style, ref: s.ref.id, refMode: s.ref.mode, camera: [...v.position], lookAz: v.lookAz, pitch: v.pitch, sunElevation: v.sunEl, sunAzimuth: v.sunAz,
        coverage: v.coverage, quality: s.quality, gpuMs: s.rt?.pane.stats().gpuMs ?? null, gpuLast: s.rt?.clouds.lastTimings ?? null, frameMs: {}, renderSize: [canvas.width, canvas.height], changed: s.rt?.tuner.changes() ?? {} };
    },
  });
}

const f1 = (n: number) => n.toFixed(1);
function hudText(renderer: WebGPURenderer): string {
  const s = bench.getState(), v = s.view, rt = s.rt!, canvas = renderer.domElement as HTMLCanvasElement;
  const st = rt.pane.stats(), gpu = st.gpuMs?.total, sky = st.gpuMs?.skyLayer;
  return `HZD sky · ${s.viewName}${rt.pane.ready() ? '' : ' (loading...)'}  q ${s.quality}  style ${s.style}\n`
    + `cam ${v.position.map(x => Math.round(x)).join(', ')}  az ${Math.round(v.lookAz)}  pitch ${f1(v.pitch)}  fov ${Math.round(v.fov)}\n`
    + `sun el ${f1(v.sunEl)} az ${Math.round(v.sunAz)}  coverage ${v.coverage.toFixed(2)}  motion ×${rt.sources.c.animSpeed}\n`
    + `${gpu != null ? `gpu ${f1(gpu)} ms` : ''}${sky != null ? `  sky layer ${f1(sky)} ms` : ''}  ${canvas.width}x${canvas.height}${s.ref.id ? `\nvs ${s.ref.id}` : ''}`;
}
