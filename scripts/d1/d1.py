#!/usr/bin/env python3
"""D1 Decima parity tools (numpy + Pillow only), on top of scripts/d0/d0.py.

Reference frames are Guerrilla's deck images (third party): read from the local artifacts folder, never written into the repo.

Subcommands
  stats <ref> <ours...> [--json out]      D0's parity numbers plus D1's surface measures, one row per render
  crops <out> <ref> <ours...> [--box x,y,w,h]   1:1 crops of the reference and the renders side by side (1920-wide frame coordinates)
  flicker <imgs...>                        temporal stability: per-pixel std of luminance across repeated shots of one view (inside the cloud)
  refof <bookmark>                         print the reference image path of a bookmark

Surface measures (960 px wide frames, luminance in sRGB 0..1, inside the cloud mask eroded by 6 px):
  pit    mean black-hat (closing with a 15 px square minus the image): depth of dark pockets smaller than ~15 px. Pitting.
  pit95  its 95th percentile (the worst pockets).
  grain  std of (L - 5x5 box blur of L): texture energy at 1-2 px; grainSh the same over the darker half of the body (sparkle in shadow).
  relief std of (5x5 blur of L - 25x25 blur of L): shading energy at the lobe scale (what makes billows read).
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'd0'))
import d0  # noqa: E402

MEDIA = '/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/n3/pptx/media'
FRAMES = '/Users/dex/Developer/WebGPUClouds/artifacts/research/d0-parity/ref/frames'
REF_OF = {
    'p101': f'{MEDIA}/image101.png', 'p125': f'{MEDIA}/image127.png', 'p161': f'{MEDIA}/image162.png', 'p213': f'{MEDIA}/image213.png',
    's206': f'{MEDIA}/image206.png', 's33t3': f'{FRAMES}/media33-t3.png', 's33t6': f'{FRAMES}/media33-t6.png', 's33t9': f'{FRAMES}/media33-t9.png',
    's214': f'{MEDIA}/image214.png',
}


def ref_of(path_or_bookmark):
    b = os.path.basename(path_or_bookmark).split('@')[0].split('.')[0]
    return REF_OF[b]


def erode(mask, r):
    m = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                m &= np.roll(np.roll(mask, dy, 0), dx, 1)
    return m


def rank_filter(L, r, op):
    """Separable max (op = np.maximum) or min (np.minimum) over a (2r+1)^2 square window, edges padded with the image's own border."""
    out = L.copy()
    for axis in (0, 1):
        acc = out.copy()
        for k in range(1, r + 1):
            for sgn in (1, -1):
                sh = np.roll(out, sgn * k, axis)
                if axis == 0:
                    if sgn > 0: sh[:k] = out[:1]
                    else: sh[-k:] = out[-1:]
                else:
                    if sgn > 0: sh[:, :k] = out[:, :1]
                    else: sh[:, -k:] = out[:, -1:]
                acc = op(acc, sh)
        out = acc
    return out


def surface_measures(rgb, mask):
    L = rgb @ d0.LUMA
    inner = erode(mask, 6)
    if inner.sum() < 100:
        return {}
    closing = rank_filter(rank_filter(L, 7, np.maximum), 7, np.minimum)
    bh = (closing - L)[inner]
    b5 = d0.box_blur(L, 2); b25 = d0.box_blur(L, 12)
    shade = inner & (b25 < np.median(b25[inner]))   # the darker half of the body at the lobe scale: where sparkle shows
    return {'pit': round(float(bh.mean()), 4), 'pit95': round(float(np.percentile(bh, 95)), 4),
            'grain': round(float((L - b5)[inner].std()), 4), 'grainSh': round(float((L - b5)[shade].std()), 4) if shade.sum() > 100 else 0.0,
            'relief': round(float((b5 - b25)[inner].std()), 4)}


def matte_mask(path, width):
    """Our exact silhouette from the page's matte shot (1 - transmittance as grey): opacity > MATTE_ALPHA."""
    return d0.load_rgb(path, width)[..., 0] > d0.MATTE_ALPHA


def one_stats(ref, ours, width=960, matte=None):
    rr, mr, resr, skyr = d0.ref_mask(ref, width)
    ro, mo, reso, skyo = d0.ref_mask(ours, width)
    if matte:
        mo = matte_mask(matte, width)
    out = {'ref': {**d0.frame_stats(rr, mr, resr, skyr), **surface_measures(rr, mr)},
           'ours': {**d0.frame_stats(ro, mo, reso, skyo), **surface_measures(ro, mo)}}
    out['iou'] = round(d0.iou(mr, mo), 3)
    both = mr & mo
    if both.sum() > 50:
        x = d0.box_blur(rr @ d0.LUMA, 2)[both]; y = d0.box_blur(ro @ d0.LUMA, 2)[both]
        out['corr'] = round(float(np.corrcoef(x, y)[0, 1]), 3)
    return out


COLS = ['median', 'lit_p90', 'shade_p10', 'sky_mean', 'cloud_sky', 'shade_BR', 'lit_BR', 'sky_BR', 'edge', 'pit', 'pit95', 'grain', 'grainSh', 'relief']


def cmd_stats(a):
    rows = []
    ref = a.ref
    first = one_stats(ref, a.ours[0], a.width, a.matte)
    rows.append(('REF ' + os.path.basename(ref), first['ref'], None, None))
    for p in a.ours:
        s = one_stats(ref, p, a.width, a.matte)
        rows.append((os.path.basename(p), s['ours'], s['iou'], s.get('corr')))
    w = max(len(r[0]) for r in rows)
    print(' ' * w, '  iou  corr ', ' '.join(f'{c:>9}' for c in COLS))
    for name, st, iou_, corr in rows:
        rgb = ' shade(%s) lit(%s)' % (','.join(f'{v:.2f}' for v in st.get('shade_rgb', [])), ','.join(f'{v:.2f}' for v in st.get('lit_rgb', []))) if a.rgb else ''
        print(name.ljust(w), f'{iou_ if iou_ is not None else "":>5}', f'{corr if corr is not None else "":>5}', ' '.join(f'{st.get(c, float("nan")):9.3f}' for c in COLS) + rgb)
    if a.json:
        json.dump({os.path.basename(p): one_stats(ref, p, a.width, a.matte) for p in a.ours}, open(a.json, 'w'), indent=1)


def load1920(path):
    im = Image.open(path).convert('RGB')
    if im.width != 1920:
        im = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
    return im


def cmd_crops(a):
    x, y, w, h = [int(v) for v in a.box.split(',')]
    scale = a.scale
    tiles = []
    for p in [a.ref] + a.ours:
        im = load1920(p).crop((x, y, x + w, y + h)).resize((w * scale, h * scale), Image.LANCZOS)
        d = ImageDraw.Draw(im); d.rectangle([0, 0, w * scale, 14], fill=(0, 0, 0)); d.text((3, 1), os.path.basename(p)[:90], fill=(255, 255, 0))
        tiles.append(im)
    cols = min(len(tiles), a.cols)
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * w * scale, rows * h * scale), (30, 30, 30))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * w * scale, (i // cols) * h * scale))
    sheet.save(a.out, quality=90)


def cmd_flicker(a):
    frames = [d0.load_rgb(p, a.width) for p in a.imgs]
    rgb, mask, _, _ = d0.ref_mask(a.imgs[0], a.width)
    inner = erode(mask, 4)
    L = np.stack([f @ d0.LUMA for f in frames])
    sd = L.std(0)
    diff = np.abs(np.diff(L, axis=0)).mean(0)
    print(json.dumps({'frames': len(frames), 'std_mean': round(float(sd[inner].mean()), 5), 'std_p95': round(float(np.percentile(sd[inner], 95)), 5),
                      'absdiff_mean': round(float(diff[inner].mean()), 5), 'frac_std_gt_0.01': round(float((sd[inner] > 0.01).mean()), 4)}))


def main():
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('stats'); s.add_argument('ref'); s.add_argument('ours', nargs='+'); s.add_argument('--width', type=int, default=960); s.add_argument('--json'); s.add_argument('--matte', help='our matte shot of the same bookmark: exact silhouette instead of the sky fit'); s.add_argument('--rgb', action='store_true', help='append shade / lit RGB')
    s = sub.add_parser('crops'); s.add_argument('out'); s.add_argument('ref'); s.add_argument('ours', nargs='+'); s.add_argument('--box', default='560,180,700,500'); s.add_argument('--scale', type=int, default=1); s.add_argument('--cols', type=int, default=3)
    s = sub.add_parser('flicker'); s.add_argument('imgs', nargs='+'); s.add_argument('--width', type=int, default=960)
    s = sub.add_parser('refof'); s.add_argument('bookmark')
    a = p.parse_args()
    if a.cmd == 'refof':
        print(ref_of(a.bookmark)); return
    {'stats': cmd_stats, 'crops': cmd_crops, 'flicker': cmd_flicker}[a.cmd](a)


if __name__ == '__main__':
    main()
