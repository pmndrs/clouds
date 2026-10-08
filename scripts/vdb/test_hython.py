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


def main():
    tmp = tempfile.mkdtemp(prefix='nvdf-test-')
    fog, sdfv = os.path.join(tmp, 'fog.vdb'), os.path.join(tmp, 'sdf.vdb')
    make_test_cloud.build(fog, seed=3, voxel=8.0, width=500, count=6, amp=1.0, freq=1 / 120.0, sdf_out=sdfv)
    for vs in (8.0, 16.0):
        meta, nvdf, sdf = run(['--mode', 'fog', fog, '--out', os.path.join(tmp, f'fog{vs:g}'), '--voxel-size', str(vs)])
        check_common(meta, nvdf, sdf, vs)
        assert nvdf[nvdf[:, 0] > 0, 0].max() > 100, 'profile should reach the core'
    meta, nvdf, sdf = run(['--mode', 'sdf', sdfv, '--out', os.path.join(tmp, 'sdf'), '--sdf-grid', 'surface'])
    check_common(meta, nvdf, sdf, 8.0)
    # depth parameter moves the gradient: a shorter depth saturates more of the interior
    _, a, _ = run(['--mode', 'sdf', sdfv, '--out', os.path.join(tmp, 'd1'), '--depth', '24', '--mapping', 'legacy'])
    _, b, _ = run(['--mode', 'sdf', sdfv, '--out', os.path.join(tmp, 'd2'), '--depth', '200', '--mapping', 'legacy'])
    assert (a[:, 0] == 255).sum() > (b[:, 0] == 255).sum()
    print('test_hython: OK')


if __name__ == '__main__':
    main()
