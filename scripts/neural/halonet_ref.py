#!/usr/bin/env python3 -I
"""Plain NumPy forward pass of the HaloRT network (the reference for the WGSL kernels).

Reproduces the authors' ONNX output (`HaloRTCompose`: six UNet passes, then the blend) from the
`.tza` weight files made by `pt_to_tza.py`. Clarity over speed: every op is a small function with the
PyTorch semantics noted beside it, and any intermediate tensor can be dumped.

    python3 -I scripts/neural/halonet_ref.py --size 256 --check
    python3 -I scripts/neural/halonet_ref.py --size 256 --dump DIR [--dump-all]

Network (HaloNetFast, `_modeling.py`): channels=8, dim=16, out_dim=1, dim_mults=(1,1,1,2,2,4,4),
attn_modes=(0,0,0,2,0,2,0), heads=4, dim_head=4. Data are float32, NCHW without the batch dimension
(arrays are [C, H, W]). Weights are logical OIHW. Loaded data files are read with struct/numpy.fromfile
only (no pickle).

Things that are easy to get wrong (all reproduced here):
  * stages without attention are `x = nn.Identity()(x) + x`, i.e. x is DOUBLED;
  * the attention module has no residual of its own; the stage adds it (`attn(x) + x`);
  * RMSNorm = x / ||x||_2 over channels (eps 1e-12) * g * sqrt(C);
  * Downsample = pixel-unshuffle `b c (h p1) (w p2) -> b (c p1 p2) h w` then 1x1 conv;
  * the last down stage and the last up stage use a plain 3x3 conv, not Down/Up;
  * skips are pushed after block1 and after (block2 + attention-add); the up path pops them in
    reverse and concatenates (x, skip), x FIRST.
"""
import argparse
import json
import os
import struct
import sys
import time

import numpy as np

ROOT = "/Users/dex/Developer/WebGPUClouds/artifacts/research/neural"
WEIGHTS = ROOT + "/weights/halo_%s.tza"
FIXTURE = ROOT + "/fixture"

# ---------------------------------------------------------------------------------------------
# network description
# ---------------------------------------------------------------------------------------------
DIM = 16
DIM_MULTS = (1, 1, 1, 2, 2, 4, 4)
ATTN_MODES = (0, 0, 0, 2, 0, 2, 0)
HEADS = 4
DIM_HEAD = 4
NUM_MEM = 8
HALO = 2
DIMS = [DIM] + [DIM * m for m in DIM_MULTS]            # init_dim, then per stage
IN_OUT = list(zip(DIMS[:-1], DIMS[1:]))

# VolumeDeepProfile layout: 0..3 depth samples | 4 tr | 5 g | 6 nee | 7..9 env rgb | 10..12 albedo rgb | 13 S;
# the ONNX condition has the background rgb appended as channels 14..16.
INDICES = {
    "dir": [[0, 1, 2, 3, 4, 5, 6, 10], [0, 1, 2, 3, 4, 5, 6, 11], [0, 1, 2, 3, 4, 5, 6, 12]],
    "env": [[0, 1, 2, 3, 4, 5, 7, 10], [0, 1, 2, 3, 4, 5, 8, 11], [0, 1, 2, 3, 4, 5, 9, 12]],
}


# ---------------------------------------------------------------------------------------------
# weights
# ---------------------------------------------------------------------------------------------
def read_tza(path):
    """{name: float32 ndarray} from a .tza (layout in pt_to_tza.py: header, aligned data, table at the end)."""
    b = open(path, "rb").read()
    magic, major, _minor, toff = struct.unpack_from("<HBBQ", b, 0)
    if magic != 0x41D7 or major != 2:
        raise ValueError("not a tza v2 file: %s" % path)
    (n,) = struct.unpack_from("<I", b, toff)
    o = toff + 4
    out = {}
    for _ in range(n):
        (nl,) = struct.unpack_from("<H", b, o); o += 2
        name = b[o:o + nl].decode("ascii"); o += nl
        nd = b[o]; o += 1
        shape = struct.unpack_from("<%dI" % nd, b, o); o += 4 * nd
        o += nd                                          # one layout char per dim
        dtype = chr(b[o]); o += 1
        (to,) = struct.unpack_from("<Q", b, o); o += 8
        count = int(np.prod(shape)) if nd else 1
        dt = {"f": "<f4", "h": "<f2"}[dtype]
        out[name] = np.frombuffer(b, dtype=dt, count=count, offset=to).astype(np.float32).reshape(shape)
    return out


# ---------------------------------------------------------------------------------------------
# ops. x is [C, H, W] float32
# ---------------------------------------------------------------------------------------------
def conv1x1(x, w, b=None):
    """nn.Conv2d(k=1). w [O, I, 1, 1]."""
    c, h, wd = x.shape
    y = (w[:, :, 0, 0] @ x.reshape(c, h * wd)).reshape(w.shape[0], h, wd)
    return y if b is None else y + b[:, None, None]


def conv3x3(x, w, b):
    """nn.Conv2d(k=3, padding=1), zero padding. w [O, I, 3, 3] (cross-correlation, as PyTorch)."""
    c, h, wd = x.shape
    xp = np.pad(x, ((0, 0), (1, 1), (1, 1)))
    y = np.zeros((w.shape[0], h * wd), np.float32)
    for ky in range(3):
        for kx in range(3):
            y += w[:, :, ky, kx] @ np.ascontiguousarray(xp[:, ky:ky + h, kx:kx + wd]).reshape(c, h * wd)
    return y.reshape(w.shape[0], h, wd) + b[:, None, None]


def rmsnorm(x, g):
    """F.normalize(x, dim=1) * g * sqrt(C)."""
    n = np.sqrt((x * x).sum(axis=0, keepdims=True))
    return x / np.maximum(n, np.float32(1e-12)) * g[:, None, None] * np.float32(x.shape[0] ** 0.5)


def silu(x):
    return x / (1.0 + np.exp(-x))


def block(W, p, x):
    """Block: conv3x3 -> RMSNorm -> SiLU."""
    return silu(rmsnorm(conv3x3(x, W[p + ".proj.weight"], W[p + ".proj.bias"]), W[p + ".norm.g"]))


def resblock(W, p, x):
    """ResnetBlock: block2(block1(x)) + (1x1 res_conv(x) if dim != dim_out else x)."""
    h = block(W, p + ".block2", block(W, p + ".block1", x))
    if p + ".res_conv.weight" in W:
        return h + conv1x1(x, W[p + ".res_conv.weight"], W[p + ".res_conv.bias"])
    return h + x


def downsample(W, p, x):
    """Rearrange 'c (h p1) (w p2) -> (c p1 p2) h w' then 1x1 conv (Sequential index 1)."""
    c, h, w = x.shape
    u = x.reshape(c, h // 2, 2, w // 2, 2).transpose(0, 2, 4, 1, 3).reshape(c * 4, h // 2, w // 2)
    return conv1x1(u, W[p + ".1.weight"], W[p + ".1.bias"])


def upsample(W, p, x):
    """nearest 2x then conv3x3 (Sequential index 1)."""
    return conv3x3(x.repeat(2, axis=1).repeat(2, axis=2), W[p + ".1.weight"], W[p + ".1.bias"])


def softmax(s):
    s = s - s.max(axis=-1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(axis=-1, keepdims=True)


def block_attention(W, p, x, bs):
    """BlockAttention: norm, reflect pad by 2, qkv 1x1, bs+4 windows at stride bs, 8 memory k/v prepended
    to every window, softmax attention with scale dim_head^-0.5, crop the centre bs x bs, to_out 1x1.
    No residual (the caller adds it). Returns [C, H, W]."""
    c, H, Wd = x.shape
    assert H % bs == 0 and Wd % bs == 0
    K = bs + 2 * HALO
    xn = rmsnorm(x, W[p + ".norm.g"])
    xp = np.pad(xn, ((0, 0), (HALO, HALO), (HALO, HALO)), mode="reflect")
    qkv = conv1x1(xp, W[p + ".to_qkv.weight"])             # [3*h*d, Hp, Wp], chunk order q, k, v
    hd = HEADS * DIM_HEAD
    nH, nW = H // bs, Wd // bs

    def windows(t):                                         # [h*d, Hp, Wp] -> [nH*nW, heads, K*K, d]
        win = np.lib.stride_tricks.sliding_window_view(t, (K, K), axis=(1, 2))[:, ::bs, ::bs]   # [hd, nH, nW, K, K]
        win = win.reshape(HEADS, DIM_HEAD, nH, nW, K, K).transpose(2, 3, 0, 4, 5, 1)           # nH nW h kh kw d
        return np.ascontiguousarray(win).reshape(nH * nW, HEADS, K * K, DIM_HEAD)

    q, k, v = windows(qkv[:hd]), windows(qkv[hd:2 * hd]), windows(qkv[2 * hd:])
    mem = W[p + ".mem_kv"]                                  # [2, heads, 8, d]
    n = nH * nW
    k = np.concatenate([np.broadcast_to(mem[0], (n,) + mem[0].shape), k], axis=2)               # memory FIRST
    v = np.concatenate([np.broadcast_to(mem[1], (n,) + mem[1].shape), v], axis=2)
    sim = np.einsum("nhid,nhjd->nhij", q, k) * np.float32(DIM_HEAD ** -0.5)
    out = np.einsum("nhij,nhjd->nhid", softmax(sim), v)      # [n, h, K*K, d]
    out = out.reshape(nH, nW, HEADS, K, K, DIM_HEAD)[:, :, :, HALO:HALO + bs, HALO:HALO + bs, :]
    out = out.transpose(2, 5, 0, 3, 1, 4).reshape(hd, H, Wd)  # (h d) (nh bh) (nw bw)
    return conv1x1(out, W[p + ".to_out.weight"], W[p + ".to_out.bias"])


# ---------------------------------------------------------------------------------------------
# UNet
# ---------------------------------------------------------------------------------------------
def unet(W, x, tap=None):
    """HaloNetFast.forward. x [8, H, W] -> [1, H, W]. tap(name, array) receives intermediates."""
    t = tap or (lambda n, a: None)
    x = conv3x3(x, W["init_conv.weight"], W["init_conv.bias"])
    t("init_conv", x)
    r = x
    hs = []
    nd = len(IN_OUT)
    for i in range(nd):
        p = "downs.%d" % i
        x = resblock(W, p + ".0", x)             # the stage's "block1" is a whole ResnetBlock
        t("downs.%d.block1" % i, x)                 # (all stages since N5.8; was stage 0 only)
        hs.append(x)
        x = resblock(W, p + ".1", x)
        if i == 0:
            t("downs.0.block2", x)
        if ATTN_MODES[i] == 0:
            a = x                                           # nn.Identity: attn(x) + x == 2x
        else:
            t("downs.%d.attn_in" % i, x)                    # attention input (N5.9)
            a = block_attention(W, p + ".2", x, 8)
            t("downs.%d.attn" % i, a)
        x = a + x
        t("downs.%d.post_attn_add" % i, x)          # the second skip of the stage (all stages since N5.8)
        hs.append(x)
        x = conv3x3(x, W[p + ".3.weight"], W[p + ".3.bias"]) if i == nd - 1 else downsample(W, p + ".3", x)
        t("downs.%d.down" % i, x)
    x = resblock(W, "mid_block1", x)
    t("mid_attn_in", x)                                     # attention input (N5.9)
    a = block_attention(W, "mid_attn", x, 4)
    x = a + x
    t("mid_attn", a)
    x = resblock(W, "mid_block2", x)
    t("mid_block2", x)
    for i in range(nd):
        p = "ups.%d" % i
        x = resblock(W, p + ".0", np.concatenate([x, hs.pop()], axis=0))
        t("ups.%d.block1" % i, x)                   # first ResnetBlock of the up stage (N5.8)
        x = resblock(W, p + ".1", np.concatenate([x, hs.pop()], axis=0))
        if ATTN_MODES[nd - 1 - i] == 0:
            a = x
        else:
            t("ups.%d.attn_in" % i, x)                      # attention input (N5.9)
            a = block_attention(W, p + ".2", x, 8)
            t("ups.%d.attn" % i, a)
        x = a + x
        x = conv3x3(x, W[p + ".3.weight"], W[p + ".3.bias"]) if i == nd - 1 else upsample(W, p + ".3", x)
        t("ups.%d" % i, x)
    x = resblock(W, "final_res_block", np.concatenate([x, r], axis=0))
    t("final_res_block", x)
    x = conv1x1(x, W["final_conv.weight"], W["final_conv.bias"])
    t("final_conv", x)
    return x


def compose(Wd, We, cond, light_intensity, env_scale, tap=None):
    """HaloRTCompose + reconstruct_radiance. cond [17, H, W]; returns [3, H, W]."""
    t = tap or (lambda n, a: None)
    S, B = cond[13:14], cond[14:17]
    direct, env = [], []
    for k in range(3):
        for kind, Wt, out in (("dir", Wd, direct), ("env", We, env)):
            o = unet(Wt, cond[INDICES[kind][k]], tap=(lambda n, a, kind=kind: t(kind + "." + n, a)) if k == 0 else None)
            t("%s.pass%d" % (kind, k), o)
            out.append(o)
    direct, env = np.concatenate(direct, 0), np.concatenate(env, 0)
    li = light_intensity[:, None, None]
    es = env_scale[:, None, None]
    img = (direct * li + es * env) * S + B * es * (1 - S)
    t("blended", img)
    return img.astype(np.float32)


# ---------------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------------
DUMP_DEFAULT = [
    "init_conv", "downs.0.block1", "downs.0.block2", "downs.0.post_attn_add", "downs.0.down", "downs.3.attn",
    "mid_attn", "ups.0", "ups.6", "final_res_block", "final_conv",
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--size", type=int, default=256, choices=[256, 512])
    ap.add_argument("--check", action="store_true", help="compare with out_wasm_<size>.f32")
    ap.add_argument("--dump", metavar="DIR", help="write intermediates for pass 0 of dir and env as raw float32 + index.json")
    ap.add_argument("--dump-all", action="store_true", help="dump every tapped tensor, not just the default set")
    ap.add_argument("--fixture", default=FIXTURE)
    ap.add_argument("--weights", default=WEIGHTS, help="path pattern with one %%s for dir/env")
    a = ap.parse_args()
    S = a.size
    fx = a.fixture
    cond = np.fromfile("%s/cond_%d.f32" % (fx, S), "<f4").reshape(17, S, S)
    li = np.fromfile("%s/light_intensity_%d.f32" % (fx, S), "<f4")
    es = np.fromfile("%s/environment_scale_%d.f32" % (fx, S), "<f4")
    Wd, We = read_tza(a.weights % "dir"), read_tza(a.weights % "env")
    taps = {}
    t0 = time.time()
    img = compose(Wd, We, cond, li, es, tap=lambda n, arr: taps.__setitem__(n, np.array(arr, np.float32)))
    dt = time.time() - t0
    print("forward %d: %.1f s" % (S, dt))
    if a.check:
        ref = np.fromfile("%s/out_wasm_%d.f32" % (fx, S), "<f4").reshape(3, S, S)
        d = np.abs(img - ref)
        print("size %d  max abs diff %.3e  mean abs diff %.3e  (mean abs ref %.4f)" % (S, d.max(), d.mean(), np.abs(ref).mean()))
        print("PASS" if d.max() <= 1e-4 else "FAIL")
    if a.dump:
        os.makedirs(a.dump, exist_ok=True)
        names = sorted(taps) if a.dump_all else (
            ["%s.%s" % (k, n) for k in ("dir", "env") for n in DUMP_DEFAULT]
            + ["%s.pass%d" % (k, i) for k in ("dir", "env") for i in range(3)] + ["blended"])
        idx = {}
        for n in names:
            arr = taps[n]
            fn = n.replace("/", "_") + ".f32"
            arr.astype("<f4").tofile(os.path.join(a.dump, fn))
            idx[n] = {"file": fn, "shape": list(arr.shape), "layout": "CHW float32 little-endian",
                      "note": "pass 0 of the weight set" if n.split(".")[0] in ("dir", "env") and ".pass" not in n else ""}
        idx["_meta"] = {"size": S, "command": "halonet_ref.py --size %d --dump" % S,
                        "pass_indices": INDICES, "blend": "(direct*li + es*env)*S + B*es*(1-S), S=cond[13], B=cond[14:17]"}
        json.dump(idx, open(os.path.join(a.dump, "index.json"), "w"), indent=1)
        print("dumped %d tensors to %s" % (len(names), a.dump))


if __name__ == "__main__":
    sys.exit(main())
