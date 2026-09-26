import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";

/** Small deterministic archives generated in tests, never checked-in binaries. */
export async function zipFixture(entries: readonly (readonly [string, string | Uint8Array])[], compressed = false): Promise<Uint8Array<ArrayBuffer>> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, useCompressionStream: true });
  for (const [name, data] of entries) {
    await writer.add(name, typeof data === "string" ? new TextReader(data) : new Uint8ArrayReader(data), {
      directory: name.endsWith("/"),
      level: compressed ? 6 : 0,
      lastModDate: new Date("2020-01-01T00:00:00Z"),
      extendedTimestamp: false,
      zip64: false,
      dataDescriptor: false,
    });
  }
  return await writer.close() as Uint8Array<ArrayBuffer>;
}

/** Edit both local and central metadata, retaining deliberately false agreement. */
export function patchEntrySize(bytes: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  view.setUint32(22, size, true);
  for (let index = 0; index < copy.length - 46; index += 1) {
    if (view.getUint32(index, true) === 0x02014b50) { view.setUint32(index + 24, size, true); break; }
  }
  return copy;
}
