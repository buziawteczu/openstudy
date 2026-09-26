import { IngestionError, fail, type IngestionResult } from "./errors.js";
import { inspectJson, type InspectedSource } from "./json.js";
import { INGESTION_LIMITS, type IngestionLimits } from "./limits.js";
import { inspectZip } from "./zip.js";

export interface IngestionSummary {
  readonly filename: string;
  readonly sources: readonly InspectedSource[];
  readonly collectionCount: number;
  readonly recordCount: number;
}

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

/** Only FileReader and local ZIP/JSON processing. Nothing uploads or persists. */
export async function ingestFile(file: File, limits: IngestionLimits = INGESTION_LIMITS, signal: AbortSignal = new AbortController().signal): Promise<IngestionResult<IngestionSummary>> {
  let stage: "reading" | "json" | "zip" = "reading";
  try {
    signal.throwIfAborted();
    const extension = file.name.match(/\.(json|zip)$/i)?.[1]?.toLowerCase();
    if (extension !== "json" && extension !== "zip") fail("unsupported-file-type", file.name);
    const limit = extension === "json" ? limits.jsonBytes : limits.zipBytes;
    if (file.size > limit) fail("file-too-large", file.name, { limit });
    const bytes = await readFile(file, signal);
    signal.throwIfAborted();
    stage = extension;
    const sources = extension === "json"
      ? [inspectJson(bytes, file.name, "source:0", limits)]
      : await inspectZip(bytes, file.name, limits, signal);
    return {
      success: true,
      value: {
        filename: file.name,
        sources,
        collectionCount: sources.reduce((sum, source) => sum + source.inspection.collections.length, 0),
        recordCount: sources.reduce((sum, source) => sum + source.inspection.collections.reduce((count, collection) => count + collection.recordCount, 0), 0),
      },
    };
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof IngestionError) return { success: false, error: error.failure };
    return { success: false, error: { code: stage === "reading" ? "read-failure" : stage === "zip" ? "corrupt-zip" : "inspection-failure", filename: file.name } };
  }
}
