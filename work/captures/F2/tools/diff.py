"""F2: mean and p99 absolute difference (0..255) between the same shots of two capture folders, sky part only (rows above the horizon
line are where the clouds are; the whole frame is used, the ground is identical anyway).
  python3 -I work/captures/F2/tools/diff.py <dirA> <dirB> [shot ...]"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

a, b = Path(sys.argv[1]), Path(sys.argv[2])
shots = sys.argv[3:] or sorted(p.stem for p in a.glob('*.jpg'))
for s in shots:
    x = np.asarray(Image.open(a / f'{s}.jpg').convert('RGB'), dtype=np.float32)
    y = np.asarray(Image.open(b / f'{s}.jpg').convert('RGB'), dtype=np.float32)
    d = np.abs(x - y).mean(axis=2)
    print(f'{s:10s} mean {d.mean():.2f}  p99 {np.percentile(d, 99):.1f}  max {d.max():.0f}')
