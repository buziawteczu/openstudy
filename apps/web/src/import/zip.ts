import { Uint8ArrayReader, WARNING_UNSORTED_CENTRAL_DIRECTORY, ZipReader, type Entry } from "@zip.js/zip.js/lib/zip-core-native.js";
import { IngestionError, fail } from "./errors.js";
import { inspectJson, type InspectedSource } from "./json.js";
import type { IngestionLimits } from "./limits.js";

function logicalPath(name: string, filename: string): string {
  const slashes = name.replaceAll("\\", "/").normalize("NFC");
  if (slashes.startsWith("/") || /[:\u0000-\u001f\u007f]/u.test(slashes)) {
    fail("unsafe-archive-path", filename, { entry: name });
  }
  const parts = slashes.split("/");
  if (parts.includes("..")) fail("unsafe-archive-path", filename, { entry: name });
  const path = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (path.length === 0) fail("unsafe-archive-path", filename, { entry: name });
  return path;
}

const ARCHIVE_EXTENSION = /\.(zip|zipx|7z|rar|tar|gz|tgz|bz2|tbz2|xz|txz|zst|tzst|jar|apk)$/i;

function archiveMagic(bytes: readonly number[]): boolean {
  return (bytes[0] === 0x50 && bytes[1] === 0x4b && (
    (bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6) || (bytes[2] === 7 && bytes[3] === 8)
  )) || (bytes[0] === 0x1f && bytes[1] === 0x8b)
    || (bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf)
    || (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21);
}

/** Read sequentially into a bounded sink, never trusting declared output sizes. */
export async function inspectZip(bytes: Uint8Array, filename: string, limits: IngestionLimits, signal: AbortSignal): Promise<InspectedSource[]> {
  if (bytes.byteLength > limits.zipBytes) fail("file-too-large", filename, { limit: limits.zipBytes });
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    useCompressionStream: true,
    strictness: "strict",
    // The app applies its own path policy and typed path errors before extraction.
    filenameValidation: "tolerant",
    checkCrc32: true,
    checkOverlappingEntry: true,
  });
  try {
    const entries: { entry: Entry; name: string }[] = [];
    const names = new Set<string>();
    let declaredBytes = 0;
    // The generator avoids materializing unbounded arrays of tiny/empty entries.
    for await (const entry of reader.getEntriesGenerator()) {
      signal.throwIfAborted();
      if (entries.length >= limits.archiveEntries) fail("too-many-archive-entries", filename, { limit: limits.archiveEntries });
      const name = logicalPath(entry.filename, filename);
      if (names.has(name)) fail("duplicate-archive-entry", filename, { entry: name });
      names.add(name);
      if (entry.encrypted || entry.symlink || entry.diskNumberStart !== 0 || ![0, 8].includes(entry.compressionMethod)) {
        fail("unsupported-archive-entry", filename, { entry: name });
      }
      if (![entry.compressedSize, entry.uncompressedSize].every((size) => Number.isSafeInteger(size) && size >= 0) || entry.compressedSize > bytes.byteLength) {
        fail("corrupt-zip", filename, { entry: name });
      }
      if (entry.directory && entry.uncompressedSize !== 0) fail("corrupt-zip", filename, { entry: name });
      if (!entry.directory && ARCHIVE_EXTENSION.test(name)) fail("nested-archive-unsupported", filename, { entry: name });
      if (!entry.directory && /\.json$/i.test(name) && entry.uncompressedSize > limits.jsonBytes) {
        fail("file-too-large", filename, { entry: name, limit: limits.jsonBytes });
      }
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > limits.extractedBytes) fail("extracted-size-limit", filename, { entry: name, limit: limits.extractedBytes });
      if (entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.compressionRatio) {
        fail("compression-ratio-limit", filename, { entry: name, limit: limits.compressionRatio });
      }
      entries.push({ entry, name });
    }
    // Malformed extra fields and other ambiguous metadata are not accepted.
    // A different central-directory order is valid and does not change content.
    if (reader.warnings?.some((warning) => warning.reason !== WARNING_UNSORTED_CENTRAL_DIRECTORY)) {
      fail("corrupt-zip", filename);
    }
    let total = 0;
    const jsonBudget = { nodes: 0 };
    const sources: InspectedSource[] = [];
    for (const { entry, name } of entries) {
      signal.throwIfAborted();
      if (entry.directory) continue;
      if (entry.compressionMethod === 8) {
        try { new DecompressionStream("deflate-raw"); }
        catch { fail("unsupported-browser", filename, { entry: name }); }
      }
      const json = /\.json$/i.test(name);
      const chunks: Uint8Array[] = [];
      const prefix: number[] = [];
      let size = 0;
      const sink = new WritableStream<Uint8Array>({
        write(chunk) {
          signal.throwIfAborted();
          size += chunk.byteLength;
          total += chunk.byteLength;
          if (total > limits.extractedBytes) fail("extracted-size-limit", filename, { entry: name, limit: limits.extractedBytes });
          if (json && size > limits.jsonBytes) fail("file-too-large", filename, { entry: name, limit: limits.jsonBytes });
          if (size > Math.max(1, entry.compressedSize) * limits.compressionRatio) {
            fail("compression-ratio-limit", filename, { entry: name, limit: limits.compressionRatio });
          }
          for (let i = 0; i < chunk.length && prefix.length < 8; i += 1) prefix.push(chunk[i]!);
          if (archiveMagic(prefix)) fail("nested-archive-unsupported", filename, { entry: name });
          // Non-JSON content is verified/counted and discarded, never rendered.
          if (json) chunks.push(chunk);
        },
      });
      try {
        await entry.getData(sink, { signal });
      } catch (error) {
        if (signal.aborted || error instanceof IngestionError) throw error;
        fail("corrupt-zip", filename, { entry: name });
      }
      if (size !== entry.uncompressedSize) fail("corrupt-zip", filename, { entry: name });
      if (json) {
        const content = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
        sources.push(inspectJson(content, filename, `source:${sources.length}`, limits, name, jsonBudget));
      }
    }
    if (sources.length === 0) fail("no-json-files", filename);
    return sources;
  } finally {
    await reader.close();
  }
}
