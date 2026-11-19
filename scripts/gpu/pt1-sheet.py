#!/usr/bin/env python3
"""PT1 sheets and numbers: path traced | ours Nubis | ours octave, per sun setup, from a reference-pt capture.

  python3 scripts/gpu/pt1-sheet.py work/captures/PT1 [noon low backlit]

Reads <dir>/{pt,nubis,octave,alpha}-<sun>.png (capture.mjs --page reference-pt/ --format png). Writes <dir>/sheet-<sun>.jpg (full frames
cropped to the cloud, then 2x crops of the top, the body and the base) and <dir>/stats.json. The alpha view is the PT side's opacity of
the baked grid (1 - exp(-optical depth)); it defines the regions. Values are display-referred (after the shared ACES + sRGB): luminance is
the Rec.709 luma of the decoded sRGB, so ratios compare what the eye sees on the page, not scene radiance.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

RENDERERS = ['pt', 'nubis', 'octave']
LABELS = {'pt': 'path traced (ground truth)', 'nubis': 'ours: Nubis lighting', 'octave': 'ours: octave lighting'}


def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.float32) / 255.0


def lin(srgb):
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def luma(img):
    l = lin(img)
    return 0.2126 * l[..., 0] + 0.7152 * l[..., 1] + 0.0722 * l[..., 2]


def font(size):
    for f in ['/System/Library/Fonts/Menlo.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf']:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def region_stats(img, mask):
    if mask.sum() < 50:
        return None
    y = luma(img)[mask]
    rgb = lin(img)[mask]
    mean = rgb.mean(0)
    return {
        'pixels': int(mask.sum()),
        'luma_mean': round(float(y.mean()), 4),
        'luma_p10': round(float(np.percentile(y, 10)), 4),
        'luma_p50': round(float(np.percentile(y, 50)), 4),
        'luma_p90': round(float(np.percentile(y, 90)), 4),
        'rgb_mean_linear': [round(float(v), 4) for v in mean],
        'b_over_r': round(float(mean[2] / max(mean[0], 1e-6)), 3),
        'srgb_mean_8bit': [int(round(float(v) * 255)) for v in (img[mask].mean(0))],
    }


def main():
    d = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/captures/PT1')
    suns = sys.argv[2:] or ['noon', 'low', 'backlit']
    stats = {}
    for sun in suns:
        paths = {r: d / f'{r}-{sun}.png' for r in RENDERERS + ['alpha']}
        if not all(p.exists() for p in paths.values()):
            print('skip', sun, [str(p) for p in paths.values() if not p.exists()])
            continue
        imgs = {r: load(paths[r]) for r in RENDERERS}
        alpha = load(paths['alpha'])[..., 0]
        cloud = alpha > 0.5
        ys, xs = np.nonzero(alpha > 0.02)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        cy0, cy1 = np.nonzero(cloud)[0].min(), np.nonzero(cloud)[0].max()
        h = cy1 - cy0
        rows = np.arange(alpha.shape[0])[:, None]
        # Regions: thin edge (silhouette fringe), thick body, top third and bottom third (the base) of the opaque cloud, and its darkest / brightest.
        regions = {
            'cloud': cloud,
            'edge_thin': (alpha > 0.05) & (alpha < 0.6),
            'thick': alpha > 0.995,
            'top_third': cloud & (rows < cy0 + h / 3),
            'base_third': cloud & (rows > cy1 - h / 3),
        }
        pt_y = luma(imgs['pt'])
        if cloud.sum():
            lo, hi = np.percentile(pt_y[cloud], [20, 90])
            regions['pt_darkest20'] = cloud & (pt_y <= lo)   # where the path tracer is in shade
            regions['pt_brightest10'] = cloud & (pt_y >= hi)  # where it is lit
        stats[sun] = {r: {k: region_stats(imgs[r], m) for k, m in regions.items()} for r in RENDERERS}
        # Per-pixel agreement with the PT over the cloud.
        for r in ['nubis', 'octave']:
            dy = luma(imgs[r])[cloud] - pt_y[cloud]
            stats[sun][r]['vs_pt'] = {'luma_bias': round(float(dy.mean()), 4), 'luma_rmse': round(float(np.sqrt((dy ** 2).mean())), 4),
                                      'ratio_of_means': round(float(luma(imgs[r])[cloud].mean() / max(pt_y[cloud].mean(), 1e-6)), 3)}

        # ---- sheet ----
        m = 40
        bx0, by0, bx1, by1 = max(0, x0 - m), max(0, y0 - m), min(alpha.shape[1], x1 + m), min(alpha.shape[0], y1 + m)
        full = {r: Image.fromarray((imgs[r][by0:by1, bx0:bx1] * 255).astype(np.uint8)) for r in RENDERERS}
        fw, fh = full['pt'].size
        # Crops (2x nearest): the sun-side top, the middle of the body, the base. Each 240x160 source px around the region's centroid.
        def centroid(mask):
            yy, xx = np.nonzero(mask)
            return (int(xx.mean()), int(yy.mean())) if len(xx) else ((x0 + x1) // 2, (y0 + y1) // 2)
        top_band = cloud & (rows < cy0 + h / 4)
        crops = {
            'top (lit crowns)': centroid(regions['pt_brightest10'] & top_band) if 'pt_brightest10' in regions and (regions['pt_brightest10'] & top_band).sum() > 50 else centroid(top_band),
            'body (mid)': centroid(cloud & (rows > cy0 + 0.35 * h) & (rows < cy0 + 0.65 * h)),
            'base': centroid(cloud & (rows > cy1 - h / 5)),
        }
        cw, ch, s = 240, 160, 2
        pad, title_h, label_h = 12, 34, 22
        width = 3 * fw + 4 * pad
        crop_row_h = ch * s + label_h
        height = title_h + label_h + fh + pad + len(crops) * (crop_row_h + pad) + pad
        sheet = Image.new('RGB', (max(width, 3 * cw * s + 4 * pad), height), (18, 18, 20))
        dr = ImageDraw.Draw(sheet)
        f1, f2 = font(18), font(14)
        dr.text((pad, 8), f'PT1 {sun}: same density, sun, sky, camera and tone map. Left: path traced. Middle / right: our realtime models.', fill=(230, 230, 230), font=f1)
        for i, r in enumerate(RENDERERS):
            x = pad + i * (fw + pad)
            dr.text((x, title_h), LABELS[r], fill=(220, 220, 220), font=f2)
            sheet.paste(full[r], (x, title_h + label_h))
        y = title_h + label_h + fh + pad
        cw_total = cw * s
        for name, (cx, cy) in crops.items():
            sx0 = int(np.clip(cx - cw // 2, 0, alpha.shape[1] - cw)); sy0 = int(np.clip(cy - ch // 2, 0, alpha.shape[0] - ch))
            for i, r in enumerate(RENDERERS):
                x = pad + i * (max(fw, cw_total) + pad) if fw >= cw_total else pad + i * (cw_total + pad)
                c = Image.fromarray((imgs[r][sy0:sy0 + ch, sx0:sx0 + cw] * 255).astype(np.uint8)).resize((cw_total, ch * s), Image.NEAREST)
                dr.text((x, y), f'{name}, 2x  ({LABELS[r].split(":")[0]})', fill=(200, 200, 200), font=f2)
                sheet.paste(c, (x, y + label_h))
            y += crop_row_h + pad
        out = d / f'sheet-{sun}.jpg'
        sheet.save(out, quality=95)
        print('wrote', out, sheet.size)
    (d / 'stats.json').write_text(json.dumps(stats, indent=1))
    print('wrote', d / 'stats.json')
    variants(d, suns)


# PT controls (subdirectories of the capture, same shots): the phase (g 0.46 = our dual lobe's mean cosine), the albedo, the bake resolution.
VARIANTS = [('', 'PT g 0.8, albedo 0.99, 2 m'), ('var-g046', 'PT g 0.46 (our mean cosine)'), ('var-albedo0999', 'PT albedo 0.999'), ('var-voxel125', 'PT 1.25 m bake (noon only)')]


def variants(d, suns):
    rows = []
    for sun in suns:
        alpha = d / f'alpha-{sun}.png'
        if not alpha.exists():
            continue
        a = load(alpha)[..., 0]
        ys, xs = np.nonzero(a > 0.02)
        box = (max(0, xs.min() - 30), max(0, ys.min() - 30), min(a.shape[1], xs.max() + 30), min(a.shape[0], ys.max() + 30))
        cells = []
        for sub, label in VARIANTS:
            p = (d / sub / f'pt-{sun}.png') if sub else d / f'pt-{sun}.png'
            cells.append((label, Image.open(p).convert('RGB').crop(box) if p.exists() else None))
        rows.append((sun, cells))
    if not rows:
        return
    cw = max(c.size[0] for _, cells in rows for _, c in cells if c)
    pad, lh = 10, 22
    heights = [max(c.size[1] for _, c in cells if c) for _, cells in rows]
    sheet = Image.new('RGB', (pad + len(VARIANTS) * (cw + pad), 40 + sum(h + lh + pad for h in heights)), (18, 18, 20))
    dr = ImageDraw.Draw(sheet)
    dr.text((pad, 10), 'PT1 controls: what moves the path-traced reference (same density, sun, sky, camera)', fill=(230, 230, 230), font=font(18))
    y = 40
    for (sun, cells), h in zip(rows, heights):
        for i, (label, c) in enumerate(cells):
            x = pad + i * (cw + pad)
            dr.text((x, y), f'{sun}: {label}', fill=(210, 210, 210), font=font(14))
            if c:
                sheet.paste(c, (x, y + lh))
        y += h + lh + pad
    sheet.save(d / 'sheet-controls.jpg', quality=92)
    print('wrote', d / 'sheet-controls.jpg', sheet.size)


if __name__ == '__main__':
    main()
