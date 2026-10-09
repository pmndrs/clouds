// Dev-server middleware for the compare page's photo browser (T2). Local only: lists the owner's cloud photos and stores per-photo sun presets.
//   GET  /__photos/index.json  -> { root, items: [{ folder, file, path, grade?, time?, notes?, sun? }] }  (path is absolute; fetch it as /@fs/<path>)
//   POST /__photos/sun         -> body { folder, file, sunEl, sunAz? } writes <photos dir>/sun-presets.json (never committed; artifacts/ is ignored)
// The photos dir is <research dir>/cloud-photos (CLOUDS_RESEARCH_DIR overrides the research dir), found the same way vite.config.ts allows it.
import type { Plugin } from 'vite';
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const IMG = /\.(jpe?g|png|webp)$/i;
const SKIP = new Set(['_reference', '_tools']);

export function cloudPhotos(root: string): Plugin {
  const candidates = [process.env.CLOUDS_RESEARCH_DIR, `${root}/artifacts/research`, `${root}/../../../artifacts/research`].filter(Boolean) as string[];
  const dir = candidates.map(d => join(d, 'cloud-photos')).find(d => existsSync(d));
  const presetsFile = dir ? join(dir, 'sun-presets.json') : '';
  const readPresets = (): Record<string, { sunEl: number; sunAz?: number }> => { try { return JSON.parse(readFileSync(presetsFile, 'utf8')); } catch { return {}; } };
  return {
    name: 'clouds-photos',
    configureServer(server) {
      server.middlewares.use('/__photos', (req, res) => {
        const json = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); };
        if (!dir) return json(404, { error: 'cloud-photos dir not found', tried: candidates });
        if (req.method === 'POST' && req.url?.startsWith('/sun')) {
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try {
              const b = JSON.parse(body) as { folder: string; file: string; sunEl: number; sunAz?: number };
              if (typeof b.sunEl !== 'number' || !b.file || !b.folder) throw new Error('bad body');
              const p = readPresets(); p[`${b.folder}/${b.file}`] = { sunEl: b.sunEl, ...(typeof b.sunAz === 'number' ? { sunAz: b.sunAz } : {}) };
              writeFileSync(presetsFile, JSON.stringify(p, null, 1));
              json(200, { ok: true });
            } catch (e) { json(400, { error: String(e) }); }
          });
          return;
        }
        let meta = new Map<string, { grade?: string; time?: string; notes?: string }>();
        try { meta = new Map((JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).photos as Array<{ file: string; grade?: string; time?: string; notes?: string }>).map(p => [p.file, p])); } catch { /* manifest optional */ }
        const presets = readPresets();
        const items: unknown[] = [];
        for (const folder of readdirSync(dir).sort()) {
          if (SKIP.has(folder) || !statSync(join(dir, folder)).isDirectory()) continue;
          for (const file of readdirSync(join(dir, folder)).sort()) {
            if (!IMG.test(file)) continue;
            const m = meta.get(file);
            items.push({ folder, file, path: join(dir, folder, file), grade: m?.grade, time: m?.time, notes: m?.notes, sun: presets[`${folder}/${file}`] });
          }
        }
        json(200, { root: dir, items });
      });
    },
  };
}
