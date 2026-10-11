"""W1: draw the example authored weather maps (assets/clouds/ndf/). Our own drawings: periodic spectral noise and soft shapes placed by eye
to recreate the *arrangement* the papers' authored maps describe (n17 p.64-68, nut s17-19, hzd15 s47). No paper pixels are used.

  python3 -I work/captures/W1/tools/draw_maps.py assets/clouds/ndf

Layout (procedural/settings.ts HzdNdfSettings.image): <name>.png = R coverage, G top type, B bottom type, A 255 (8-bit linear);
<name>-height.png = R min height, G max height (fractions of the layer). The image centre is the world origin; up = north (the compare page's
default view direction, lookAz 0), right = east. Coverage is on our shaper's scale: the generated n17 map has p50 0.30, p90 0.52, p99 0.67, and a
mean base shape survives where coverage > ~0.38. Keep painted maps soft (gradients): flat plateaus of coverage become flat slabs.
"""
import sys, os
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(7)
y, x = (np.mgrid[0:N, 0:N] + 0.5) / N - 0.5       # -0.5..0.5, centre = world origin; y < 0 = north (image up)


def fbm(lo, hi, beta=1.0, seed=0):
    """Periodic band-limited noise: random spectrum between `lo` and `hi` cycles per tile, amplitude f^-beta, normalised to std 1."""
    r = np.random.default_rng(seed)
    fx = np.fft.fftfreq(N) * N
    f = np.hypot(*np.meshgrid(fx, fx))
    amp = np.where((f >= lo) & (f <= hi), np.maximum(f, 1) ** -beta, 0.0)
    spec = amp * np.exp(2j * np.pi * r.random((N, N)))
    v = np.real(np.fft.ifft2(spec))
    return (v - v.mean()) / (v.std() + 1e-9)


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def wrapd(px, py):
    """Periodic distance (tile units) from (px, py)."""
    dx = (x - px + 0.5) % 1 - 0.5
    dy = (y - py + 0.5) % 1 - 0.5
    return np.hypot(dx, dy)


def blob(px, py, r, edge=0.6):
    return 1 - smooth(r * edge, r, wrapd(px, py))


def save(out, name, cov, top, bottom, heights=None):
    a = np.stack([cov, top, bottom, np.ones_like(cov)], -1)
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(out, name + '.png'), optimize=True)
    if heights is not None:
        lo, hi = heights
        b = np.stack([lo, hi, np.zeros_like(lo), np.ones_like(lo)], -1)
        Image.fromarray((np.clip(b, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(out, name + '-height.png'), optimize=True)
    print(name, 'coverage p50/p90/p99', *np.round(np.percentile(cov, [50, 90, 99]), 2), 'covered', round(float((cov > 0.38).mean()), 3))


def desert_morning(out):
    # n17 p.64 / nut s17: a calm desert morning, stratus only ("type set to zero ... the lack of blue"); the map is a broken mottle
    # (yellow-green with black holes). Thin, felt more than seen: modest coverage, stratus type, a soft ragged base.
    m = 0.62 * fbm(3, 10, 1.2, 1) + 0.38 * fbm(10, 40, 0.8, 2)
    holes = smooth(-0.9, -0.3, fbm(2, 5, 1.0, 3))
    cov = (0.36 + 0.13 * m) * (0.35 + 0.65 * holes)
    save(out, 'desert-morning', cov, np.zeros_like(cov), np.full_like(cov, 0.6))


def desert_afternoon(out):
    # n17 p.65 / nut s18: afternoon desert cumulus (Ansel Adams): "a higher cloud type value"; the map reads as a fine blue-purple speckle,
    # i.e. many separate small-to-mid cumulus over the whole map. Worley-like dots of mixed size on a low base.
    cov = 0.12 + 0.05 * fbm(4, 16, 1.0, 11)
    # The height map keeps them fair-weather (wider than tall): tops at 35-60 % of the layer, the bigger dots taller.
    cells = rng.random((150, 3))
    size = np.zeros_like(cov)
    for cx, cy, s in cells:
        r = 0.03 + 0.06 * s ** 2   # cone profiles: a plateau of coverage would extrude the dot into a column
        b = blob(cx - 0.5, cy - 0.5, r, 0.0)
        cov = np.maximum(cov, (0.50 + 0.15 * s) * b * (0.85 + 0.15 * fbm(20, 60, 0.5, 12)))
        size = np.maximum(size, b * s)
    top = np.clip(0.75 + 0.12 * fbm(2, 5, 1.0, 13), 0, 1)
    save(out, 'desert-afternoon', cov, top, np.full_like(cov, 0.15), (np.zeros_like(cov), 0.35 + 0.25 * size))


def alpine_congestus(out):
    # n17 p.66: isolated cumulus congestus columns over the mountains (Bierstadt), and a stratus band where "the reduction in the blue
    # channel" sits. Few large round columns, tall (height map: tops at the layer top), on clear sky; a low stratus band ahead-right.
    cov = 0.10 + 0.04 * fbm(4, 12, 1.0, 21)
    cols = [(-0.05, -0.18, 0.06), (0.17, -0.30, 0.05), (-0.27, -0.33, 0.045), (0.32, 0.05, 0.05), (-0.36, 0.12, 0.05), (0.05, 0.28, 0.055),
            (-0.15, -0.02, 0.035), (0.40, -0.40, 0.04), (0.22, 0.35, 0.04), (-0.42, -0.08, 0.035)]
    tall = np.zeros_like(cov)
    for cx, cy, r in cols:
        b = blob(cx, cy, 1.7 * r * (1 + 0.2 * fbm(6, 24, 0.7, 22)), 0.0)
        cov = np.maximum(cov, 0.75 * b)
        tall = np.maximum(tall, b)
    top = np.full_like(cov, 1.0)
    # the stratus band: a long soft strip ahead-right of the camera, NW-SE, type 0.15, moderate coverage
    d = np.abs((x - 0.18) * 0.6 + (y + 0.12) * 0.8)
    band = (1 - smooth(0.02, 0.07, d)) * (1 - smooth(0.15, 0.32, wrapd(0.18, -0.12)))
    cov = np.maximum(cov, band * (0.44 + 0.08 * fbm(12, 50, 0.7, 23)))
    top = top * (1 - band) + 0.15 * band
    lo = np.zeros_like(cov)
    hi = 0.6 + 0.4 * np.sqrt(tall)
    save(out, 'alpine-congestus', cov, top, np.full_like(cov, 0.2), (lo, hi))


def boss_fight(out):
    # n17 p.68 / nut s19: a custom "Frankencloudscape" for a boss fight: several maps combined, a big low-coverage area around the sun
    # (ahead of the camera, which faces the sun), and holes painted black where the art director wanted them. Base: dense, mottled,
    # stratocumulus-to-cumulus; a wedge ahead of the camera holds a different system (stratocumulus streets on the left of the wedge).
    base = 0.47 + 0.12 * fbm(4, 14, 1.1, 31) + 0.06 * fbm(14, 48, 0.8, 32)
    top = np.clip(0.75 + 0.2 * fbm(2, 6, 1.0, 33), 0, 1)
    ang = np.degrees(np.arctan2(x, -y))               # 0 = north (ahead), +90 = east
    r = np.hypot(x, y)
    wedge = (1 - smooth(25, 40, np.abs(ang))) * smooth(0.03, 0.08, r) * (1 - smooth(0.42, 0.48, r))
    left = wedge * (1 - smooth(-8, 4, ang))
    streets = 0.42 + 0.14 * np.sin((x * 0.9 + y * 0.45) * 2 * np.pi * 14 + 1.5 * fbm(3, 9, 1, 34))
    cov = base * (1 - left) + streets * left
    top = top * (1 - left) + 0.5 * left
    # the opening around the sun: ahead, 6-12 km at a 24 km tile
    opening = blob(0.0, -0.32, 0.13, 0.35)
    cov = cov * (1 - 0.8 * opening)
    # painted holes
    for hx, hy, hr in [(-0.12, -0.12, 0.03), (0.14, -0.2, 0.025), (0.3, 0.25, 0.04), (-0.3, 0.3, 0.035)]:
        cov = cov * (1 - blob(hx, hy, hr, 0.5))
    save(out, 'boss-fight', cov, top, np.full_like(cov, 0.1))


def cutscene_gradient(out):
    # hzd15 s47 (p049): a cutscene sky is a smooth hand-painted two-colour gradient of coverage against type, not a noisy map.
    # Coverage rises from the south (behind) to the north (ahead); type runs from stratus in the west to cumulus in the east.
    cov = 0.18 + 0.42 * smooth(0.35, -0.45, y)
    top = smooth(-0.4, 0.4, x)
    save(out, 'cutscene-gradient', cov, top, np.full_like(cov, 0.3))


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for f in (desert_morning, desert_afternoon, alpine_congestus, boss_fight, cutscene_gradient):
        f(out)
