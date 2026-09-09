export interface IfcByteSource {
  file?: File | null;
  bytes?: ArrayBuffer | null;
  text?: string;
}

/** Shared by the fragment worker and its main-thread fallback. */
export async function readIfcBytes(source: IfcByteSource): Promise<Uint8Array> {
  if (source.file) return new Uint8Array(await source.file.arrayBuffer());
  if (source.bytes) return new Uint8Array(source.bytes);
  return new TextEncoder().encode(source.text ?? "");
}

export function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
