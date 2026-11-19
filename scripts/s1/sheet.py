#!/usr/bin/env python3
"""S1 sheets: per view, columns side by side (a style or an A/B step each), the full frame scaled down, then 1:1 crops of a lit ridge and a
base (480 x 320 of the 1920 x 1080 capture).

  python3 scripts/s1/sheet.py OUT.jpg horizon=work/captures/S1/horizon early=work/captures/S1/early [--shots gp7,ground] [--width 760]

One sheet per view is written next to OUT as OUT-<view>.jpg, plus OUT itself with every view stacked.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

CROPS = {  # view -> [(name, (x, y, w, h))] in 1920 x 1080 capture pixels
    'gp7': [('lit ridge', (1000, 330, 480, 320)), ('base', (800, 520, 480, 320))],
    'ground': [('lit ridge', (950, 40, 480, 320)), ('base', (650, 250, 480, 320))],
    'above': [('lit tops', (700, 420, 480, 320)), ('edge', (1000, 600, 480, 320))],
    'sunset': [('lit rim', (1150, 200, 480, 320)), ('base', (500, 180, 480, 320))],
}

def font(size):
    for f in ('/System/Library/Fonts/Menlo.ttc', '/System/Library/Fonts/Helvetica.ttc'):
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()

def gpu_ms(d, view):
    try:
        cap = json.load(open(os.path.join(d, 'capture.json')))
        for s in cap.get('shots', []):
            if s.get('name') == view or s.get('bookmark') == view:
                g = (s.get('report') or {}).get('gpuMs') or s.get('gpu') or {}
                return g.get('skyLayer'), g.get('total')
    except Exception: pass
    return None, None

def view_sheet(cols, view, width):
    imgs = []
    for label, d in cols:
        p = next((os.path.join(d, f'{view}.{e}') for e in ('png', 'jpg') if os.path.exists(os.path.join(d, f'{view}.{e}'))), None)
        imgs.append((label, d, Image.open(p).convert('RGB') if p else None))
    crops = CROPS.get(view, [])
    h_full = int(width * 1080 / 1920)
    pad, head = 8, 26
    crop_h = sum(int(c[1][3] * width / c[1][2]) if c[1][2] > width else c[1][3] for c in crops)
    H = head + h_full + pad + sum(min(c[1][3], int(c[1][3] * width / c[1][2])) + pad + 18 for c in crops) + pad
    W = len(cols) * (width + pad) + pad
    sheet = Image.new('RGB', (W, H), (18, 20, 24))
    dr = ImageDraw.Draw(sheet)
    f, fs = font(16), font(13)
    for i, (label, d, im) in enumerate(imgs):
        x = pad + i * (width + pad)
        sky, tot = gpu_ms(d, view)
        ms = f'  sky {sky:.1f} ms' if isinstance(sky, (int, float)) else ''
        dr.text((x, 4), f'{view} · {label}{ms}', fill=(230, 230, 230), font=f)
        if im is None: continue
        sheet.paste(im.resize((width, h_full), Image.LANCZOS), (x, head))
        y = head + h_full + pad
        for name, (cx, cy, cw, ch) in crops:
            dr.text((x, y), f'1:1 {name}', fill=(200, 200, 200), font=fs)
            y += 18
            c = im.crop((cx, cy, cx + cw, cy + ch))
            if cw > width: c = c.resize((width, int(ch * width / cw)), Image.LANCZOS)
            sheet.paste(c, (x, y))
            # mark the crop on the full frame
            s = width / 1920
            dr.rectangle([x + cx * s, head + cy * s, x + (cx + cw) * s, head + (cy + ch) * s], outline=(255, 210, 0))
            y += c.height + pad
    return sheet

def main():
    a = sys.argv[1:]
    shots, width = ['gp7', 'ground', 'above', 'sunset'], 640
    if '--shots' in a: i = a.index('--shots'); shots = a[i + 1].split(','); del a[i:i + 2]
    if '--width' in a: i = a.index('--width'); width = int(a[i + 1]); del a[i:i + 2]
    out, cols = a[0], [tuple(c.split('=', 1)) for c in a[1:]]
    base = out[:-4] if out.lower().endswith(('.jpg', '.png')) else out
    sheets = []
    for v in shots:
        s = view_sheet(cols, v, width)
        s.save(f'{base}-{v}.jpg', quality=92)
        sheets.append(s)
    W = max(s.width for s in sheets)
    full = Image.new('RGB', (W, sum(s.height for s in sheets)), (18, 20, 24))
    y = 0
    for s in sheets: full.paste(s, (0, y)); y += s.height
    full.save(out, quality=90)
    print(out, [f'{base}-{v}.jpg' for v in shots])

if __name__ == '__main__':
    main()
