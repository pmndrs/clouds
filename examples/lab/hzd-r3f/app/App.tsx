// The React HZD bench: the sky in an R3F <Canvas> (SkyHost drives it with the existing pane), the sidebar, the reference box, the readout and
// help, the tuning panel (Tweakpane, unchanged) and the weather-map painter (the vanilla dock, until it is ported to components).
import * as React from 'react';
import { Canvas } from '@react-three/fiber';
import { Rig } from '../../compare/rig';
import { createPainter } from '../../hzd/paint/editor';
import { sharedBackend } from '@clouds/three';
import type { CloudsHarness } from '../../harness/clouds-contract';
import { TooltipProvider } from '../ui/components/tooltip';
import { SkyHost } from '../sky/SkyHost';
import { bench, scheduleUrl, settingsChanged, useBench, viewChanged, type Painter } from '../bench/store';
import { Sidebar } from './Sidebar';
import { RefBox, layoutFor, refAspect, useRefImage } from './RefBox';
import { Help, Hud, ShowUiButton } from './Overlays';
import { useBenchKeys } from './keys';

/** One rig per element: StrictMode mounts effects twice, and the rig's listeners have no off switch. */
const rigs = new WeakMap<HTMLElement, Rig>();
/** One painter per page (it builds its own dock). */
let painterSingleton: Painter | null = null;

function useWindowSize() {
  const [size, setSize] = React.useState({ width: innerWidth, height: innerHeight });
  React.useEffect(() => {
    const on = () => setSize({ width: innerWidth, height: innerHeight });
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return size;
}

export function App({ harness }: { harness: CloudsHarness }) {
  const size = useWindowSize();
  const ref = useBench(s => s.ref);
  const flip = useBench(s => s.flip);
  const uiHidden = useBench(s => s.uiHidden);
  const helpOpen = useBench(s => s.helpOpen);
  const clean = useBench(s => s.clean);
  const inset = useBench(s => s.painterInset);
  const rt = useBench(s => s.rt);
  const image = useRefImage(ref.id);
  const layout = layoutFor({ ...size, inset, ref, flip, uiHidden, aspect: refAspect(image, ref.page) });
  const viewHost = React.useRef<HTMLDivElement>(null);

  useBenchKeys();

  // The camera rig listens on the view's element (drag to look, wheel) and on the window (WASD QE).
  React.useEffect(() => {
    const el = viewHost.current!;
    let rig = rigs.get(el);
    if (!rig) { rig = new Rig(bench.getState().view, el); rigs.set(el, rig); }
    bench.setState({ rig });
  }, []);

  // While the camera moves, the controls and the URL follow (2 Hz, as the vanilla bench).
  React.useEffect(() => {
    let last = '';
    const t = setInterval(() => {
      const v = bench.getState().view;
      const k = `${v.position.map(x => Math.round(x)).join()},${Math.round(v.lookAz)},${Math.round(v.pitch)}`;
      if (k !== last) { last = k; viewChanged(); }
    }, 500);
    return () => clearInterval(t);
  }, []);

  // The weather-map painter (M), once the sky is up; not in clean mode.
  React.useEffect(() => {
    if (!rt || clean) return;
    if (!painterSingleton) {
      const canvas = rt.renderer.domElement as HTMLCanvasElement;
      painterSingleton = createPainter({
        proc: rt.proc, device: sharedBackend(rt.renderer).device, ndf: rt.sources.ndf, hzd: rt.sources.hzd, core: rt.core, view: bench.getState().view,
        aspect: () => canvas.width / Math.max(1, canvas.height),
        onLayout: () => bench.setState({ painterInset: painterSingleton?.inset() ?? 0 }),
        onViewChange: () => { rt.core.resetTemporal(); viewChanged(); },
        onSettingsChange: () => settingsChanged({ refreshTuner: true }),
      });
    }
    bench.setState({ painter: painterSingleton });
  }, [rt, clean]);

  React.useEffect(() => { scheduleUrl(); }, [ref]);

  return (
    <TooltipProvider>
      <div ref={viewHost} className="fixed top-0 touch-none bg-black" style={{ left: layout.view.left, width: layout.view.width, height: layout.view.height }}>
        <Canvas id="sky" primary frameloop="always" dpr={1} camera={{ fov: 50, near: 0.5, far: 600000 }}
          renderer={{ antialias: false, trackTimestamp: true }} resize={{ debounce: 0 }}>
          <SkyHost harness={harness} />
        </Canvas>
      </div>
      {layout.ref && <RefBox box={layout.ref} image={image} page={ref.page} />}
      {!uiHidden && <Hud left={layout.view.left} />}
      {!uiHidden && <Sidebar />}
      {uiHidden && !clean && <ShowUiButton />}
      {helpOpen && !uiHidden && <Help />}
    </TooltipProvider>
  );
}
