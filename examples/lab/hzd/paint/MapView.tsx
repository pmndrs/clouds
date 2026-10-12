// The painter's map view: the map tiled on a 2D canvas (north up), the camera and its view wedge, the horizon ring, the sun, the wind, the
// scale bar, the brush. Left-drag paints, alt-click picks, right-click puts the camera there, wheel zooms, shift-wheel sizes, space- or
// middle-drag pans. Drawn every frame while the dock is open (it follows the camera and the map's drift); the engine sends the map to the sky.
import * as React from 'react';
import type { PaintEngine } from './engine';
import { paint } from './store';

export function MapView({ engine, spaceHeld }: { engine: PaintEngine; spaceHeld: React.RefObject<boolean> }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const c = canvas.current!;
    let cursor: [number, number] | null = null;
    let panning: { x: number; y: number; pan: [number, number] } | null = null;
    const geom = () => {
      const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1, s0 = paint.getState();
      const n = engine.fields?.n ?? 1, s = (r.width / n) * s0.zoom, pan = s0.pan;   // CSS pixels per map pixel
      return { r, dpr, s, toScreen: (p: [number, number]): [number, number] => [(p[0] - pan[0]) * s + r.width / 2, (p[1] - pan[1]) * s + r.height / 2],
        toMap: (cx: number, cy: number): [number, number] => [(cx - r.left - r.width / 2) / s + pan[0], (cy - r.top - r.height / 2) / s + pan[1]] };
    };

    const draw = () => {
      const st = paint.getState(), f = engine.fields, view = engine.host.view;
      if (f && st.follow) { const p = engine.camMap(); if (p[0] !== st.pan[0] || p[1] !== st.pan[1]) paint.setState({ pan: p }); }
      const { r, dpr, s, toScreen } = geom();
      const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (!f) return;
      engine.redrawMap();
      const n = f.n;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The map tiles: a repeating pattern, the primary tile (centred on the world origin) outlined.
      const pat = ctx.createPattern(engine.mapCanvas, 'repeat')!;
      const [ox, oy] = toScreen([0, 0]);
      pat.setTransform(new DOMMatrix([s, 0, 0, s, ox, oy]));
      ctx.imageSmoothingEnabled = s < 2;
      ctx.fillStyle = pat; ctx.fillRect(0, 0, r.width, r.height);
      ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.strokeRect(ox, oy, n * s, n * s); ctx.setLineDash([]);
      const mpp = engine.tile() / n;   // metres per map pixel
      if (st.overlays) {
        const [cx, cy] = toScreen(engine.camMap()), hzd = engine.host.hzd;
        // The horizon ring (hzd ringStart..ringEnd): beyond its start the ring replaces the map.
        const rs = Number(hzd.ringStart) || 0, re = Number(hzd.ringEnd) || 0;
        if (rs > 0) {
          ctx.strokeStyle = '#9ad0ff55'; ctx.setLineDash([6, 5]);
          for (const m of [rs, re]) { ctx.beginPath(); ctx.arc(cx, cy, (m / mpp) * s, 0, Math.PI * 2); ctx.stroke(); }
          ctx.setLineDash([]);
        }
        // The view wedge.
        const az = (view.lookAz * Math.PI) / 180, hf = Math.atan(Math.tan(((view.fov / 2) * Math.PI) / 180) * engine.aspect()), len = Math.max(r.width, r.height);
        ctx.fillStyle = '#ffffff1c'; ctx.strokeStyle = '#ffffffaa';
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(az - hf) * len, cy - Math.cos(az - hf) * len);
        ctx.lineTo(cx + Math.sin(az + hf) * len, cy - Math.cos(az + hf) * len);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx + Math.sin(az - hf) * 40, cy - Math.cos(az - hf) * 40); ctx.lineTo(cx, cy); ctx.lineTo(cx + Math.sin(az + hf) * 40, cy - Math.cos(az + hf) * 40); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.stroke();
        // The sun's direction, on the view's edge.
        const sa = (view.sunAz * Math.PI) / 180, sr = Math.min(r.width, r.height) / 2 - 12;
        const sx = r.width / 2 + Math.sin(sa) * sr, sy = r.height / 2 - Math.cos(sa) * sr;
        ctx.fillStyle = view.sunEl > 0 ? '#ffd27a' : '#c77a4a'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
        // The wind (the map's drift direction) and north, in the top-left corner.
        const wv = engine.host.core.settings.windVelocity, wl = Math.hypot(wv[0], wv[2]);
        ctx.font = '11px ui-monospace,Menlo,monospace'; ctx.fillStyle = '#c9d2db'; ctx.fillText('N ↑', 8, 16);
        if (wl > 0) {
          const ux = wv[0] / wl, uy = wv[2] / wl, bx = 22, by = 40;
          ctx.strokeStyle = '#c9d2db'; ctx.beginPath(); ctx.moveTo(bx - ux * 12, by - uy * 12); ctx.lineTo(bx + ux * 12, by + uy * 12); ctx.stroke();
          ctx.beginPath(); ctx.arc(bx + ux * 12, by + uy * 12, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillText('wind', 38, 44);
        }
      }
      // The scale bar.
      const target = r.width * 0.25 * mpp / s, nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000].find(v => v >= target * 0.6) ?? 20000;
      const bw = (nice / mpp) * s;
      ctx.fillStyle = '#000a'; ctx.fillRect(6, r.height - 22, bw + 52, 16);
      ctx.fillStyle = '#fff'; ctx.fillRect(10, r.height - 15, bw, 3);
      ctx.font = '11px ui-monospace,Menlo,monospace'; ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, bw + 14, r.height - 10);
      // The brush.
      if (cursor && !panning) {
        const [bx, by] = toScreen(cursor), br = engine.radiusPx() * s;
        ctx.strokeStyle = '#ffffffcc'; ctx.beginPath(); ctx.arc(bx, by, Math.max(br, 2), 0, Math.PI * 2); ctx.stroke();
        if (st.hardness < 0.95) { ctx.strokeStyle = '#ffffff55'; ctx.beginPath(); ctx.arc(bx, by, Math.max(br * Math.max(st.hardness, 0.5), 1), 0, Math.PI * 2); ctx.stroke(); }
      }
      if (engine.grad) {
        const a = toScreen(engine.grad.a), b = toScreen(engine.grad.b);
        ctx.strokeStyle = '#ffd27a'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    };

    let raf = 0;
    const loop = () => { engine.frame(); draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    const status = () => paint.setState({ status: engine.statusAt(cursor) });
    const down = (e: PointerEvent) => {
      if (!engine.fields || paint.getState().busy) return;
      c.setPointerCapture(e.pointerId);
      const p = geom().toMap(e.clientX, e.clientY);
      if (e.button === 1 || (e.button === 0 && spaceHeld.current)) { panning = { x: e.clientX, y: e.clientY, pan: [...paint.getState().pan] }; paint.setState({ follow: false }); return; }
      if (e.button === 2) { engine.cameraHere(p); return; }
      if (e.button !== 0) return;
      engine.pointerDown(p, e.altKey);
    };
    const move = (e: PointerEvent) => {
      if (!engine.fields) return;
      const g = geom(), p = g.toMap(e.clientX, e.clientY);
      cursor = p;
      if (panning) { paint.setState({ pan: [panning.pan[0] - (e.clientX - panning.x) / g.s, panning.pan[1] - (e.clientY - panning.y) / g.s] }); return; }
      engine.pointerMove(p);
      status();
    };
    const up = () => { engine.pointerUp(); panning = null; };
    const leave = () => { cursor = null; status(); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!engine.fields) return;
      const st = paint.getState();
      if (e.shiftKey) { paint.setState({ sizeMeters: Math.min(8000, Math.max(50, st.sizeMeters * Math.exp(-(e.deltaY || e.deltaX) * 0.002))) }); return; }
      const before = geom().toMap(e.clientX, e.clientY);
      paint.setState({ zoom: Math.min(32, Math.max(0.25, st.zoom * Math.exp(-e.deltaY * 0.0015))) });
      const after = geom().toMap(e.clientX, e.clientY), pan = paint.getState().pan;
      paint.setState({ pan: [pan[0] + before[0] - after[0], pan[1] + before[1] - after[1]], follow: false });
    };
    const menu = (e: Event) => e.preventDefault();
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('contextmenu', menu);
    status();
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up); c.removeEventListener('pointerleave', leave); c.removeEventListener('wheel', wheel); c.removeEventListener('contextmenu', menu);
    };
  }, [engine, spaceHeld]);

  return <canvas ref={canvas} className="absolute inset-0 block size-full" />;
}
