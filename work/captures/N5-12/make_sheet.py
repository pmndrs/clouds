import sys, json, base64, numpy as np
from PIL import Image, ImageDraw
S, tag, out = sys.argv[1], sys.argv[2], sys.argv[3]
def load(d):
    b = ''.join(json.load(open(f'{d}/chunk{k}.json')) for k in range(4))
    a = np.frombuffer(base64.b64decode(b), dtype=np.float32).reshape(3, 512, 512)
    return a[:, ::-1, ::-1]  # rdv order -> image order (180 degrees), as the page's display
o, e = load(f'{S}/{tag}onnx'), load(f'{S}/{tag}engine')
d = np.abs(e - o)
print(json.dumps({'maxAbs': float(d.max()), 'meanAbs': float(d.mean()), 'meanRef': float(np.abs(o).mean()), 'relL2': float(np.sqrt((d**2).sum() / (o**2).sum())), 'nonFinite': int((~np.isfinite(e)).sum())}))
tone = lambda a: np.clip(1 - np.exp(-np.maximum(a, 0) * 2.0), 0, 1) ** (1 / 2.2)
to8 = lambda a: Image.fromarray((np.transpose(a, (1, 2, 0)) * 255 + 0.5).astype(np.uint8))
panels = [('ONNX Runtime', to8(tone(o))), ('our engine (GPU blend)', to8(tone(e))), ('x100 |engine - ONNX| (linear)', to8(np.clip(d * 100, 0, 1)))]
LH = 24
sheet = Image.new('RGB', (512 * 3, 512 + LH))
dr = ImageDraw.Draw(sheet)
for i, (t, im) in enumerate(panels):
    sheet.paste(im, (i * 512, LH)); dr.text((i * 512 + 6, 6), f'{t} 512^2 {sys.argv[4]}, 16 spp', fill=(220, 220, 220))
sheet.save(out, quality=92)
