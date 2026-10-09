// Vendored subset of WebVDB vdb-web-tools/src/nanovdb (P13-H3): the dense builder, the Fp8 quantizer and the .nvdb writer, for exportFineNvdb.
export { buildFromDense, buildFromDenseDetailed, buildFromLeavesDetailed } from "./serialize.js";
export type { BuildFromDenseOptions, BuildFromLeavesOptions, BuiltGrid } from "./serialize.js";
export { writeNvdb } from "./write-nvdb.js";
export { quantize, quantizeDetailed } from "./quantize.js";
export type { QuantizeMode } from "./quantize.js";
