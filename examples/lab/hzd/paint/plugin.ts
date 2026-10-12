// Dev-server routes for the HZD bench's weather-map painter (editor.ts):
//   GET  /__hzd/ndf/list                     the authored maps: assets/clouds/ndf/*.png (W1's examples) and assets/clouds/ndf/painted/*.png
//   POST /__hzd/ndf/save?name=<n>&kind=main|height   the PNG body to assets/clouds/ndf/painted/<n>.png (or <n>-height.png)
// Saved maps are served like the examples, at /clouds/ndf/painted/<n>.png, so ?hzn_image= links work. Names are [a-z0-9-] only; the body must
// be a PNG. Nothing else on disk can be read or written.
import type { Plugin } from 'vite';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_BYTES = 32 << 20;

export interface NdfMapEntry { name: string; url: string; heightUrl: string }

export function hzdNdfMaps(root: string): Plugin {
  const dir = join(root, 'assets/clouds/ndf');
  const painted = join(dir, 'painted');
  const list = (d: string, urlBase: string): NdfMapEntry[] => {
    if (!existsSync(d)) return [];
    const files = new Set(readdirSync(d).filter(f => f.endsWith('.png')));
    return [...files].filter(f => !f.endsWith('-height.png')).sort().map(f => {
      const name = f.slice(0, -4);
      return { name, url: `${urlBase}/${f}`, heightUrl: files.has(`${name}-height.png`) ? `${urlBase}/${name}-height.png` : '' };
    });
  };
  return {
    name: 'hzd-ndf-maps',
    configureServer(server) {
      // Saved maps straight from disk: vite's public-file index learns of a new file only after its watcher sees it (never with
      // CLOUDS_NO_WATCH), and the sky asks for the file right after the save.
      server.middlewares.use('/clouds/ndf/painted', (req, res, next) => {
        const file = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''));
        if (!/^[a-z0-9][a-z0-9-]{0,70}\.png$/.test(file) || !existsSync(join(painted, file))) { next(); return; }
        res.setHeader('content-type', 'image/png'); res.setHeader('cache-control', 'no-store');
        res.end(readFileSync(join(painted, file)));
      });
      server.middlewares.use('/__hzd/ndf', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); };
        if (req.method === 'GET' && url.pathname === '/list') { send(200, { examples: list(dir, '/clouds/ndf'), painted: list(painted, '/clouds/ndf/painted') }); return; }
        if (req.method === 'POST' && url.pathname === '/save') {
          const name = url.searchParams.get('name') ?? '', kind = url.searchParams.get('kind') ?? 'main';
          if (!NAME.test(name) || name.endsWith('-height') || (kind !== 'main' && kind !== 'height')) { send(400, { error: 'name: lower-case letters, digits and dashes (not ending in -height); kind: main or height' }); return; }
          const chunks: Buffer[] = [];
          let size = 0;
          req.on('data', (c: Buffer) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
          req.on('end', () => {
            const body = Buffer.concat(chunks);
            if (size > MAX_BYTES || body.length < 8 || PNG.some((b, i) => body[i] !== b)) { send(400, { error: 'the body must be a PNG under 32 MB' }); return; }
            mkdirSync(painted, { recursive: true });
            const file = `${name}${kind === 'height' ? '-height' : ''}.png`;
            writeFileSync(join(painted, file), body);
            send(200, { url: `/clouds/ndf/painted/${file}`, path: `assets/clouds/ndf/painted/${file}` });
          });
          return;
        }
        send(404, { error: 'unknown route' });
      });
    },
  };
}
