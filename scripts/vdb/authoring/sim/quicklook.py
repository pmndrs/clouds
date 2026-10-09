"""L2: a fast lit preview of converted clouds (system python3 + numpy + Pillow; no GPU, no Houdini), for iterating on recipes.

  python3 scripts/vdb/authoring/sim/quicklook.py OUT.jpg assets/clouds/library/congestus-a assets/clouds/local/l2/congestus-a ...
  python3 scripts/vdb/authoring/sim/quicklook.py OUT.jpg --lib assets/clouds/library          # every cloud of a library dir

Each cloud gets two panels (looking along the map rows and along x) at one shared metre scale, so sizes compare across the sheet.
Shading: Beer-Lambert view transmittance over the NVDF profile channel, lit by a sun from the upper left (optical depth marched
along the diagonal) plus a flat ambient term.  It shows shape, base flatness, connection and how towers rise; it is not our runtime.
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw

SKY = np.array([118, 158, 205], np.float32)


def load(d):
    cj = json.load(open(os.path.join(d, 'cloud.json')))
    w, h, z = cj['dims']
    r = np.fromfile(os.path.join(d, 'nvdf.bin'), np.uint8).reshape(z, h, w, 4)[..., 0].astype(np.float32) / 255.0
    return r, cj['voxelSizeMeters'], cj.get('name', os.path.basename(d.rstrip('/')))


def lit(vol, vs, sigma=0.012):
    """vol[up, depth, across] -> RGB image [up (top first), across], looking along `depth`."""
    k = sigma * vs * vol                                   # extinction per voxel
    nz, nd, nx = vol.shape
    od = np.zeros_like(k)                                  # optical depth toward the sun (upper left: -x, +up)
    for y in range(nz - 2, -1, -1):
        prev = od[y + 1] + k[y + 1]
        od[y, :, 1:] = prev[:, :-1]
    sun = np.exp(-od)
    amb = 0.35 + 0.25 * (np.arange(nz, dtype=np.float32) / max(nz - 1, 1))[:, None, None]   # brighter crowns, darker bases
    a = 1 - np.exp(-k)
    T = np.cumprod(np.exp(-k), axis=1)
    T = np.concatenate([np.ones_like(T[:, :1]), T[:, :-1]], axis=1)
    L = (T * a * (0.85 * sun + amb)).sum(axis=1)           # [up, across]
    Tt = np.exp(-k.sum(axis=1))
    rgb = L[..., None] * np.array([255, 252, 245], np.float32) + Tt[..., None] * SKY
    return np.clip(rgb, 0, 255)[::-1].astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('dirs', nargs='*')
    ap.add_argument('--lib', help='a library dir: every cloud in its index.json')
    ap.add_argument('--mpp', type=float, default=4.0, help='metres per pixel (shared)')
    ap.add_argument('--cols', type=int, default=4)
    a = ap.parse_args()
    dirs = list(a.dirs)
    if a.lib:
        dirs += [os.path.join(a.lib, c['name']) for c in json.load(open(os.path.join(a.lib, 'index.json')))['clouds']]
    tiles = []
    for d in dirs:
        vol, vs, name = load(d)
        views = [lit(vol, vs), lit(vol.transpose(0, 2, 1), vs)]
        ims = []
        for v in views:
            im = Image.fromarray(v)
            ims.append(im.resize((max(1, int(im.width * vs / a.mpp)), max(1, int(im.height * vs / a.mpp))), Image.BILINEAR))
        sz = [round(s * vs) for s in (vol.shape[2], vol.shape[1], vol.shape[0])]
        tiles.append((os.path.relpath(d), f'{sz[0]}x{sz[1]}x{sz[2]} m', ims))
    cw = max(sum(i.width for i in t[2]) + 30 for t in tiles)
    ch = max(max(i.height for i in t[2]) for t in tiles) + 40
    cols = min(a.cols, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cw, rows * ch), tuple(int(c) for c in SKY))
    dr = ImageDraw.Draw(sheet)
    for i, (label, size, ims) in enumerate(tiles):
        x, y = (i % cols) * cw, (i // cols) * ch
        dr.rectangle([x, y, x + cw - 1, y + ch - 1], outline=(60, 70, 90))
        dr.text((x + 6, y + 4), label, fill=(20, 20, 30))
        dr.text((x + 6, y + 16), size, fill=(40, 40, 60))
        xx = x + 10
        for im in ims:
            sheet.paste(im, (xx, y + ch - im.height - 4))
            xx += im.width + 10
    sheet.save(a.out, quality=88)
    print(a.out, sheet.size)


if __name__ == '__main__':
    main()
