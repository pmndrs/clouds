// The reference shot beside the render (side by side), over it (picture in picture) or alone (hold F): a paper's figure or one of the owner's
// photos, contain-fit on a 2D canvas, with its caption. The images come from the local research folder through the dev server only.
import * as React from 'react';
import { HZD_REF_BY_ID, type HzdRef } from '../../hzd/refs';
import { cn } from '../ui/lib/utils';
import { PIP, SIDEBAR } from '../bench/views';
import type { RefState } from '../bench/url';

export interface RefImage { ref: HzdRef | undefined; img: HTMLImageElement | null; error: string }

/** Loads the picked reference's image (the dev server's /__hzd/ref/<id> route). */
export function useRefImage(id: string): RefImage {
  const [state, setState] = React.useState<RefImage>({ ref: undefined, img: null, error: '' });
  React.useEffect(() => {
    const ref = HZD_REF_BY_ID.get(id);
    setState({ ref, img: null, error: '' });
    if (!ref) return;
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setState({ ref, img, error: '' }); };
    img.onerror = () => { if (live) setState({ ref, img: null, error: `The image for ${ref.id} is not in the local research folder (artifacts/research/${ref.file}). It is served by the dev server only.` }); };
    img.src = `/__hzd/ref/${encodeURIComponent(ref.id)}`;
    return () => { live = false; };
  }, [id]);
  return state;
}

const cropOf = (r: RefImage, page: boolean): [number, number, number, number] => (r.ref?.crop && !page ? r.ref.crop : [0, 0, 1, 1]);

export interface Box { x: number; y: number; w: number; h: number }
export interface Layout { view: { left: number; width: number; height: number }; ref: (Box & { kind: 'side' | 'pip' | 'full' }) | null }

/** Where the render and the reference go: the painter's dock on the left, the reference off / side by side / picture in picture / alone. */
export function layoutFor(o: { width: number; height: number; inset: number; ref: RefState; flip: boolean; uiHidden: boolean; aspect: number }): Layout {
  const L = o.inset, W = o.width - L, H = o.height;
  const show = !!o.ref.id && (o.flip || o.ref.mode !== 'off');
  let vw = W;
  let ref: Layout['ref'] = null;
  if (show) {
    if (o.flip) ref = { x: 0, y: 0, w: o.width, h: H, kind: 'full' };
    else if (o.ref.mode === 'side') {
      // The two halves share the width left of the sidebar (all of it with the UI hidden).
      const avail = W - (o.uiHidden ? 0 : SIDEBAR);
      vw = Math.round(avail / 2);
      ref = { x: L + vw, y: 0, w: avail - vw, h: H, kind: 'side' };
    } else {
      const w = Math.round(W * PIP[o.ref.pip]), h = Math.min(Math.round(H * 0.7), Math.round(w / o.aspect) + 34);
      ref = { x: o.ref.corner === 'bl' ? L + 12 : L + W - w - 12, y: H - h - 12, w, h, kind: 'pip' };
    }
  }
  return { view: { left: L, width: Math.max(2, vw), height: Math.max(2, H) }, ref };
}

export const refAspect = (r: RefImage, page: boolean) => {
  if (!r.img) return 16 / 9;
  const [, , cw, ch] = cropOf(r, page);
  return (cw * r.img.naturalWidth) / (ch * r.img.naturalHeight);
};

export function RefBox({ box, image, page }: { box: NonNullable<Layout['ref']>; image: RefImage; page: boolean }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(box.w * dpr)); c.height = Math.max(1, Math.round(box.h * dpr));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, c.width, c.height);
    const img = image.img;
    if (!img) return;
    const [cx, cy, cw, ch] = cropOf(image, page);
    const sx = cx * img.naturalWidth, sy = cy * img.naturalHeight, sw = cw * img.naturalWidth, sh = ch * img.naturalHeight;
    const k = Math.min(c.width / sw, c.height / sh), dw = sw * k, dh = sh * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  }, [box.w, box.h, image, page]);
  const r = image.ref;
  return (
    <div className={cn('fixed bg-[#0b0b0b]', box.kind === 'full' ? 'z-20' : 'z-[3]', box.kind === 'pip' && 'border border-white/30 shadow-[0_2px_12px_#000a]')}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <canvas ref={canvas} className="absolute inset-0 block size-full" />
      {image.error && <div className="absolute inset-0 flex items-center justify-center p-5 text-center text-muted-foreground">{image.error}</div>}
      {r && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1">
          <b>{r.title}</b><br />
          <span className="text-muted-foreground">{r.source}</span>{r.view && <span className="text-warn"> · approximate view</span>}
        </div>
      )}
    </div>
  );
}
