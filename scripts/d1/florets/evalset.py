"""Floret metric (blobs = domes + pits per 1e4 lit px, REL 0.25) and lit-half bands3 on fixed 4k boxes of one bookmark, for a list of images."""
import sys, os, importlib.util, numpy as np
from PIL import Image
spec = importlib.util.spec_from_file_location('fl', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'florets.py'))
fl = importlib.util.module_from_spec(spec); spec.loader.exec_module(fl)
BOXES = {
    'p101': {'tower': (2304, 360, 800, 1040), 'leftmass': (696, 664, 1000, 660), 'cloud': (600, 450, 2600, 1150)},
    'p213': {'tower': (2200, 296, 960, 1120), 'base': (600, 1120, 1800, 600), 'cloud': (500, 250, 2900, 1500)},
    'p125': {'cloud': (700, 400, 2400, 1250), 'tower': (2350, 330, 700, 900)},
}
bm = sys.argv[1]
mask_from = None
for p in sys.argv[2:]:
    im = Image.open(p).convert('RGB')
    row = []
    for k, (x, y, w, h) in BOXES[bm].items():
        a = np.asarray(im.crop((x, y, x + w, y + h))).astype(np.float32) / 255
        m = fl.measure(a, top=0)
        if m is None: row.append(f'{k}: -'); continue
        b = m['b3lit']
        row.append(f'{k}: blobs {m["domes"]+m["pits"]:4.2f} (d {m["domes"]:.2f} p {m["pits"]:.2f}) b3lit {b[1]:.2f}/{b[2]:.2f}')
    name = os.path.basename(p).replace('.jpg', '').replace('.png', '').replace(bm + '@look:decima', '')[:58]
    print(f'{name:58} | ' + ' | '.join(row), flush=True)
