"""L1: auto-match.  Renders every candidate of a target at several yaws on the target page (examples/lab/target/, matching camera
and sun), scores each render against the target card (card.py), keeps each candidate's best yaw, ranks them and makes a top-N
contact sheet next to the photo crop.  System python3 (numpy + Pillow) + node for the capture harness.

  python3 scripts/targets/match.py texas-tower                         # all candidates in assets/clouds/local/texas-tower/
  python3 scripts/targets/match.py texas-tower --only v00,v03 --yaws 0,180
  python3 scripts/targets/match.py texas-tower --no-render             # re-score existing renders
  python3 scripts/targets/match.py texas-tower --root DIR              # capture from another checkout (a stable snapshot)

Outputs (work/captures/scratch/targets/<target>/, never committed: the sheet holds the owner's photo):
  renders/<cand>@<yaw>.jpg, scores.json (every render), ranking.txt (best yaw per candidate), top5.jpg (photo crop + top 5).
"""
import argparse, json, os, subprocess, sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import card as C  # noqa: E402

TARGETS = {
    'texas-tower': dict(
        card='work/captures/scratch/targets/texas-tower.card.json',
        photo='/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/_targets/texas-afternoon.jpg',
        query='clean=1&sunaz=-150&sunel=45', size='1500x1002', src='local/texas-tower/'),
}


def crop_to_cloud(img, mask, pad=0.08, h=360):
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    p = int(pad * (y1 - y0))
    box = (max(0, x0 - p), max(0, y0 - p), min(img.width, x1 + p), min(img.height, y1 + p))
    im = img.crop(box)
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('target', choices=list(TARGETS))
    ap.add_argument('--only'); ap.add_argument('--yaws', default='0,90,180,270')
    ap.add_argument('--root', default=REPO, help='checkout whose scripts/gpu/capture.mjs and lab pages render (default: this repo)')
    ap.add_argument('--no-render', action='store_true'); ap.add_argument('--top', type=int, default=5)
    ap.add_argument('--out', help='default work/captures/scratch/targets/<target>')
    ap.add_argument('--fresh', action='store_true', help='forget earlier scores.json entries')
    ap.add_argument('--src', help='candidate folder under assets/clouds/ (default local/<target>/; the committed picks: targets/<target>/)')
    a = ap.parse_args()
    T = dict(TARGETS[a.target])
    if a.src:
        T['src'] = a.src
    out = a.out or os.path.join(REPO, 'work', 'captures', 'scratch', 'targets', a.target)
    rdir = os.path.join(out, 'renders')
    os.makedirs(rdir, exist_ok=True)
    local = os.path.join(REPO, 'assets', 'clouds', T['src'])
    cands = sorted(json.load(open(os.path.join(local, 'candidates.json')))['candidates'])
    if a.only:
        cands = [c for c in cands if c in a.only.split(',')]
    yaws = [int(y) for y in a.yaws.split(',')]
    shots = [f'{c}@{y}' for c in cands for y in yaws]
    plate_f = os.path.join(rdir, 'sky.jpg')
    if not a.no_render:
        for i in range(0, len(shots), 24):   # one browser per batch keeps a failure local; each batch re-shoots the sky plate
            cmd = ['node', 'scripts/gpu/capture.mjs', '--serve', '--page', 'target/', '--query', f"{T['query']}&src={T['src']}", '--size', T['size'],
                   '--shots', ','.join(['sky'] + shots[i:i + 24]), '--out', rdir, '--timeout', '120']
            r = subprocess.run(cmd, cwd=a.root, capture_output=True, text=True)
            print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-500:], flush=True)
    target = json.load(open(os.path.join(REPO, T['card'])))
    tmask = np.load(os.path.join(REPO, T['card'])[:-5] + '.mask.npy')
    plate = C.load_rgb(plate_f)
    sp = os.path.join(out, 'scores.json')
    scores = json.load(open(sp)) if os.path.exists(sp) and not a.fresh else {}   # runs accumulate (score the sweep in parts)
    for s in shots:
        f = os.path.join(rdir, s + '.jpg')
        if not os.path.exists(f):
            continue
        rgb = C.load_rgb(f)
        try:
            res, _ = C.score(target, tmask, rgb, C.segment_plate(rgb, plate))
        except Exception as e:
            res = dict(total=0.0, iou=0.0, features=0.0, error=str(e))
        scores[s] = res
        print(f"{s:16s} total {res['total']:.3f}  iou {res['iou']:.3f}  feat {res['features']:.3f}", flush=True)
    json.dump(scores, open(sp, 'w'), indent=1)
    best = {}
    for s, r in scores.items():
        c = s.split('@')[0]
        if c not in best or r['total'] > scores[best[c]]['total']:
            best[c] = s
    ranked = sorted(best.values(), key=lambda s: -scores[s]['total'])
    keys = ['aspect', 'taper', 'pedestal', 'baseFlat', 'solidity', 'notch', 'litShadow', 'edge']
    lines = [f"{'render':16s} total   iou  feat  " + ' '.join(f'{k:>9s}' for k in keys)]
    lines.append(f"{'TARGET':16s}                   " + ' '.join(f'{target[k]:9.3f}' for k in keys))
    for s in ranked:
        r = scores[s]
        cd = r.get('card', {})
        lines.append(f"{s:16s} {r['total']:.3f} {r['iou']:.3f} {r['features']:.3f} " + ' '.join(f'{cd.get(k, 0):9.3f}' for k in keys))
    open(os.path.join(out, 'ranking.txt'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    # contact sheet: photo crop, then the top N (best yaw each), each cropped to its cloud
    box = target['box']
    photo = Image.open(T['photo']).convert('RGB').crop(tuple(box))
    pm = C.segment(np.asarray(photo).astype(np.float32) / 255, seed=None)
    tiles = [('target (photo crop)', crop_to_cloud(photo, pm), None)]
    for s in ranked[:a.top]:
        im = Image.open(os.path.join(rdir, s + '.jpg')).convert('RGB')
        m = C.segment_plate(np.asarray(im).astype(np.float32) / 255, plate)
        tiles.append((s, crop_to_cloud(im, m), scores[s]))
    W = sum(t[1].width for t in tiles) + 10 * (len(tiles) + 1)
    sheet = Image.new('RGB', (W, 360 + 60), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    x = 10
    for name, im, r in tiles:
        sheet.paste(im, (x, 50))
        d.text((x, 6), name, fill=(255, 210, 90))
        if r:
            d.text((x, 22), f"total {r['total']:.3f}  iou {r['iou']:.3f}  feat {r['features']:.3f}", fill=(200, 200, 200))
        x += im.width + 10
    sheet.save(os.path.join(out, f'top{a.top}.jpg'), quality=90)
    print('sheet', os.path.join(out, f'top{a.top}.jpg'))


if __name__ == '__main__':
    main()
