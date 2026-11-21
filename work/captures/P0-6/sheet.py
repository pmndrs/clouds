"""P0.6 sheets: furnace deviation maps (L - 1, blue below, red above, full scale +-10 %), absorber (L - T, +-5 % of sky) and Cycles vs PT."""
import sys, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-acfd6dc3f04e0532b/scripts/reference')
from refio import read_pfm
SP = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds/0f696b9e-edf1-4b64-a8af-1a5e5f64c4b2/scratchpad'
OUT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-acfd6dc3f04e0532b/work/captures/P0-6'
def lum(p):
    x = read_pfm(p); return x.mean(axis=2) if x.ndim == 3 else x
def box(x, r):
    k = np.ones(2 * r + 1)
    x = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 0, x)
    return np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 1, x)
def blur(x, r=2):
    return box(x, r) / box(np.ones_like(x), r)   # normalised at the frame edge
def div(d, scale):
    t = np.clip(d / scale, -1, 1)
    rgb = np.ones(d.shape + (3,))
    rgb[..., 0] = np.where(t < 0, 1 + t, 1); rgb[..., 1] = 1 - np.abs(t); rgb[..., 2] = np.where(t > 0, 1 - t, 1)
    return (rgb * 255).astype(np.uint8)
def tile(img, label, w=420):
    im = Image.fromarray(img).resize((w, int(w * img.shape[0] / img.shape[1])), Image.BILINEAR)
    ImageDraw.Draw(im).text((6, 4), label, fill=(0, 0, 0))
    return im
def grid(tiles, cols, path):
    w, h = tiles[0].size; rows = (len(tiles) + cols - 1) // cols
    s = Image.new('RGB', (w * cols, h * rows), 'white')
    for i, t in enumerate(tiles): s.paste(t, ((i % cols) * w, (i // cols) * h))
    s.save(path, quality=85)
which = sys.argv[1]
if which == 'furnace':
    tiles = []
    for name in ['embergen02-brick-1-s1', 'embergen02-global-1-s1', 'parkouring-brick-1-s1', 'sky-brick-1-s1', 'sky-brick-1-d4096', 'sky-brick-0.3333333-s1']:
        L = blur(lum(f'{SP}/f/{name}/pt-noon.pfm'))
        tiles.append(tile(div(L - 1, 0.1), f'furnace {name}: L-1 (5x5 mean), +-10 %'))
    for name in ['embergen02-absorb-brick', 'sky-absorb-brick', 'parkouring-absorb-brick']:
        L = blur(lum(f'{SP}/f/{name}/pt-noon.pfm')); T = blur(1 - lum(f'{SP}/f/{name}/alpha-noon.pfm'))
        tiles.append(tile(div(L - T, 0.05), f'absorber {name}: L-T, +-5 %'))
    grid(tiles, 3, f'{OUT}/furnace-absorber.jpg')
else:
    def tm(x, e=0.35):
        x = x * e / 0.6; x = x * (x + 0.0245786) / (x * (0.983729 * x + 0.4329510) + 0.238081)
        x = np.clip(x, 0, 1); return (np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055) * 255).astype(np.uint8)
    pt = (read_pfm(f'{SP}/x/pt-s1/pt-noon.pfm') + read_pfm(f'{SP}/x/pt-s2/pt-noon.pfm')) / 2
    cy = read_pfm(f'{SP}/x/cycles/cycles.pfm')
    a = lum(f'{SP}/x/pt-s1/alpha-noon.pfm')
    r = blur(cy.mean(axis=2)) / np.maximum(blur(pt.mean(axis=2)), 1e-6)
    tiles = [tile(tm(pt), 'our PT, 2x1024 spp'), tile(tm(cy), 'Cycles ray march, 128 spp'), tile(div(np.where(a > 0.05, np.log2(r), 0), 0.25), 'log2 Cycles/PT (5x5 mean), +-0.25 stop')]
    grid(tiles, 3, f'{OUT}/cycles-vs-pt.jpg')
