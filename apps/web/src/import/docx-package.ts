import { Uint8ArrayReader, WARNING_UNSORTED_CENTRAL_DIRECTORY, ZipReader, type Entry } from "@zip.js/zip.js/lib/zip-core-native.js";
import { fail, IngestionError } from "./errors.js";
import type { IngestionLimits } from "./limits.js";

export interface DocxPackage {
  readonly parts: ReadonlyMap<string, Uint8Array>;
  readonly names: ReadonlySet<string>;
}

/** A DOCX is an OOXML package, not a JSON ZIP. No files are written or linked. */
export async function readDocxPackage(bytes: Uint8Array, filename: string, limits: IngestionLimits, signal: AbortSignal): Promise<DocxPackage> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false, useCompressionStream: true, strictness: "strict",
    filenameValidation: "tolerant", checkCrc32: true, checkOverlappingEntry: true,
  });
  const names = new Set<string>();
  const entries: Entry[] = [];
  const parts = new Map<string, Uint8Array>();
  const needed = new Set(["[Content_Types].xml", "word/document.xml", "word/styles.xml"]);
  let declared = 0;
  let total = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      signal.throwIfAborted();
      const name = entry.filename;
      if (entries.length >= limits.docxEntries) fail("document-resource-limit", filename, { limit: limits.docxEntries });
      if (/^[\/\\]|[\\:\u0000-\u001f\u007f]/u.test(name) || name.replace(/\/$/, "").split("/").some((part) => ["", ".", ".."].includes(part)) || names.has(name)) fail("corrupt-docx", filename);
      names.add(name);
      if (/vbaProject\.bin$/i.test(name)) fail("unsupported-document-content", filename);
      if (entry.encrypted || entry.symlink || entry.diskNumberStart !== 0 || ![0, 8].includes(entry.compressionMethod)) fail("corrupt-docx", filename);
      if (![entry.compressedSize, entry.uncompressedSize].every((size) => Number.isSafeInteger(size) && size >= 0) || entry.compressedSize > bytes.byteLength || (entry.directory && entry.uncompressedSize !== 0)) fail("corrupt-docx", filename);
      declared += entry.uncompressedSize;
      if (declared > limits.docxExtractedBytes || entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.compressionRatio || (/\.(xml|rels)$/i.test(name) && entry.uncompressedSize > limits.docxXmlBytes)) fail("document-resource-limit", filename);
      entries.push(entry);
    }
    if (reader.warnings?.some((warning) => warning.reason !== WARNING_UNSORTED_CENTRAL_DIRECTORY)) fail("corrupt-docx", filename);
    for (const entry of entries) {
      signal.throwIfAborted();
      if (entry.directory) continue;
      if (entry.compressionMethod === 8) {
        try { new DecompressionStream("deflate-raw"); }
        catch { fail("document-browser-unsupported", filename); }
      }
      const retain = needed.has(entry.filename);
      const chunks: Uint8Array[] = [];
      let size = 0;
      let sinkFailure: IngestionError | undefined;
      const sink = new WritableStream<Uint8Array>({ write(chunk) {
        try {
          signal.throwIfAborted();
          size += chunk.byteLength;
          total += chunk.byteLength;
          if (total > limits.docxExtractedBytes || size > Math.max(1, entry.compressedSize) * limits.compressionRatio || (/\.(xml|rels)$/i.test(entry.filename) && size > limits.docxXmlBytes)) fail("document-resource-limit", filename);
          if (retain) chunks.push(chunk);
        } catch (error) {
          if (error instanceof IngestionError) sinkFailure ??= error;
          throw error;
        }
      } });
      try { await entry.getData(sink, { signal }); }
      catch (error) { if (sinkFailure !== undefined && !signal.aborted) throw sinkFailure; throw error; }
      if (sinkFailure !== undefined) throw sinkFailure;
      if (size !== entry.uncompressedSize) fail("corrupt-docx", filename);
      if (retain) {
        const content = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
        parts.set(entry.filename, content);
      }
    }
    if (!parts.has("[Content_Types].xml") || !parts.has("word/document.xml")) fail("corrupt-docx", filename);
    return { parts, names };
  } finally { await reader.close(); }
}
