/**
 * blosc.ts: Blosc 1.x chunk decoder with the LZ4 codec (what OpenVDB and Houdini write for "Blosc" compression).
 *
 * Added for the Nubis cloud importer (P4-H); not part of upstream vdb-web-tools. Written from the public Blosc chunk
 * format (16 byte header, per-block start table, one or more length-prefixed codec streams per block, optional byte
 * shuffle) and the LZ4 block format. Supported: raw (memcpy) chunks, LZ4 / LZ4HC streams, byte shuffle, split streams.
 * Not supported (clear error): blosclz, snappy, zlib and zstd streams, bit shuffle, Blosc2 frames.
 */

import { VdbFormatError, VdbUnsupportedError } from "./errors.js";

const BLOSC_DOSHUFFLE = 0x1;
const BLOSC_MEMCPYED = 0x2;
const BLOSC_DOBITSHUFFLE = 0x4;
const CODEC_NAMES = ["blosclz", "lz4", "snappy", "zlib", "zstd"];
const MIN_BUFFERSIZE = 128;
const MAX_SPLITS = 16;

/** Decompress one LZ4 block of known output size. */
export function lz4DecompressBlock(src: Uint8Array, sp: number, spEnd: number, dst: Uint8Array, dp: number, dpEnd: number): void {
  while (sp < spEnd) {
    const token = src[sp++]!;
    let literals = token >>> 4;
    if (literals === 15) {
      let b: number;
      do {
        b = src[sp++]!;
        literals += b;
      } while (b === 255 && sp < spEnd);
    }
    if (dp + literals > dpEnd || sp + literals > spEnd) throw new VdbFormatError("corrupt LZ4 stream (literal run out of range)");
    for (let i = 0; i < literals; i++) dst[dp++] = src[sp++]!;
    if (sp >= spEnd) break; // the last sequence carries only literals
    const offset = src[sp]! | (src[sp + 1]! << 8);
    sp += 2;
    if (offset === 0 || offset > dp) throw new VdbFormatError("corrupt LZ4 stream (bad match offset)");
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b: number;
      do {
        b = src[sp++]!;
        matchLen += b;
      } while (b === 255 && sp < spEnd);
    }
    matchLen += 4;
    if (dp + matchLen > dpEnd) throw new VdbFormatError("corrupt LZ4 stream (match run out of range)");
    for (let i = 0, from = dp - offset; i < matchLen; i++) dst[dp++] = dst[from + i]!;
  }
  if (dp !== dpEnd) throw new VdbFormatError(`LZ4 block decoded ${dp} bytes, expected ${dpEnd}`);
}

function unshuffle(src: Uint8Array, dst: Uint8Array, start: number, size: number, typesize: number): void {
  const n = Math.floor(size / typesize);
  for (let j = 0; j < typesize; j++) for (let i = 0; i < n; i++) dst[start + i * typesize + j] = src[j * n + i]!;
  for (let i = n * typesize; i < size; i++) dst[start + i] = src[i]!;
}

/** Decode one Blosc chunk. */
export function bloscDecompress(chunk: Uint8Array): Uint8Array {
  if (chunk.length < 16) throw new VdbFormatError("blosc chunk shorter than its header");
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const flags = chunk[2]!;
  const typesize = chunk[3]! || 1;
  const nbytes = view.getUint32(4, true);
  const blocksize = view.getUint32(8, true);
  const cbytes = view.getUint32(12, true);
  if (cbytes > chunk.length) throw new VdbFormatError(`blosc chunk claims ${cbytes} bytes but only ${chunk.length} are available`);
  const out = new Uint8Array(nbytes);
  if (flags & BLOSC_MEMCPYED) {
    out.set(chunk.subarray(16, 16 + nbytes));
    return out;
  }
  if (flags & BLOSC_DOBITSHUFFLE) throw new VdbUnsupportedError("blosc bit-shuffled data is not supported");
  const codec = flags >>> 5;
  if (codec !== 1) throw new VdbUnsupportedError(`blosc codec "${CODEC_NAMES[codec] ?? codec}" is not supported (only lz4)`);
  if (blocksize === 0) throw new VdbFormatError("blosc chunk with block size 0");
  const nblocks = Math.ceil(nbytes / blocksize);
  const shuffled = (flags & BLOSC_DOSHUFFLE) !== 0 && typesize > 1;
  const tmp = shuffled ? new Uint8Array(blocksize) : null;
  for (let b = 0; b < nblocks; b++) {
    const bsize = b === nblocks - 1 && nbytes % blocksize !== 0 ? nbytes % blocksize : blocksize;
    const leftover = bsize !== blocksize;
    const nsplits = !leftover && typesize <= MAX_SPLITS && Math.floor(bsize / typesize) >= MIN_BUFFERSIZE ? typesize : 1;
    const splitSize = Math.floor(bsize / nsplits);
    let sp = view.getUint32(16 + b * 4, true);
    const target = shuffled ? tmp! : out;
    const base = shuffled ? 0 : b * blocksize;
    for (let s = 0; s < nsplits; s++) {
      const csize = view.getInt32(sp, true);
      sp += 4;
      if (csize < 0 || sp + csize > chunk.length) throw new VdbFormatError("corrupt blosc stream (split size out of range)");
      if (csize === splitSize) target.set(chunk.subarray(sp, sp + csize), base + s * splitSize);
      else lz4DecompressBlock(chunk, sp, sp + csize, target, base + s * splitSize, base + (s + 1) * splitSize);
      sp += csize;
    }
    if (shuffled) unshuffle(tmp!, out, b * blocksize, bsize, typesize);
  }
  return out;
}
