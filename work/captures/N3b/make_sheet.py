# N3b sheet: the Disney cloud, two suns, three renderers (path trace | neural | our raymarch), one tone map for all.
# python3 -I work/captures/N3b/make_sheet.py <capture dir> <out.jpg>
# <capture dir> holds pt-<sun>/pt-<sun>.pfm, rm-<sun>/nubis-<sun>.pfm (reference-pt/ --linear) and nn-<sun>/chunk0..3.json
# (neural/ __neuralRadianceChunk) plus each run's capture.json / timing.json.
import sys, json, base64, math
import numpy as np
from PIL import Image, ImageDraw

D, OUT = sys.argv[1], sys.argv[2]
EXPOSURE = 0.35   # reference-pt's default display exposure (physical sky units)
SUN_RGB = [0.4418720602989197, 0.42135560512542725, 0.3813745379447937]
lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def pfm(path):
    with open(path, 'rb') as f:
        kind = f.readline().strip(); w, h = map(int, f.readline().split()); scale = float(f.readline())
        a = np.frombuffer(f.read(), dtype='<f4' if scale < 0 else '>f4')
    a = a.reshape(h, w, 3 if kind == b'PF' else 1)[::-1]   # PFM rows run bottom to top
    return np.ascontiguousarray(a)

def neural(d):
    b = ''.join(json.load(open(f'{d}/chunk{k}.json')) for k in range(4))
    a = np.frombuffer(base64.b64decode(b), dtype=np.float32).reshape(3, 512, 512)
    return np.transpose(a[:, ::-1, ::-1], (1, 2, 0))   # rdv order -> image order (180 degrees), as the page's display

def aces(rgb):
    # three.js ACESFilmicToneMapping (exposure / 0.6, input matrix, RRT+ODT fit, output matrix), then sRGB.
    c = np.maximum(rgb, 0) * (EXPOSURE / 0.6)
    M = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
    O = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
    v = c @ M.T
    v = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081)
    v = np.clip(v @ O.T, 0, 1)
    s = np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    return Image.fromarray((s * 255 + 0.5).astype(np.uint8))

rows, notes = [], {}
for sun in ['noon', 'low']:
    pt_rep = json.load(open(f'{D}/pt-{sun}/capture.json'))['shots'][0]['report']
    rm_rep = json.load(open(f'{D}/rm-{sun}/capture.json'))['shots'][0]['report']
    nn_rep = json.load(open(f'{D}/nn-{sun}/capture.json'))['shots'][0]['report']
    rm_t = json.load(open(f'{D}/rm-{sun}/timing.json'))
    nn_t = json.load(open(f'{D}/nn-{sun}/timing.json'))
    E = pt_rep['sky']['sunIrradiance']
    nsun = [x * 2 ** nn_rep['settings']['sun'] for x in SUN_RGB]
    k = lum(E) / lum(nsun)   # neural radiance x k: the same sun luminance as the reference pages
    pt = pfm(f'{D}/pt-{sun}/pt-{sun}.pfm'); rm = pfm(f'{D}/rm-{sun}/nubis-{sun}.pfm'); nn = neural(f'{D}/nn-{sun}') * k
    p = pt_rep['pt']; s = pt_rep['sun']
    rows.append((f"{sun} sun: elevation {s['elevationDeg']:.1f}, azimuth {s['azimuthDeg']:.1f} (pmndrs sky); camera ring 70 deg from the sun", [
        (f"PATH TRACE  {p['samples']} spp, depth {p['maxDepth']}: {p['wallMs'] / 1000:.0f} s total ({p['wallMs'] / p['samples']:.0f} ms/spp)", aces(pt)),
        (f"NEURAL  HaloRT, our engine fp16, 16 frames avg: {nn_t['medianMs']:.1f} ms/frame", aces(nn)),
        (f"OUR RAYMARCH  runtime '{rm_t['quality']}', nubis: {rm_t['medianMs']:.1f} ms/frame", aces(rm)),
    ]))
    notes[sun] = {'k': k, 'ptWallS': p['wallMs'] / 1000, 'ptMsPerPass': p['msPerPass'], 'nnMs': nn_t['medianMs'], 'rmMs': rm_t['medianMs'],
                  'meanLum': {n: float(np.mean(lum(np.transpose(a.reshape(-1, 3))))) for n, a in [('pt', pt), ('nn', nn), ('rm', rm)]}}

W, LH, RH = 512, 20, 22
foot = [
    'Disney cloud wdas_cloud_eighth.vdb, 512x512 each, M5 Pro, headless Chrome. All three linear radiance, one tone map (three.js ACES, exposure 0.35, sRGB).',
    'Medium: albedo 0.99, HG g 0.8 (PT and neural; the raymarch keeps its own shipped phase model). Extinction = the neural page\'s 179 over [-1,1]: 0.219 x raw density per m',
    '(1 unit = 912 m; reference-pt extScale 0.3654, runtime directDensity 0.21925). Same camera (fov 30) and sun direction on all three.',
    'NOT matched: the neural sky is its own gradient sky (its EV set so sky/sun luminance matches the reference sky); its sun is fixed warm-white, the reference sun is',
    'physically coloured; neural radiance scaled by sun luminance (x{:.1f} noon, x{:.1f} low). Neural has no pixel jitter (aliased edges). Raymarch ms = runtime encode only.'.format(notes['noon']['k'], notes['low']['k']),
]
FH = 14 * len(foot) + 8
sheet = Image.new('RGB', (3 * W, len(rows) * (RH + LH + W) + FH), (24, 24, 24))
dr = ImageDraw.Draw(sheet)
y = 0
for title, panels in rows:
    dr.text((6, y + 5), title, fill=(255, 220, 140)); y += RH
    for i, (t, im) in enumerate(panels):
        dr.text((i * W + 6, y + 4), t, fill=(230, 230, 230))
        sheet.paste(im, (i * W, y + LH))
    y += LH + W
for j, line in enumerate(foot):
    dr.text((6, y + 4 + 14 * j), line, fill=(200, 200, 200))
sheet.save(OUT, quality=92)
print(json.dumps(notes, indent=1))
