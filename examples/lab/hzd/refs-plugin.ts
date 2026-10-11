// Dev-server route for the HZD bench's reference viewer: GET /__hzd/ref/<id> returns the image of that reference (refs.ts).
// The images are third party (Guerrilla's papers and decks) or the owner's photos. They are read from the local research folder and never
// copied into the repo or the build. Only ids listed in refs.ts are served: no other path can be asked for.
import type { Plugin } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HZD_REF_BY_ID } from './refs';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export function hzdRefs(root: string): Plugin {
  // Several research folders can exist (a worktree's own artifacts/ holds only agent output): take the first that has the file.
  const research = [process.env.CLOUDS_RESEARCH_DIR, join(root, 'artifacts/research'), join(root, '../../../artifacts/research')].filter(Boolean) as string[];
  return {
    name: 'hzd-refs',
    configureServer(server) {
      server.middlewares.use('/__hzd/ref', (req, res) => {
        const id = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
        const ref = HZD_REF_BY_ID.get(id);
        const file = ref ? research.map(d => join(d, ref.file)).find(f => existsSync(f)) : undefined;
        if (!ref || !file) { res.statusCode = 404; res.end(`no reference image for ${id}`); return; }
        res.setHeader('content-type', TYPES[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'); res.setHeader('cache-control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}
