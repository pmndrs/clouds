#!/usr/bin/env python3
"""S2 sheets: per view, columns side by side (one A/B step each): the full frame scaled down, 1:1 crops of a lit ridge and a base (480 x 320 of the
1920 x 1080 capture), then the middle 240 x 160 of the lit crop at 2x (nearest), where the hatch and the grain are easiest to see.

  python3 scripts/s2/sheet.py OUT.jpg a=work/captures/S2/x/a b=work/captures/S2/x/b [--shots gp7,above] [--width 480]

One sheet per view is written next to OUT as OUT-<view>.jpg.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

CROPS = {  # view -> [(name, (x, y, w, h))] in 1920 x 1080 capture pixels (S1's crops)
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
            if s.get('name') == view:
                g = (s.get('report') or {}).get('gpuMs') or {}
                return g.get('skyLayer'), g.get('upscale')
    except Exception: pass
    return None, None

def view_sheet(cols, view, width):
    crops = CROPS[view]
    zx, zy, zw, zh = crops[0][1]
    zoom = (zx + zw // 4, zy + zh // 4, zw // 2, zh // 2)
    rows = [(f'1:1 {n}', b, 1) for n, b in crops] + [(f'2x {crops[0][0]} (middle)', zoom, 2)]
    h_full = int(width * 1080 / 1920)
    pad, head = 8, 26
    H = head + h_full + pad + sum(18 + min(b[3] * z, int(b[3] * z * width / (b[2] * z))) + pad for _, b, z in rows) + pad
    W = len(cols) * (width + pad) + pad
    sheet = Image.new('RGB', (W, H), (18, 20, 24))
    dr = ImageDraw.Draw(sheet)
    f, fs = font(15), font(13)
    for i, (label, d) in enumerate(cols):
        x = pad + i * (width + pad)
        p = next((os.path.join(d, f'{view}.{e}') for e in ('png', 'jpg') if os.path.exists(os.path.join(d, f'{view}.{e}'))), None)
        sky, up = gpu_ms(d, view)
        ms = f'  sky {sky:.1f} ms' if isinstance(sky, (int, float)) else ''
        dr.text((x, 4), f'{view} · {label}{ms}', fill=(230, 230, 230), font=f)
        if p is None: continue
        im = Image.open(p).convert('RGB')
        sheet.paste(im.resize((width, h_full), Image.LANCZOS), (x, head))
        s = width / 1920
        y = head + h_full + pad
        for name, (cx, cy, cw, ch), z in rows:
            dr.text((x, y), name, fill=(200, 200, 200), font=fs)
            y += 18
            c = im.crop((cx, cy, cx + cw, cy + ch))
            if z != 1: c = c.resize((cw * z, ch * z), Image.NEAREST)
            if c.width > width: c = c.resize((width, int(c.height * width / c.width)), Image.LANCZOS)
            sheet.paste(c, (x, y))
            dr.rectangle([x + cx * s, head + cy * s, x + (cx + cw) * s, head + (cy + ch) * s], outline=(255, 210, 0) if z == 1 else (0, 200, 255))
            y += c.height + pad
    return sheet

def main():
    a = sys.argv[1:]
    shots, width = ['gp7', 'above'], 480
    if '--shots' in a: i = a.index('--shots'); shots = a[i + 1].split(','); del a[i:i + 2]
    if '--width' in a: i = a.index('--width'); width = int(a[i + 1]); del a[i:i + 2]
    out, cols = a[0], [tuple(c.split('=', 1)) for c in a[1:]]
    base = out[:-4] if out.lower().endswith(('.jpg', '.png')) else out
    os.makedirs(os.path.dirname(base) or '.', exist_ok=True)
    for v in shots:
        view_sheet(cols, v, width).save(f'{base}-{v}.jpg', quality=93)
        print(f'{base}-{v}.jpg')

if __name__ == '__main__':
    main()
