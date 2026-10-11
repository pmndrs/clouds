#!/usr/bin/env python3
# D1 round 9: the floret metric (scratchpad/florets/florets.py: Hessian blobs per 1e4 lit px, lit-half bands3) on the judged crops of every capture in a
# directory, the frame first. 4k captures use the 4k boxes; 1080p captures and the Stormbird frames are measured at 2x (scale 2).
import sys, os, glob, subprocess
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'; os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
S = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad'
FL = f'{S}/florets/florets.py'
REG = {'p101': {'tower': (1150, 180, 400, 520), 'leftmass': (350, 330, 500, 330), 'towershade': (1200, 300, 200, 200)},
       'p213': {'tower': (1100, 150, 480, 560), 'base': (300, 560, 900, 300)},
       's206': {'leg': (40, 520, 560, 340), 'body': (560, 180, 700, 500)}, 's33t3': {'upper': (500, 100, 700, 450), 'trunk': (960, 620, 300, 300)}}
def run(img, box, scale, label):
    x, y, w, h = box
    out = subprocess.run(['python3', '-I', FL, 'img', img, '--box', f'{x},{y},{w},{h}', '--scale', str(scale)], capture_output=True, text=True)
    line = [l for l in out.stdout.splitlines() if l.strip()]
    return (label[:52].ljust(52) + ' ' + (line[-1] if line else out.stderr[-200:]))
def main(d, frames):
    for f in frames:
        is4k = f.startswith('p')
        files = [p for p in sorted(glob.glob(f'{d}/{f}@*'), key=len) if 'matte' not in p and 'lightDebug' not in p]
        for r, b in REG[f].items():
            ref = d1.ref_of(f)
            print(f'== {f} {r}')
            # the frame: p101/p213 frames are 4k (box x2, scale 1); Stormbird frames are 1080p (box as is, scale 2)
            print('  ' + run(ref, tuple(2 * v for v in b) if is4k else b, 1 if is4k else 2, 'frame'))
            for p in files:
                tag = os.path.basename(p).split('decima')[-1].rsplit('.', 1)[0] or ' (base)'
                print('  ' + run(p, tuple(2 * v for v in b) if is4k else b, 1 if is4k else 2, tag))
if __name__ == '__main__': main(sys.argv[1], sys.argv[2].split(','))
