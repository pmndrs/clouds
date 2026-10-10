"""End-to-end test under hython: build a small fog VDB, convert it in all relevant ways, check invariants.

  hython scripts/vdb/test_hython.py
"""
import os, sys, tempfile, json, subprocess
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hou
import nvdf_math as nm
import make_test_cloud
import vdb_to_nvdf


def run(argv):
    args = vdb_to_nvdf.parser().parse_args(argv)
    if args.mode == 'pack':
        args.detail_grid = args.detail_grid or 'detail_type'; args.scale_grid = args.scale_grid or 'density_scale'
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        vdb_to_nvdf.convert(args)
    d = args.out
    meta = json.load(open(os.path.join(d, 'cloud.json')))
    n = int(np.prod(meta['dims']))
    nvdf = np.fromfile(os.path.join(d, 'nvdf.bin'), np.uint8).reshape(-1, 4)
    sdf = nm.decode_sdf_r16(np.fromfile(os.path.join(d, 'sdf.bin'), '<u2'))
    assert nvdf.shape[0] == n and sdf.shape[0] == n, 'payload sizes'
    return meta, nvdf, sdf


def check_common(meta, nvdf, sdf, voxel):
    occ = nvdf[:, 0] > 0
    assert occ.any()
    assert np.all(sdf[occ] < 0) and np.all(sdf[~occ] >= 0), 'sdf sign must equal profile > 0'
    assert np.all(nvdf[:, 3] == 0)
    assert meta['voxelSizeMeters'] == voxel
    # margin: nothing occupied within the first/last `margin` planes (crop adds the margin around occupancy)
    d = meta['dims']; vol = occ.reshape(d[2], d[1], d[0])
    assert not vol[:, :, 0].any() and not vol[:, :, -1].any(), 'x faces must be empty'


def make_pack_vdb(path, n=24, voxel=8.0):
    """A tiny Nubis-pack-style VDB: dimensional_profile (a blob), detail_type and density_scale defined everywhere (the pack carries them past the profile edge)."""
    import __main__
    z, y, x = np.mgrid[0:n, 0:n, 0:n].astype(np.float32)       # hou flat order: z (row), y (up), x
    r = np.sqrt((x - n / 2) ** 2 + (y - n / 2) ** 2 + (z - n / 2) ** 2)
    prof = np.clip((7.0 - r) / 7.0, 0, 1)
    fields = {'dimensional_profile': prof, 'detail_type': 0.2 + 0.6 * (y / n), 'density_scale': 0.1 + 0.8 * (x / n) * (0.5 + 0.5 * z / n)}
    geo = hou.Geometry()
    geo.addAttrib(hou.attribType.Prim, 'name', '')
    bb = hou.BoundingBox(0, 0, 0, n * voxel, n * voxel, n * voxel)
    for name, arr in fields.items():
        v = geo.createVolume(n, n, n, bb)
        v.setAttribValue('name', name)
        v.setAllVoxels(arr.astype(np.float32).ravel().tolist())
    __main__._PACK_GEO = geo
    net = hou.node('/obj').createNode('geo')
    src = net.createNode('python')
    src.parm('python').set('import __main__\nhou.pwd().geometry().merge(__main__._PACK_GEO)')
    cv = net.createNode('convertvdb')
    cv.setInput(0, src)
    cv.parm('conversion').set('vdb'); cv.parm('vdbclass').set('fog'); cv.parm('vdbtype').set('float'); cv.parm('prune').set(0)
    cv.cook(force=True)
    cv.geometry().saveToFile(path)
    net.destroy()
    return fields


def main():
    tmp = tempfile.mkdtemp(prefix='nvdf-test-')
    fog, sdfv = os.path.join(tmp, 'fog.vdb'), os.path.join(tmp, 'sdf.vdb')
    make_test_cloud.build(fog, seed=3, voxel=8.0, width=500, count=6, amp=1.0, freq=1 / 120.0, sdf_out=sdfv)
    for vs in (8.0, 16.0):
        meta, nvdf, sdf = run(['--mode', 'fog', fog, '--out', os.path.join(tmp, f'fog{vs:g}'), '--voxel-size', str(vs)])
        check_common(meta, nvdf, sdf, vs)
        assert nvdf[nvdf[:, 0] > 0, 0].max() > 100, 'profile should reach the core'
    # --up z reads the same VDB with hou Z as up: dims (x, row, up) become (x, up, row) of the y-up run, and occupancy is the transpose
    mz, nz_, sz = run(['--mode', 'fog', fog, '--out', os.path.join(tmp, 'upz'), '--up', 'z'])
    my, ny_, _ = run(['--mode', 'fog', fog, '--out', os.path.join(tmp, 'upy')])
    dy, dz = my['dims'], mz['dims']
    assert dz[0] == dy[0] and abs(dz[1] - dy[2]) <= 1 and abs(dz[2] - dy[1]) <= 1, ('--up z dims', dy, dz)
    check_common(mz, nz_, sz, 8.0)
    meta, nvdf, sdf = run(['--mode', 'sdf', sdfv, '--out', os.path.join(tmp, 'sdf'), '--sdf-grid', 'surface'])
    check_common(meta, nvdf, sdf, 8.0)
    # depth parameter moves the gradient: a shorter depth saturates more of the interior
    _, a, _ = run(['--mode', 'sdf', sdfv, '--out', os.path.join(tmp, 'd1'), '--depth', '24', '--mapping', 'legacy'])
    _, b, _ = run(['--mode', 'sdf', sdfv, '--out', os.path.join(tmp, 'd2'), '--depth', '200', '--mapping', 'legacy'])
    assert (a[:, 0] == 255).sum() > (b[:, 0] == 255).sum()
    # hero: 4 m fine lattice (coarse 8 m by reduction); fine.nvdb parity is asserted inside the converter, then re-checked from the files
    for shell in (None, 24.0):
        d = os.path.join(tmp, 'fine' if shell is None else 'fine-shell')
        meta, nvdf, sdf = run(['--mode', 'fog', fog, '--out', d, '--voxel-size', '8', '--fine-voxel-size', '4'] + ([] if shell is None else ['--fine-shell', str(shell)]))
        check_common(meta, nvdf, sdf, 8.0)
        f = meta['fine']
        assert f['ratio'] == 2 and f['dims'] == [2 * n for n in meta['dims']] and f['leaves'] > 0 and f['bytes'] > 0
        assert os.path.exists(os.path.join(d, 'fine.vdb')) and os.path.exists(os.path.join(d, 'fine.nvdb'))
        r = subprocess.run([sys.executable, os.path.join(HERE, 'check_parity.py'), '--fine', d], capture_output=True, text=True)
        assert r.returncode == 0, r.stdout + r.stderr
    # --- C2: shape closing + fields outside the profile
    old = ['--no-sim-defaults', '--fields-outside', '0']
    mo, no_, so = run(['--mode', 'fog', fog, '--out', os.path.join(tmp, 'old')] + old)
    mc, nc, sc = run(['--mode', 'fog', fog, '--out', os.path.join(tmp, 'new')])
    assert mc['converter']['shaping'] == {'closeMeters': 32.0, 'scaleTop': 1.0, 'depthShift': 0.0, 'fieldsOutsideVoxels': 2}, mc['converter']['shaping']
    check_common(mc, nc, sc, 8.0)
    assert mo['dims'] == mc['dims'], 'closing must not change the crop'
    occ_o, occ_c = no_[:, 0] > 0, nc[:, 0] > 0
    assert occ_c[occ_o].all() and occ_c.sum() >= occ_o.sum(), 'closing only adds voxels'
    assert (no_[~occ_o][:, 1:3] == 0).all(), 'old behaviour: zeros outside the profile'
    # new: detail type / density scale are nonzero just outside the profile and zero further than 2 voxels away; profile stays 0 outside
    d = mc['dims']; vol = occ_c.reshape(d[2], d[1], d[0])
    shifted = lambda a, ax, k: np.roll(a, k, axis=ax)
    cur = vol.copy()
    for _ in range(2):
        grow = cur.copy()
        for ax in range(3):
            grow |= shifted(cur, ax, 1) | shifted(cur, ax, -1)
        cur = grow
    ring, far = (cur & ~vol).ravel(), (~cur).ravel()
    # (detail type is legitimately 0 on the wispy base slices, so it gets a looser bound)
    assert (nc[ring][:, 2] > 0).mean() > 0.95 and (nc[ring][:, 1] > 0).mean() > 0.5, 'fields extended into the 2-voxel shell'
    assert (nc[far][:, 1:3] == 0).all(), 'nothing beyond the shell'
    assert (nc[~occ_c][:, 0] == 0).all()
    assert nc[occ_c, 2].max() == 255, 'sim density scale reaches 1 at the top'
    # disabling pieces individually
    _, n_nc, _ = run(['--mode', 'fog', fog, '--out', os.path.join(tmp, 'noclose'), '--close', '0'])
    assert (n_nc[:, 0] > 0).sum() == occ_o.sum()
    # pack mode round trip: detail type / density scale come out exactly as the pack carries them, also outside the profile
    pk = os.path.join(tmp, 'pack.vdb')
    fields = make_pack_vdb(pk)
    mp, npk, _ = run(['--mode', 'pack', pk, '--out', os.path.join(tmp, 'pack')])
    off, dd = mp['cropOffset'], mp['dims']                     # (x, map row, up) of the crop min in lattice voxels
    q = lambda a: nm.quantize_unorm8(a)
    tex = {k: v.reshape(24, 24, 24).transpose(1, 0, 2) for k, v in fields.items()}   # hou (row, up, x) -> texture (up, row, x)
    checked = outside = 0
    vol_p = npk.reshape(dd[2], dd[1], dd[0], 4)
    for zz in range(dd[2]):
        for yy in range(dd[1]):
            for xx in range(dd[0]):
                gx, gr, gu = xx + off[0], yy + off[1], zz + off[2]
                if not (0 <= gx < 24 and 0 <= gr < 24 and 0 <= gu < 24):
                    continue
                px = vol_p[zz, yy, xx]
                assert px[1] == q(tex['detail_type'][gu, gr, gx]) and px[2] == q(tex['density_scale'][gu, gr, gx]), ('pack channels must pass through', xx, yy, zz)
                checked += 1
                outside += int(px[0] == 0)
    assert checked > 5000 and outside > 1000, (checked, outside)
    print('test_hython: OK')


if __name__ == '__main__':
    main()
