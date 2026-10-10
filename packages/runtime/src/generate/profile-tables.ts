/**
 * H4 (S3): the Nubis Evolved / Nubis Cubed vertical-profile tables [NE 2022 p.21-28, N3 s18; docs/research/topics/shape.md §2].
 *
 *   vertical_profile    = topTable(top_type, h) * bottomTable(bottom_type, h)
 *   dimensional_profile = vertical_profile * coverage                         [N3 s18, NE p.29]
 *
 * Two 64 x 64 tables, height up (row 0 = the bottom of the column), type 0..1 across (column 0 = type 0). Sampled from the N3 s18 slide images
 * (image32 top, image33 bottom; shown flipped on the slide, flipped back here) at the cell centres, 8-bit: artifacts/research/extracted/n3/data/
 * n3-s018-lut-{top,bottom}-type.csv. The bottom image is a 15-colour palette PNG, so its values are good to about +-0.04.
 *
 * What the data say: both tables share a floor at row 17 (h = 17/64 = 0.266): below it top = 1 and bottom = 0, so the product is 0 there.
 * Bottom type 0 is the sharp-onset, flat, crisp base; bottom type 1 the slow, ragged one (n3.md §7a). Top type 0 is a one-row sheet on the floor;
 * the tops climb in steps with type, and the tall types are not monotone (a dip at h 0.5-0.6, a second shoulder at 0.65-0.7, a taper to about 0.4).
 *
 * The floor mapping (open in shape.md §2, decided here): the column's min height maps to the floor (v = FLOOR + u * (1 - FLOOR), u the height
 * fraction in [min, max]). Below the floor the product is identically 0 (bottom = 0), so mapping min height to v = 0 would only lift every base
 * by 27 % of the column for nothing; with the floor at min height, `min height` is where the base is, as the NDF's name says. The literal mapping
 * (v = u) stays a setting (SkyLayerSettings.tableFloor 0). Top type below about 0.12 gives a product under 0.2 everywhere (a thin wisp layer under
 * the additive law, nothing under a threshold), so our species never map below 0.14 (SPECIES_TOP_TYPES).
 */
export const PROFILE_TABLE_SIZE = 64;
/** The shared floor of both tables (table height, 0..1): below row 17 top = 1 and bottom = 0. */
export const PROFILE_TABLE_FLOOR = 17 / 64;
/**
 * The top type our species rows map to (generate/shaders.ts SP_*: 0 stratus, 0.25 stratocumulus, 0.5 humilis, 0.75 mediocris, 1 congestus).
 * Ours, tuned: NE's own insets put stratus at 0.07, stratocumulus at 0.27 and cumulus at 0.40 (NE p.23-25); 0.14 is the lowest type with a body
 * (stratus: a flat sheet with a soft top), 0.45 the first tiered one (mediocris), 0.9 the tall tiered head (congestus).
 */
export const SPECIES_TOP_TYPES = [0.14, 0.24, 0.33, 0.45, 0.9] as const;

// Top table (64 x 64 bytes, row-major, row 0 = bottom) followed by the bottom table.
const DATA =
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
  '/////////////////////////////////////////////////////////////////////8LQ2d/k6e/1+vv8/f39/f39/f39/f39/f39/f7+/v7/////////////////////////////////' +
  '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' +
  'AAAAAAAAAAAAAgUGPUhQVVldYGNna29xc3R2dnd3eHh4eXl5enp7ewAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMEIztFS1BXX2NnamxvcHFxcnJzc3N0dHV1dnYAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICAwMEP09YXmJkZmhpaWpra2xsbm5vb29wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIDRE5V' +
  'WV1fYGFiYmNkZGVlZmZnZwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICN0VMUFJTVFVWV1hZWVpcXV0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAECAgICJi4zNzs9QEJFRkhJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'IyMjIxEjERERERERERERABERABEAAAAAABEAABERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFRURUVFNEVFRUU0NDQjNCM0IyM0IyMjIyMjIxEjIxEjESMRERERERERERER' +
  'EQAAABEAEREAAAAAAAAAAAAAAAB3d2V3d2VlZWVUZWVUZVRUVFRURVRFVEVFRUVFNDRFNDQ0NDQ0IzQjIyMjIyMjIxEjIyMjIyMjIxERERERERERmpqamoiaiJqIiIiIiIh3d3d3ZXd3ZWV3' +
  'ZWVlZWVUVFRFVFRUVEVFRUVFRTQ0NDQ0NEU0NDQ0NDQ0NDQjNCMjI6u6q6urq6urmquaq5qampqaiIiIiIiId4h3d3d3ZXdlZWV3ZWVUVFRlVFRUVEVURUVFRUVFRUVFRUU0NDRFNDS6urq6' +
  'urqruqurq6urmpqampqamoiImoiIiIiIiIh3d3d3d2VlZXdlZWVlVFRlZVRUVFRUVEVURUVFRUVFNEU0urq6urqruqu6q6urq5qrq5qampqaiIiaiIiId4h3iHd3iHd3d3dlZWVld2VlZVRl' +
  'ZVRUZVRUVFRFRVRFRUVFRcu6urq6urq6q6u6q5qrq5qrmpqampqamoiImoiId3d3iIiId3d3d3d3d3d3ZWVlZVRUVFRlZVRURVRUVFRFRUXLy7q6urqrurqruqurq6uaq5qrmpqampqaiJqI' +
  'mpqIiIiIiHeId3d3d3dld2VlZXdlZWVlZWVUVFRUVEVFVFRFy8u6urq6urq6q7qrq6urq5qrq6uaq5qampqaiIiamoiIiIiIiIiId3eId3d3d2VlZWVlZXdlZWVUZVRUVGVUVMvLy8vLurq6' +
  'urqruqu6q6urq6urmpqampqampqIiJqaiIiIiIh3iIh3iHeId3d3d3d3ZWVlZWVlZWVlVGVUVGXLy8u6y7rLurq6urqrurq6q7qrq6uaq6urq5qampqImoiImpqImoh3iIiId4h3d4h3d3dl' +
  'ZXdlZWVld2VlZVRly8vLusu6urq6urq6uqurq7q6q6urq5qrq5qrmpqampqImoiamoiIiIiId4h3iHd3d3d3d3d3d3d3ZXdlZWVlZcvLy7rLusu6usu6urq6urqrq6urq6urq5qrq6uaq5qa' +
  'mpqampqIiIiImpqIiIiIiHd3d4h3iHd3d3dlZXdlZWXLy8vLy7q6y8u6urq6urq6q7qrq7qrq6urmqurmquampqampqaiIiampqImoiIiIh3iIh3d3d3d3d3d3d3d3dly8vLy8vLy8u6usu6' +
  'urq6urq6q7q6q7qrq6urmqurq6uaq5qampqampqaiIiampqIiIiIiHd3d3eIiHd3d3d3d8vLy8vLy8vLy8u6y7q6urq6urq6q6u6q7qruqurq6urq6urmpqamquampqaiJqaiJqIiJqIiIiI' +
  'iIh3d4h3iHfcy8vLy8vLy8u6y7rLurq6usu6urqrq7qrurqrq6urq5qrq6urq5qampqrmpqampqampqIiIiIiIiId4iId4h33MvL3MvLy8u6y8vLurq6urq6urq6urq6urq6q7qrq6urq5qr' +
  'q6urmquaq5qrmpqampqImpqampqIiIiIiIh3iMvLy8vLy8vLy8vLy8u6y7rLy7q6usu6urq6uqu6urq6q7qrq6urq6urq6urmquampqampqampqaiIiIiJqamojc3Nzc3MvLy8vLusu6y8u6' +
  'y7rLy7q6urq6urq6urqrq6u6urq6q6urmpqrq6uaq6uampqampqampqampqamoiay8vLy8vcy8vLy8vLusvLy7rLy8u6y7q6urq6urq6urq6uquruqu6q6u6q6urq5qrmpqrmpqrq5qrmpqa' +
  'moiamsvLy8vc3MvLy8vLy8vLy8vLy8vLy8vLusu6usu6urq6urq6urqrurq6q7qrq6urmqurq5qaq6urmpqampqamprLy8vcy8vc3NzLy8vLy8vLy8vLy8vLusu6y7q6urq6urq6urq6q7qr' +
  'uqu6q6urq6urq6uamqurq6urq6uampqa3Nzc3Mvcy9zcy9zL3MvLy8vLy8u6y8vLurrLy7q6urq6urq6urq6uqu6urqruqu6q7qrq6urq6urmpqrmqurq9zL3MvL3Mvcy8vLy8vcy8vLy8vL' +
  'y8vLusvLy8vLy7rLurq6urq6urq6urq6uqu6urqrurqrq6u6q6urq6urq5rcy8vL3Nzc3MvLy9zc3MvLy9zLy8vLy8vLy7rLy7rLusu6urq6usu6urq6urq6urq6urq6urq6uqu6uqurq6ur' +
  'y9zL3Nzcy8vcy9zLy8vcy8vcy8vcy8vLy8vLusvLy7rLy7rLurq6urq6urq6urq6urq6urq6q6uruquruqurq9zc3Nzc3NzLy8vL3Mvcy8vc3Mvc3MvLy8vLy8vLy8u6y8vLy7q6y8u6y7q6' +
  'urq6urq6urq6urq6urqrq7qrq6vc3Nzc3Nzc3Nzc3Nzc3Mvcy9zL3MvL3MvLy8vLy8vLy8vLy8vLy8vLusu6usu6y8u6urq6urq6urq6urq6urq63Nzc3Nzc3Nzc3NzL3Nzc3Mvcy9zLy8vL' +
  'y8vcy8vLy8vLy8vLy8vLy7rLy7rLy7q6usvLurrLy7q6urq6urq6utzc3Nzc3Nzc3Nzc3Nzc3Mvcy8vL3MvLy9zc3MvLy9zLy9zLy8vLy8vLy7q6y7rLy8vLy8u6urq6usu6urrLurrn3Nzc' +
  '3Nzc3Nzc3Nzc3MvL3Nzc3NzLy8vcy8vL3MvL3MvLy9zL3MvLy8vLy8vLusvLusu6y8vLy8vLurrLusvL3Ofn3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3NzLy8vc3MvLy9zcy9zc3NzLy8vLy8vLy8vL' +
  'y8vLy8vLy8vLy7rLy7rLy9zc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzcy9zc3Nzcy9zL3Nzcy8vLy8vcy9zcy8vcy8vLy8vLy8vLy8vLy8vLy8vLy8vc3Ofc3Ofc3Ofc3Nzc3Nzc3Nzc3Nzc3NzL3Nzc' +
  'y9zc3Mvc3Nzcy8vcy8vcy8vLy9zcy8vLy8vcy8vLy8vLy8vL5+fc3Ofc3Nzc3Nzn3Nzc3Nzc3Nzc3Mvc3Mvc3Nzc3Nzc3Nzc3MvLy9zcy8vcy8vLy9zLy8vLy9zLy8vcy8vLy9zc3Nzc3Ofc' +
  '3Nzc3Nzc5+fc3Nzc3Nzc3Nzc3Mvc3Nzc3Nzc3Nzc3Nzcy9zc3Mvc3NzLy8vLy9zLy8vc3MvL3Mvn3Ofc3Nzn3Nzn3Ofc59zc3Ofc5+fc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzcy9zL' +
  'y8vc3MvLy9zL3NzL5+fc59zn3Ofc3Nzc3Ofc3Nzc3Nzc3Nzn3Ofc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzcy9zc3Nzcy9zc3Nzcy+fn5+fn5+fc3Ofn3Ofc3Ofc3Nzn3Ofc3Ofc3Nzn3Nzc' +
  '3Nzc5+fc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3NzL3Mvc3Nzn5+fc5+fc5+fn5+fc3Nzn3Nzn5+fc5+fn5+fc3Nzc5+fc3Ofn3Nzn3Nzn3Nzc59zc3Nzc3Nzc3Nzc3Nzc3Nzc5+fn3Ofn3Ofn5+fn' +
  '3Ofn5+fn59zn3Nzn59zc3Ofn3Ofn5+fc3Ofc3Ofc3Ofc59zc3Nzc3Nzn3Nzc3Nzc3Ofc3Ofn5+fn5+fn59zc5+fn5+fc59zn59zn5+fn59zn5+fn5+fn3Ofn3Nzn5+fn3Nzn3Nzc59zc5+fn' +
  '59zc5+fc3Nzn5+fn5+fn5+fc3Ofn5+fn3Ofc5+fc5+fn5+fc5+fn59zc5+fn3Ofc59zn3Ofn3Ofn5+fn3Nzc5+fn5+fn5+fc5+fn5+fn3Ofn5+fn3Ofn5+fn5+fn5+fc59zc59zn5+fn59zn' +
  '5+fc5+fn5+fn3Ofn3Nzn5+fc59zn5+fn5+fc5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn3Ofn5+fn59zn59zc5+fn3Ofc5+fn5+fn3Oc=';

let decoded: { top: Uint8Array; bottom: Uint8Array } | null = null;
/** The two tables as bytes (value * 255), row-major, row 0 = the bottom of the column, 64 type columns per row. */
export function profileTables(): { top: Uint8Array; bottom: Uint8Array } {
  if (!decoded) {
    const bin = atob(DATA);
    const all = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) all[i] = bin.charCodeAt(i);
    const n = PROFILE_TABLE_SIZE * PROFILE_TABLE_SIZE;
    decoded = { top: all.subarray(0, n), bottom: all.subarray(n, 2 * n) };
  }
  return decoded;
}

let smoothed: { top: Uint8Array; bottom: Uint8Array } | null = null;
/**
 * The tables as the sky layer uses them: smoothed in height above the floor (rows 17..63; a triangular filter of radius 2 rows for the bottom table,
 * 1 row for the top table, clamped at the floor so no zero leaks upward). The bottom image is a 15-colour palette, so its columns rise in flat
 * steps of about 0.07; a level set through the raw steps drew every step as a terrace (horizontal stripes along every flank). The filter keeps
 * the shapes: bottom type 0 still reaches 0.75 within 0.1 of the floor, type 1 still takes half the column.
 */
export function profileTablesSmoothed(): { top: Uint8Array; bottom: Uint8Array } {
  if (!smoothed) {
    const N = PROFILE_TABLE_SIZE, F = Math.round(PROFILE_TABLE_FLOOR * N), raw = profileTables();
    const filter = (src: Uint8Array, k: number) => {
      const out = new Uint8Array(src);
      for (let c = 0; c < N; c++) for (let r = F; r < N; r++) {
        let sum = 0, wsum = 0;
        for (let d = -k; d <= k; d++) {
          const rr = r + d;
          if (rr < F || rr >= N) continue;
          const w = k + 1 - Math.abs(d);
          sum += w * src[rr * N + c]; wsum += w;
        }
        out[r * N + c] = Math.round(sum / wsum);
      }
      return out;
    };
    smoothed = { top: filter(raw.top, 1), bottom: filter(raw.bottom, 2) };
  }
  return smoothed;
}

/** Bilinear read at (type 0..1, table height v 0..1), texel centres at (i + 0.5) / 64 in height and i / 63 in type: the same as the WGSL (sky-layer.wgsl.ts skyLut). */
export function sampleProfileTable(table: Uint8Array, type: number, v: number): number {
  const N = PROFILE_TABLE_SIZE;
  const x = Math.min(Math.max(type, 0), 1) * (N - 1);
  const y = Math.min(Math.max(v * N - 0.5, 0), N - 1);
  const x0 = Math.min(Math.floor(x), N - 2), y0 = Math.min(Math.floor(y), N - 2);
  const fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => table[j * N + i] / 255;
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}

/** Per type column: the table height where the top table ends (the top edge of the last row above 0.05), i.e. the top of a full-mass column. */
export function profileTopEnds(): Float32Array {
  const N = PROFILE_TABLE_SIZE, { top } = profileTablesSmoothed();
  const out = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    let last = 0;
    for (let r = 0; r < N; r++) if (top[r * N + c] > 0.05 * 255) last = r;
    out[c] = (last + 1) / N;
  }
  return out;
}

/** The top type of species row g (0..1), piecewise linear through SPECIES_TOP_TYPES (the WGSL skyTopType mirrors it). */
export function speciesTopType(g: number): number {
  const t = SPECIES_TOP_TYPES, x = Math.min(Math.max(g, 0), 1) * (t.length - 1);
  const i = Math.min(Math.floor(x), t.length - 2);
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}

/**
 * The peak of top * bottom over the column for every (top type, bottom type) pair: 64 x 64 bytes (value * 255), row = bottom type column,
 * column = top type column. The sky layer divides by it so a full-mass column peaks at its mass whatever the types (the threshold then means the
 * same footprint for every type; the raw product still sets how soft the cloud is).
 */
export function profilePeaks(): Uint8Array {
  const N = PROFILE_TABLE_SIZE, { top, bottom } = profileTablesSmoothed();
  const out = new Uint8Array(N * N);
  for (let b = 0; b < N; b++) for (let t = 0; t < N; t++) {
    let m = 0;
    for (let r = 0; r < N; r++) m = Math.max(m, top[r * N + t] * bottom[r * N + b]);
    out[b * N + t] = Math.round(m / 255);
  }
  return out;
}

/** The two (smoothed) tables and the peaks packed 4 bytes per little-endian u32 (top, bottom, peaks): 3072 words, the layout of SkyParams.lut. */
export function packProfileTables(): Uint32Array {
  const { top, bottom } = profileTablesSmoothed();
  const peaks = profilePeaks();
  const bytes = new Uint8Array(top.length + bottom.length + peaks.length);
  bytes.set(top, 0); bytes.set(bottom, top.length); bytes.set(peaks, top.length + bottom.length);
  const out = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = bytes[4 * i] | (bytes[4 * i + 1] << 8) | (bytes[4 * i + 2] << 16) | ((bytes[4 * i + 3] << 24) >>> 0);
  return out;
}
