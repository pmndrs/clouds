#!/usr/bin/env python3 -I
"""Convert HaloRT PyTorch weight files (.pt) to OIDN-style .tza archives.

Standard library only (no torch, no numpy). Run as `python3 -I`.

  python3 -I scripts/neural/pt_to_tza.py [--fp16] [--verify] [--out DIR] a.pt [b.pt ...]

Reading: a .pt is a zip with `<name>/data.pkl` and `<name>/data/<n>` raw little-endian
storages. The pickle is read by a restricted Unpickler that only allows
collections.OrderedDict, torch._utils._rebuild_tensor_v2 / _rebuild_parameter and the
torch.*Storage names (mapped to stubs); anything else raises.

Writing (matches Denoiser packages/denoiser-core/src/tza.ts):
  header : u16 magic 0x41d7, u8 major 2, u8 minor 0, u64 table offset (LE), padded to 64
  data   : each tensor 64-byte aligned, raw LE f32 (or f16 with --fp16)
  table  : u32 count, then per tensor: u16 name_len, name, u8 ndims, u32 dims[],
           ndims layout chars, u8 dtype ('f' or 'h'), u64 data offset
Names keep PyTorch keys (a leading `_orig_mod.` is stripped); shapes are native (OIHW).
"""
import argparse, collections, io, itertools, os, pickle, struct, sys, zipfile

DEFAULT_OUT = "/Users/dex/Developer/WebGPUClouds/artifacts/research/neural/weights"
MAGIC, MAJOR, MINOR = 0x41D7, 2, 0
ITEMSIZE = {"FloatStorage": 4, "HalfStorage": 2, "DoubleStorage": 8, "LongStorage": 8,
            "IntStorage": 4, "ShortStorage": 2, "CharStorage": 1, "ByteStorage": 1,
            "BoolStorage": 1}
STRUCT = {"FloatStorage": "f", "HalfStorage": "e", "DoubleStorage": "d", "LongStorage": "q",
          "IntStorage": "i", "ShortStorage": "h", "CharStorage": "b", "ByteStorage": "B",
          "BoolStorage": "?"}


class StorageType:
    def __init__(self, name):
        self.name = name


class Storage:
    def __init__(self, stype, key, numel):
        self.stype, self.key, self.numel = stype, key, numel
        self.raw = None  # bytes, loaded in persistent_load


class Tensor:
    def __init__(self, storage, offset, size, stride):
        self.storage, self.offset, self.size, self.stride = storage, offset, tuple(size), tuple(stride)

    def numel(self):
        n = 1
        for s in self.size:
            n *= s
        return n

    def raw_bytes(self):
        """Raw LE bytes of this tensor (must be contiguous), plus struct char."""
        isz = ITEMSIZE[self.storage.stype]
        exp, acc = [], 1
        for s in reversed(self.size):
            exp.append(acc)
            acc *= max(s, 1)
        exp.reverse()
        contiguous = all(not (s > 1 and st != e) for s, st, e in zip(self.size, self.stride, exp))
        if contiguous:
            a = self.offset * isz
            return self.storage.raw[a:a + self.numel() * isz], STRUCT[self.storage.stype]
        # Strided view (HaloRT stores conv weights channels-last): gather into logical
        # row-major order, which is what the .tza format expects.
        out = bytearray()
        raw = self.storage.raw
        for idx in itertools.product(*[range(s) for s in self.size]):
            a = (self.offset + sum(i * st for i, st in zip(idx, self.stride))) * isz
            out += raw[a:a + isz]
        return bytes(out), STRUCT[self.storage.stype]


def _rebuild_tensor_v2(storage, storage_offset, size, stride, requires_grad=False,
                       backward_hooks=None, metadata=None):
    return Tensor(storage, storage_offset, size, stride)


def _rebuild_parameter(data, requires_grad=False, backward_hooks=None, *a):
    return data


class RestrictedUnpickler(pickle.Unpickler):
    def __init__(self, f, zf, prefix):
        super().__init__(f)
        self.zf, self.prefix, self.cache = zf, prefix, {}

    def find_class(self, module, name):
        if module == "collections" and name == "OrderedDict":
            return collections.OrderedDict
        if module == "torch._utils" and name == "_rebuild_tensor_v2":
            return _rebuild_tensor_v2
        if module == "torch._utils" and name == "_rebuild_parameter":
            return _rebuild_parameter
        if module == "torch" and name in ITEMSIZE:
            return StorageType(name)
        raise pickle.UnpicklingError("forbidden global %s.%s" % (module, name))

    def persistent_load(self, pid):
        if not (isinstance(pid, tuple) and pid and pid[0] == "storage"):
            raise pickle.UnpicklingError("unexpected persistent id %r" % (pid,))
        _, stype, key, _loc, numel = pid[:5]
        if not isinstance(stype, StorageType):
            raise pickle.UnpicklingError("bad storage type")
        if key not in self.cache:
            st = Storage(stype.name, key, numel)
            st.raw = self.zf.read("%s/data/%s" % (self.prefix, key))
            if len(st.raw) != numel * ITEMSIZE[stype.name]:
                raise ValueError("storage %s size mismatch" % key)
            self.cache[key] = st
        return self.cache[key]


def load_pt(path):
    """Return OrderedDict name -> Tensor (stub with raw bytes)."""
    with zipfile.ZipFile(path) as zf:
        pkl = [n for n in zf.namelist() if n.endswith("/data.pkl")]
        if len(pkl) != 1:
            raise ValueError("expected one data.pkl, got %r" % pkl)
        prefix = pkl[0][: -len("/data.pkl")]
        obj = RestrictedUnpickler(io.BytesIO(zf.read(pkl[0])), zf, prefix).load()
    if not isinstance(obj, dict):
        raise ValueError("top-level object is not a state dict")
    return obj


def layout_for(shape):
    n = len(shape)
    return {4: "oihw", 3: "oiw", 2: "oi", 1: "x", 0: ""}.get(n, "x" * n)


def f32_to_f16_bytes(raw):
    n = len(raw) // 4
    vals = struct.unpack("<%df" % n, raw)
    return struct.pack("<%de" % n, *vals)


def convert(pt_path, out_path, fp16):
    sd = load_pt(pt_path)
    items, nparams = [], 0
    for k, t in sd.items():
        if not isinstance(t, Tensor):
            raise ValueError("non-tensor value for %s: %r" % (k, type(t)))
        name = k[len("_orig_mod."):] if k.startswith("_orig_mod.") else k
        raw, ch = t.raw_bytes()
        if ch != "f":
            raise ValueError("%s: only float32 tensors supported (got %s)" % (name, ch))
        if fp16:
            raw = f32_to_f16_bytes(raw)
        items.append((name, t.size, raw))
        nparams += t.numel()
    buf = bytearray(b"\0" * 64)
    offs = []
    for _, _, raw in items:
        while len(buf) % 64:
            buf.append(0)
        offs.append(len(buf))
        buf += raw
    while len(buf) % 64:
        buf.append(0)
    table_off = len(buf)
    buf += struct.pack("<I", len(items))
    for (name, shape, _), off in zip(items, offs):
        nb = name.encode("utf-8")
        buf += struct.pack("<H", len(nb)) + nb + struct.pack("<B", len(shape))
        for d in shape:
            buf += struct.pack("<I", d)
        buf += layout_for(shape).encode("ascii")
        buf += (b"h" if fp16 else b"f") + struct.pack("<Q", off)
    struct.pack_into("<HBBQ", buf, 0, MAGIC, MAJOR, MINOR, table_off)
    with open(out_path, "wb") as f:
        f.write(buf)
    return sd, len(items), nparams


def read_tza(path):
    """Minimal reader: name -> (shape, dtype char, raw bytes)."""
    b = open(path, "rb").read()
    magic, major, _minor, toff = struct.unpack_from("<HBBQ", b, 0)
    if magic != MAGIC or major != MAJOR:
        raise ValueError("bad tza header")
    n = struct.unpack_from("<I", b, toff)[0]
    o = toff + 4
    out = collections.OrderedDict()
    for _ in range(n):
        (nl,) = struct.unpack_from("<H", b, o); o += 2
        name = b[o:o + nl].decode(); o += nl
        nd = b[o]; o += 1
        shape = struct.unpack_from("<%dI" % nd, b, o); o += 4 * nd
        o += nd
        dt = chr(b[o]); o += 1
        (to,) = struct.unpack_from("<Q", b, o); o += 8
        cnt = 1
        for s in shape:
            cnt *= s
        sz = cnt * (4 if dt == "f" else 2)
        out[name] = (shape, dt, b[to:to + sz])
    return out


def verify(sd, tza_path, fp16):
    """Compare three sampled tensors bit-for-bit against the .pt storages."""
    back = read_tza(tza_path)
    keys = [(k[len("_orig_mod."):] if k.startswith("_orig_mod.") else k, k) for k in sd]
    names = [n for n, _ in keys]
    convs = [n for n in names if n.endswith(".weight") and len(sd[dict(keys)[n]].size) == 4]
    mems = [n for n in names if n.endswith("mem_kv")]
    biases = [n for n in names if n.endswith(".bias")]
    picks = [convs[0], mems[0], names[-1] if names[-1].endswith(".bias") else biases[-1]]
    for n in picks:
        t = sd[dict(keys)[n]]
        isz = ITEMSIZE[t.storage.stype]
        raw = b"".join(
            t.storage.raw[(t.offset + sum(i * st for i, st in zip(idx, t.stride))) * isz:][:isz]
            for idx in itertools.product(*[range(s) for s in t.size]))  # independent element-wise path
        if fp16:
            raw = f32_to_f16_bytes(raw)
        shape, dt, got = back[n]
        ok = tuple(shape) == t.size and got == raw and dt == ("h" if fp16 else "f")
        print("  verify %-40s %-16s %s" % (n, list(shape), "OK (bit-identical)" if ok else "MISMATCH"))
        if not ok:
            return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--fp16", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--list", action="store_true", help="print every tensor name and shape")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rc = 0
    for p in a.inputs:
        stem = os.path.splitext(os.path.basename(p))[0]
        outp = os.path.join(a.out, stem + (".fp16" if a.fp16 else "") + ".tza")
        sd, n, np_ = convert(p, outp, a.fp16)
        print("%s -> %s : %d tensors, %d parameters, %d bytes" % (p, outp, n, np_, os.path.getsize(outp)))
        if a.list:
            for k, t in sd.items():
                print("   %s %s" % (k, list(t.size)))
        if a.verify and not verify(sd, outp, a.fp16):
            rc = 1
    sys.exit(rc)


if __name__ == "__main__":
    main()
