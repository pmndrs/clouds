#!/usr/bin/env python3
"""N2d: build the features parity sheet. usage: parity-sheet.py theirs.f32 ours.f32 out.jpg
Both inputs: 14 channels x 512 x 512 float32, rdv pixel order (our view turned 180 degrees); channels as the ONNX condition 0..13."""
import sys, array, struct
from PIL import Image, ImageDraw
N = 512
def load(p):
    a = array.array('f'); a.frombytes(open(p, 'rb').read()); return [a[c*N*N:(c+1)*N*N] for c in range(14)]
T, O = load(sys.argv[1]), load(sys.argv[2])
ROWS = [  # label, channels (1 = grey, 3 = rgb), display scale (value * scale)
    ('tr  (reduced optical depth)', [4], 1.0), ('S  (1 - exp(-tau))', [13], 1.0), ('depth  log(1+0.2 t1)', [0], 2.0),
    ('crossing 2 (gap^0.25)', [1], 1.0), ('crossing 3', [2], 1.0), ('crossing 4', [3], 1.0),
    ('nee  (sun transmittance)', [6], 1.0), ('albedo feature (R)', [10], 1.0), ('environment RGB (our sky differs)', [7, 8, 9], 2.0)]
def img(ch, chans, scale):
    # rot180 of rdv order -> our view order; reverse the flat list
    def plane(c): return ch[c][::-1]
    if len(chans) == 1:
        p = plane(chans[0]); return Image.frombytes('L', (N, N), bytes(max(0, min(255, int(v*scale*255 + .5))) for v in p))
    ps = [plane(c) for c in chans]; px = bytearray()
    for i in range(N*N):
        for p in ps: px.append(max(0, min(255, int(p[i]*scale*255 + .5))))
    return Image.frombytes('RGB', (N, N), bytes(px))
def stat(ch, chans):
    p = [v for v in ch[chans[0]]]; cov = [v for v in ch[13] if v > 0.01]
    s = sorted(p); return 'mean %.3f p99 %.3f' % (sum(p)/len(p), s[int(len(s)*0.99)])
W = 256; pad = 4; head = 22
cols = 2; sheet = Image.new('RGB', (cols*W + 120 + pad*3, head + len(ROWS)*(W+pad)), (20, 20, 24))
d = ImageDraw.Draw(sheet)
d.text((124, 4), 'THEIRS (authors, rdv web demo)', fill=(255, 255, 255)); d.text((124 + W + pad, 4), 'OURS (lab /neural/)', fill=(255, 255, 255))
for r, (lab, chans, sc) in enumerate(ROWS):
    y = head + r*(W+pad)
    for ci, ch in enumerate((T, O)):
        im = img(ch, chans, sc).resize((W, W), Image.BILINEAR); sheet.paste(im, (124 + ci*(W+pad), y))
        d.text((128 + ci*(W+pad), y + W - 14), stat(ch, chans), fill=(255, 220, 80))
    words = lab.split('  '); 
    for k, w in enumerate(lab.replace('  ', '\n').replace(' (', '\n(').split('\n')): d.text((4, y + 4 + k*13), w, fill=(220, 220, 220))
    d.text((4, y + W - 14), 'x%.1f' % sc, fill=(150, 150, 150))
sheet.save(sys.argv[3], quality=88)
for r, (lab, chans, sc) in enumerate(ROWS): print(lab, '| theirs', stat(T, chans), '| ours', stat(O, chans))
