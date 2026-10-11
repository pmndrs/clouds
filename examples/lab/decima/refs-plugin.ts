// Dev-server route for the Decima parity page's reference view: GET /__decima/ref/<bookmark>.png returns Guerrilla's frame for that shot.
// The frames are third party (the Nubis Cubed deck's images and video frames). They are read from the local research folder and never copied
// into the repo or the build. The same map as scripts/d1/d1.py (refof).
import type { Plugin } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';

const FRAMES: Record<string, string> = {
  p101: 'extracted/n3/pptx/media/image101.png', p125: 'extracted/n3/pptx/media/image127.png', p161: 'extracted/n3/pptx/media/image162.png',
  p213: 'extracted/n3/pptx/media/image213.png', s206: 'extracted/n3/pptx/media/image206.png', s214: 'extracted/n3/pptx/media/image214.png',
  s33t3: 'd0-parity/ref/frames/media33-t3.png', s33t6: 'd0-parity/ref/frames/media33-t6.png', s33t9: 'd0-parity/ref/frames/media33-t9.png',
};

export function decimaRefs(root: string): Plugin {
  // Several research folders can exist (a worktree's own artifacts/ holds only agent output): take the first that has the frame.
  const research = [process.env.CLOUDS_RESEARCH_DIR, join(root, 'artifacts/research'), join(root, '../../../artifacts/research')].filter(Boolean) as string[];
  return {
    name: 'decima-refs',
    configureServer(server) {
      server.middlewares.use('/__decima/ref', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '').replace(/\.png.*$/, '').split('@')[0];
        const file = FRAMES[name] ? research.map(d => join(d, FRAMES[name])).find(f => existsSync(f)) : undefined;
        if (!file) { res.statusCode = 404; res.end(`no reference frame for ${name}`); return; }
        res.setHeader('content-type', 'image/png'); res.setHeader('cache-control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}
