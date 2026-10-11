"""Correlation of the lighting terms' floret-scale band-pass (DoG sigma 4 - 12 px) inside the lit interior of the beauty render."""
import sys, os, importlib.util, numpy as np
from PIL import Image
spec = importlib.util.spec_from_file_location('fl', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'florets.py'))
fl = importlib.util.module_from_spec(spec); spec.loader.exec_module(fl)
E = sys.argv[1]; beauty = sys.argv[2]; box = [int(v) for v in sys.argv[3].split(',')]
def L(p):
    a = np.asarray(Image.open(p).convert('RGB').crop((box[0], box[1], box[0] + box[2], box[1] + box[3]))).astype(np.float32) / 255
    return a
b = L(beauty); Lb = (b @ fl.LUMA) * 255
cm = fl.erode(fl.cloud_mask(b), fl.EDGE); g = fl.gauss(Lb, 10); lit = cm & (g >= np.median(g[cm]))
terms = {'direct': 'lightDebug:1', 'ms': 'lightDebug:2', 'ambient': 'lightDebug:4'}
bp = {}
for k, t in terms.items():
    a = L(os.path.join(E, f'{os.path.basename(beauty).rsplit(".",1)[0]}@s.{t}.jpg')) @ fl.LUMA * 255
    d = fl.gauss(a, 4) - fl.gauss(a, 12)
    bp[k] = d[lit]
bp['beauty'] = (fl.gauss(Lb, 4) - fl.gauss(Lb, 12))[lit]
ks = list(bp)
print('band std:', {k: round(float(v.std()), 2) for k, v in bp.items()})
for i in ks:
    print(f'{i:8}', ' '.join(f'{np.corrcoef(bp[i], bp[j])[0,1]:+.2f}' for j in ks))
