#!/usr/bin/env python3
"""P1.1 single-scatter analysis (docs/AUDIT-2026-11.md step 1.1). Uses scripts/gpu/scorecard.py's regions and readers.

  p11.py cycles  DIR            Cycles Volume Direct / Combined vs the PT's depth-capped frames (DIR = work/captures/P1-1/cycles)
  p11.py gate    DIR            the gate table: <cloud>/{pt-<sun>, seed2/pt-<sun>, nubis-<sun>, alpha-<sun>}.pfm -> gate.json, gate.md
  p11.py sheets  DIR            one contact sheet per cloud: PT | realtime, single scatter, four suns -> DIR/<cloud>-sheet.jpg
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts' / 'gpu'))
import scorecard as sc  # noqa: E402

REGIONS = ['cloud', 'thick', 'base', 'fringe']
SUNS = ['noon', 'low', 'backlit', 'sunset']
CLOUDS = ['parkouring', 'embergen02', 'sky', 'stratus']


def region_means(img, alpha, ref_lum):
    reg = sc.regions(alpha, ref_lum)
    lum = sc.luminance(img)
    return {k: float(lum[reg[k]].mean()) if reg[k].sum() >= 50 else None for k in REGIONS}


def ratios(test, ref, alpha):
    lr = sc.luminance(ref)
    a, b = region_means(test, alpha, lr), region_means(ref, alpha, lr)
    return {k: (a[k] / b[k] if a[k] and b[k] else None) for k in REGIONS}


def cycles(d):
    d = Path(d)
    alpha = sc.as_mask(sc.read_pfm(d / 'seed1' / 'alpha-noon.pfm'))
    p1, p2 = sc.read_pfm(d / 'seed1' / 'pt-noon.pfm'), sc.read_pfm(d / 'seed2' / 'pt-noon.pfm')
    pt, half = sc.averaged_reference(p1, p2)
    out = {}
    noise = ratios(p1, p2, alpha)
    out['pt seed1 / seed2'] = noise
    for name, f in [('Cycles Volume Direct', 'cycles.volume_direct.pfm'), ('Cycles Combined (0 bounces)', 'cycles.pfm'), ('Cycles Volume Indirect', 'cycles.volume_indirect.pfm')]:
        out[f'{name} / PT depth 1'] = ratios(sc.read_pfm(d / f), pt, alpha)
    out['PT depth 2 / PT depth 1'] = ratios(sc.read_pfm(d / 'depth2' / 'pt-noon.pfm'), pt, alpha)
    lines = ['| comparison | ' + ' | '.join(REGIONS) + ' |', '|---|' + '---|' * len(REGIONS)]
    for k, v in out.items():
        lines.append(f'| {k} | ' + ' | '.join('-' if v[r] is None else f'{v[r]:.4f}' for r in REGIONS) + ' |')
    (d / 'cycles-vs-pt.json').write_text(json.dumps(out, indent=1))
    (d / 'cycles-vs-pt.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


def gate(d):
    d = Path(d)
    res = {}
    for cloud in CLOUDS:
        for sun in SUNS:
            c = d / cloud
            try:
                alpha = sc.as_mask(sc.read_pfm(c / f'alpha-{sun}.pfm'))
                p1, p2 = sc.read_pfm(c / f'pt-{sun}.pfm'), sc.read_pfm(c / 'seed2' / f'pt-{sun}.pfm')
                rt = sc.read_pfm(c / f'nubis-{sun}.pfm')
            except FileNotFoundError as e:
                print('missing', e)
                continue
            pt, _ = sc.averaged_reference(p1, p2)
            r = ratios(rt, pt, alpha)
            n = ratios(p1, p2, alpha)
            res[f'{cloud}-{sun}'] = {'ratio': r, 'seedRatio': n, 'albedoCorrected': {k: (v * 0.99 if v else None) for k, v in r.items()}}
            extra = c / f'nubis-{sun}-centre.pfm'
            if extra.exists():
                res[f'{cloud}-{sun}']['sunAtCentre'] = ratios(sc.read_pfm(extra), pt, alpha)
    (d / 'gate.json').write_text(json.dumps(res, indent=1))
    lines = ['| frame | cloud | thick | base | fringe | seed1/seed2 (max dev) |', '|---|---|---|---|---|---|']
    ok = total = 0
    for k, v in res.items():
        cells = []
        for r in REGIONS:
            x = v['ratio'][r]
            if x is None:
                cells.append('-'); continue
            total += 1
            good = abs(x - 1) <= 0.05
            ok += good
            cells.append(f'{x:.3f}' if good else f'**{x:.3f}**')
        nd = max(abs(x - 1) for x in v['seedRatio'].values() if x)
        lines.append(f'| {k} | ' + ' | '.join(cells) + f' | {nd:.4f} |')
    lines.append(f'\nwithin 5 %: {ok} of {total}')
    (d / 'gate.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


def sheets(d, exposure=0.35, tile_h=180):
    from PIL import Image, ImageDraw
    d = Path(d)
    for cloud in CLOUDS:
        rows = []
        for sun in SUNS:
            c = d / cloud
            try:
                p1, p2 = sc.read_pfm(c / f'pt-{sun}.pfm'), sc.read_pfm(c / 'seed2' / f'pt-{sun}.pfm')
                rt = sc.read_pfm(c / f'nubis-{sun}.pfm')
            except FileNotFoundError:
                continue
            pt, _ = sc.averaged_reference(p1, p2)
            # Each sun at its own exposure (the PT's 99th percentile of cloud luminance to 0.8 on screen), the same for both sides.
            lum = sc.luminance(pt)
            k = np.percentile(lum[lum > 0], 99) if (lum > 0).any() else 1.0
            ex = exposure * 0.35 / max(k * exposure, 1e-9) * 2.0
            tiles = [sc.aces_srgb(x, ex) for x in (pt, rt)]
            row = np.concatenate([tiles[0], np.full((tiles[0].shape[0], 4, 3), 1.0), tiles[1]], axis=1)
            im = Image.fromarray((np.clip(row, 0, 1) * 255).astype(np.uint8))
            w = int(im.width * tile_h / im.height)
            im = im.resize((w, tile_h), Image.LANCZOS)
            ImageDraw.Draw(im).text((4, 2), f'{cloud} {sun}: PT single scatter | realtime direct (converged)', fill=(255, 255, 0))
            rows.append(im)
        if not rows:
            continue
        sheet = Image.new('RGB', (rows[0].width, sum(r.height for r in rows)))
        y = 0
        for r in rows:
            sheet.paste(r, (0, y)); y += r.height
        sheet.save(d / f'{cloud}-sheet.jpg', quality=85)
        print('sheet', d / f'{cloud}-sheet.jpg')


if __name__ == '__main__':
    cmd, arg = sys.argv[1], sys.argv[2]
    {'cycles': cycles, 'gate': gate, 'sheets': sheets}[cmd](arg)
