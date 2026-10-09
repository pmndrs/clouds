// Reference-photo pane: shows a local image (never committed, only referenced) beside the renders.
//   ?photo=<url|path>  /@fs/<abs path> is served by vite (needs server.fs.allow to cover the folder), a bare absolute path such as /Users/me/x.jpg is rewritten to /@fs/...; http(s) and blob URLs pass through.
//   Drag an image file onto the page, or use the "photo file" button in the bar, when the server cannot reach the file.
//   ?photofit=cover|contain (default contain: letterbox, nothing cropped)
import type { Pane, ViewState } from '../shared';

const ABS_ROOTS = ['/Users/', '/home/', '/Volumes/', '/private/', '/tmp/', '/var/'];
/** Maps what a person pastes (an absolute file path, /@fs/ path or URL) to something fetchable by the page. */
export function photoUrl(raw: string): string {
  if (/^(https?:|blob:|data:)/.test(raw) || raw.startsWith('/@fs/')) return raw;
  if (ABS_ROOTS.some(r => raw.startsWith(r))) return '/@fs' + encodeURI(raw).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return raw;
}

export interface PhotoPane extends Pane {
  fit: 'cover' | 'contain';
  /** Replace the image from a File (file input / drop). */
  setFile(file: File): Promise<void>;
  setUrl(url: string, name?: string): Promise<void>;
  /** Redraw after fit changes. */
  redraw(): void;
  /** One-line description for the label (file name and pixel size). */
  describe(): string;
}

export function createPhotoPane(canvas: HTMLCanvasElement, query: URLSearchParams): PhotoPane {
  const ctx = canvas.getContext('2d')!;
  let img: HTMLImageElement | null = null;
  let name = '';
  let objectUrl: string | null = null;
  let w = 2, h = 2;
  const pane: PhotoPane = {
    id: 'photo', label: 'Photo', canvas,
    fit: query.get('photofit') === 'cover' ? 'cover' : 'contain',
    async init() {
      const p = query.get('photo');
      if (p) await pane.setUrl(photoUrl(p), decodeURIComponent(p.split('/').pop() ?? p));
      else pane.redraw();
    },
    resize(width, height) { w = width; h = height; canvas.width = width; canvas.height = height; pane.redraw(); },
    render(_v: ViewState) { /* static; redrawn on resize, load and fit change */ },
    ready: () => true,
    stats: () => ({ gpuMs: null, cpuMs: 0 }),
    detail: () => ({ photo: name || null, size: img ? [img.naturalWidth, img.naturalHeight] : null, fit: pane.fit }),
    describe: () => (img ? `${name}  ${img.naturalWidth}x${img.naturalHeight}  ${pane.fit}` : 'no photo: drop an image, or use "photo file"'),
    redraw() {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      if (!img) { ctx.fillStyle = '#888'; ctx.font = '14px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center'; ctx.fillText('drop a photo here', w / 2, h / 2); return; }
      const s = (pane.fit === 'cover' ? Math.max : Math.min)(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    },
    async setUrl(url, n) {
      const next = new Image();
      await new Promise<void>((res, rej) => { next.onload = () => res(); next.onerror = () => rej(new Error(`photo failed to load: ${url} (vite fs.allow may not cover that folder; use drag-and-drop or the file button)`)); next.src = url; });
      img = next; name = n ?? url; pane.redraw();
    },
    async setFile(file) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      await pane.setUrl(objectUrl, file.name);
    },
  };
  return pane;
}
