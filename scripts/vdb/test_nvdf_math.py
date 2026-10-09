"""Plain-python tests for nvdf_math (run: python3 scripts/vdb/test_nvdf_math.py, needs numpy)."""
import os, sys, unittest
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import nvdf_math as m


def brute_signed(mask, h):
    pts_in = np.argwhere(mask); pts_out = np.argwhere(~mask)
    out = np.zeros(mask.shape, np.float32)
    for idx in np.ndindex(mask.shape):
        tgt = pts_out if mask[idx] else pts_in
        d = np.sqrt(((tgt - np.array(idx)) ** 2).sum(axis=1).min()) * h
        out[idx] = -(d - h / 2) if mask[idx] else d - h / 2
    return out


class T(unittest.TestCase):
    def test_edt_matches_brute_force(self):
        rng = np.random.default_rng(1)
        mask = rng.random((7, 9, 11)) > 0.8
        mask[3, 4, 5] = True
        self.assertTrue(np.allclose(m.signed_distance(mask, 8.0), brute_signed(mask, 8.0), atol=1e-3))

    def test_edt_anisotropic_free_single_voxel(self):
        mask = np.zeros((5, 5, 5), bool); mask[2, 2, 2] = True
        sd = m.signed_distance(mask, 10.0)
        self.assertAlmostEqual(float(sd[2, 2, 2]), -5.0, places=3)
        self.assertAlmostEqual(float(sd[2, 2, 4]), 15.0, places=3)

    def test_sdf_roundtrip_rounds_down(self):
        x = np.array([-256, -3.3, 0, 17.7, 4096], np.float32)
        d = m.decode_sdf_r16(m.encode_sdf_r16(x))
        self.assertTrue(np.all(d <= x + 1e-3)); self.assertTrue(np.all(x - d < 0.07))

    def test_profile_keeps_occupancy(self):
        sdf = np.array([-4, -40, -400, 4, 0], np.float32); mask = sdf < 0
        p = m.quantize_unorm8(m.profile_from_sdf(sdf, mask, 96.0, 3.0))
        self.assertTrue(np.array_equal(p > 0, mask)); self.assertEqual(int(p[2]), 255)

    def test_resample_identity_and_mean(self):
        w = m.resample_matrix(8, 0, 8.0, (0, 8), 8.0)
        self.assertTrue(np.allclose(w, np.eye(8)))
        w2 = m.resample_matrix(8, 0, 8.0, (0, 4), 16.0)
        a = np.arange(8, dtype=np.float32)
        self.assertEqual(w2.shape, (4, 8)); self.assertTrue(np.allclose(w2.sum(1), 1)); self.assertTrue(np.all(np.diff(w2 @ a) > 0))

    def test_reduce_profile_occupancy_superset(self):
        rng = np.random.default_rng(3)
        fine = (rng.random((8, 12, 16)) > 0.93).astype(np.uint8) * rng.integers(1, 256, (8, 12, 16)).astype(np.uint8)
        for r in (2, 4):
            if any(n % r for n in fine.shape):
                continue
            c = m.reduce_profile_u8(fine, r)
            self.assertEqual(c.shape, tuple(n // r for n in fine.shape))
            # coarse > 0 exactly where any fine voxel of the block is > 0, and never below 1 there
            self.assertTrue(np.array_equal(c > 0, m.block_any(fine > 0, r)))
            # every occupied fine voxel lies in an occupied coarse voxel (dilation superset)
            up = np.repeat(np.repeat(np.repeat(c > 0, r, 0), r, 1), r, 2)
            self.assertTrue(up[fine > 0].all())
            # mean rule (within rounding) where the block is full
            full = np.full((r, r, r), 200, np.uint8)
            self.assertEqual(int(m.reduce_profile_u8(full, r)[0, 0, 0]), 200)

    def test_reduce_profile_floor_and_sdf_lower_bound(self):
        fine = np.zeros((8, 8, 8), np.uint8); fine[3, 3, 3] = 1       # one faint fine voxel
        c = m.reduce_profile_u8(fine, 2)
        self.assertEqual(int(c[1, 1, 1]), 1)                           # mean would round to 0; the floor keeps it occupied
        sd_fine = m.signed_distance(fine > 0, 4.0)
        sd_coarse = m.signed_distance(c > 0, 8.0)
        up = np.repeat(np.repeat(np.repeat(sd_coarse, 2, 0), 2, 1), 2, 2)
        # outside the cloud the coarse SDF (from a superset mask) never exceeds the fine SDF, by more than one coarse voxel of centre offset
        outside = sd_fine > 0
        self.assertTrue((up[outside] <= sd_fine[outside] + 8.0 + 1e-3).all())

    def test_corr_meters_is_eight_metre_equivalent(self):
        self.assertEqual(m.PACK_FIT['profile']['corrMeters'], m.PACK_FIT['profile']['corrVox'] * 8.0)
        self.assertEqual(m.PACK_FIT['profile']['corrMeters'] / 8.0, 3.0)   # unchanged 8 m output

    def test_bounds_crop(self):
        p = np.zeros((6, 8, 10), np.uint8); p[2, 3, 4] = 9
        b = m.occupied_bounds(p, 2)
        self.assertEqual(b['cropMin'], [2, 1, 0]); self.assertEqual(b['cropDims'], [5, 5, 5])
        self.assertEqual(m.crop(p, b['cropMin'], b['cropDims']).shape, (5, 5, 5))


if __name__ == '__main__':
    unittest.main()
