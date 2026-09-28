import { IngestionError, fail, type IngestionResult } from "./errors.js";
import { inspectJson, type InspectedSource } from "./json.js";
import { INGESTION_LIMITS, type IngestionLimits } from "./limits.js";
import { inspectZip } from "./zip.js";
import { normalizeDocument, summarizeDocument, type DocumentSummary, type ExtractedDocument, type NormalizedDocument, type SourceDocument } from "@openstudy/import-core";
import { extractDocx } from "./docx.js";
import { extractPdf } from "./pdf.js";

export interface StructuredIngestionSummary {
  readonly kind: "structured";
  readonly filename: string;
  readonly sources: readonly InspectedSource[];
  readonly collectionCount: number;
  readonly recordCount: number;
}

export interface DocumentIngestionSummary {
  readonly kind: "document";
  readonly filename: string;
  readonly sourceDocument: SourceDocument;
  readonly extracted: ExtractedDocument;
  readonly document: NormalizedDocument;
  readonly counts: DocumentSummary;
}

export type IngestionSummary = StructuredIngestionSummary | DocumentIngestionSummary;

function readFile(file: File, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(signal.reason); };
    reader.onload = () => { signal.removeEventListener("abort", abort); resolve(new Uint8Array(reader.result as ArrayBuffer)); };
    reader.onerror = () => { signal.removeEventListener("abort", abort); reject(new IngestionError({ code: "read-failure", filename: file.name })); };
    signal.addEventListener("abort", abort, { once: true });
    reader.readAsArrayBuffer(file);
  });
}

/** Local, in-memory structured inspection or document extraction. */
export async function ingestFile(file: File, limits: IngestionLimits = INGESTION_LIMITS, signal: AbortSignal = new AbortController().signal): Promise<IngestionResult<IngestionSummary>> {
  let stage: "reading" | "json" | "zip" | "docx" | "pdf" = "reading";
  try {
    signal.throwIfAborted();
    const extension = file.name.match(/\.(json|zip|docx|pdf)$/i)?.[1]?.toLowerCase();
    if (extension !== "json" && extension !== "zip" && extension !== "docx" && extension !== "pdf") fail("unsupported-file-type", file.name);
    const limit = extension === "json" ? limits.jsonBytes : extension === "zip" ? limits.zipBytes : extension === "docx" ? limits.docxBytes : limits.pdfBytes;
    if (file.size > limit) fail("file-too-large", file.name, { limit });
    const bytes = await readFile(file, signal);
    signal.throwIfAborted();
    stage = extension;
    if (extension === "docx" || extension === "pdf") {
      const sourceDocument: SourceDocument = {
        kind: "document-source", format: extension, byteLength: bytes.byteLength,
        source: { key: "source:0", originalFilename: file.name, format: extension },
      };
      const extracted = extension === "docx"
        ? await extractDocx(bytes, sourceDocument, limits, signal)
        : await extractPdf(bytes, sourceDocument, limits, signal);
      signal.throwIfAborted();
      const document = normalizeDocument(extracted);
      return { success: true, value: { kind: "document", filename: file.name, sourceDocument, extracted, document, counts: summarizeDocument(document) } };
    }
    const sources = extension === "json"
      ? [inspectJson(bytes, file.name, "source:0", limits)]
      : await inspectZip(bytes, file.name, limits, signal);
    return {
      success: true,
      value: {
        kind: "structured",
        filename: file.name,
        sources,
        collectionCount: sources.reduce((sum, source) => sum + source.inspection.collections.length, 0),
        recordCount: sources.reduce((sum, source) => sum + source.inspection.collections.reduce((count, collection) => count + collection.recordCount, 0), 0),
      },
    };
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof IngestionError) return { success: false, error: error.failure };
    return { success: false, error: { code: stage === "reading" ? "read-failure" : stage === "zip" ? "corrupt-zip" : stage === "docx" ? "corrupt-docx" : stage === "pdf" ? "corrupt-pdf" : "inspection-failure", filename: file.name } };
  }
}
