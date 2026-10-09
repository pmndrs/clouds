// The ZIP codec of NanoVDBFile is not used by the converter (we write and read codec NONE only).
export function unzlibSync(): never {
  throw new Error("webvdb bundle: ZIP-compressed .nvdb is not supported here (codec NONE only)");
}
