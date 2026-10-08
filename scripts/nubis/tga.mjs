// Minimal TGA decoder: types 2 (raw truecolor), 3 (raw gray), 10 (RLE truecolor), 11 (RLE gray);
// 8/24/32 bpp. Output is RGBA8 with rows ordered bottom-to-top (row 0 = image bottom),
// regardless of the file's origin bit, so callers always get one consistent orientation.

export function decodeTga(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const idLen = u8[0];
  const cmapType = u8[1];
  const type = u8[2];
  const cmapLen = u8[5] | (u8[6] << 8);
  const cmapBits = u8[7];
  const width = u8[12] | (u8[13] << 8);
  const height = u8[14] | (u8[15] << 8);
  const bpp = u8[16];
  const desc = u8[17];
  if (cmapType !== 0) throw new Error('TGA: color-mapped images are not supported');
  if (![2, 3, 10, 11].includes(type)) throw new Error(`TGA: unsupported image type ${type}`);
  if (![8, 24, 32].includes(bpp)) throw new Error(`TGA: unsupported bpp ${bpp}`);
  const bytesPP = bpp >> 3;
  const rle = type >= 9;
  const gray = type === 3 || type === 11;
  const pixels = width * height;
  let p = 18 + idLen + cmapLen * (cmapBits >> 3);

  // Raw pixel bytes in file order.
  const raw = new Uint8Array(pixels * bytesPP);
  if (!rle) {
    if (u8.length - p < raw.length) throw new Error('TGA: truncated pixel data');
    raw.set(u8.subarray(p, p + raw.length));
  } else {
    let o = 0;
    while (o < raw.length) {
      if (p >= u8.length) throw new Error('TGA: truncated RLE data');
      const h = u8[p++];
      const n = (h & 0x7f) + 1;
      if (n * bytesPP > raw.length - o) throw new Error('TGA: RLE packet overruns image');
      if (h & 0x80) {
        if (p + bytesPP > u8.length) throw new Error('TGA: truncated RLE data');
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < bytesPP; c++) raw[o + c] = u8[p + c];
          o += bytesPP;
        }
        p += bytesPP;
      } else {
        const len = n * bytesPP;
        raw.set(u8.subarray(p, p + len), o);
        p += len;
        o += len;
      }
    }
  }

  const topLeft = (desc & 0x20) !== 0; // bit 5: rows stored top-to-bottom
  const rightToLeft = (desc & 0x10) !== 0;
  const data = new Uint8Array(pixels * 4);
  for (let y = 0; y < height; y++) {
    const dstY = topLeft ? height - 1 - y : y; // normalise to bottom-up
    for (let x = 0; x < width; x++) {
      const dstX = rightToLeft ? width - 1 - x : x;
      const s = (y * width + x) * bytesPP;
      const d = (dstY * width + dstX) * 4;
      if (gray || bytesPP === 1) {
        data[d] = data[d + 1] = data[d + 2] = raw[s];
        data[d + 3] = 255;
      } else {
        data[d] = raw[s + 2];
        data[d + 1] = raw[s + 1];
        data[d + 2] = raw[s];
        data[d + 3] = bytesPP === 4 ? raw[s + 3] : 255;
      }
    }
  }
  return { width, height, data, originTopLeft: topLeft };
}

// Encoder used by tests (and handy for fixtures): 32-bit BGRA, bottom-left origin.
export function encodeTga({ width, height, data }, { rle = false } = {}) {
  const hdr = new Uint8Array(18);
  hdr[2] = rle ? 10 : 2;
  hdr[12] = width & 255; hdr[13] = width >> 8;
  hdr[14] = height & 255; hdr[15] = height >> 8;
  hdr[16] = 32;
  const px = (i) => [data[i * 4 + 2], data[i * 4 + 1], data[i * 4], data[i * 4 + 3]];
  const body = [];
  const n = width * height;
  if (!rle) {
    for (let i = 0; i < n; i++) body.push(...px(i));
  } else {
    let i = 0;
    const same = (a, b) => px(a).every((v, k) => v === px(b)[k]);
    while (i < n) {
      let run = 1;
      while (i + run < n && run < 128 && same(i, i + run)) run++;
      if (run > 1) { body.push(0x80 | (run - 1), ...px(i)); i += run; continue; }
      let lit = 1;
      while (i + lit < n && lit < 128 && !(i + lit + 1 < n && same(i + lit, i + lit + 1))) lit++;
      body.push(lit - 1);
      for (let k = 0; k < lit; k++) body.push(...px(i + k));
      i += lit;
    }
  }
  const out = new Uint8Array(18 + body.length);
  out.set(hdr); out.set(body, 18);
  return out;
}
