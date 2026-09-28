import type { ExtractedDocument, PageTextBlock, SourceDocument } from "@openstudy/import-core";
import type { TextContent } from "pdfjs-dist/types/src/display/api.js";
import { fail } from "./errors.js";
import type { IngestionLimits } from "./limits.js";
import { openPdf } from "./pdf-runtime.js";

/** Text only: do not render pages, annotations, actions, forms or attachments. */
export async function extractPdf(bytes: Uint8Array, sourceDocument: SourceDocument, limits: IngestionLimits, signal: AbortSignal): Promise<ExtractedDocument> {
  const filename = sourceDocument.source.originalFilename ?? "document.pdf";
  signal.throwIfAborted();
  if (bytes.byteLength > limits.pdfBytes) fail("file-too-large", filename, { limit: limits.pdfBytes });
  const handle = openPdf(bytes, filename);
  const abort = () => { void handle.destroy().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    let encrypted = false;
    handle.task.onPassword = () => { encrypted = true; abort(); };
    const pdf = await handle.task.promise.catch((error: unknown) => {
      if (encrypted && !signal.aborted) fail("unsupported-encrypted-pdf", filename);
      throw error;
    });
    signal.throwIfAborted();
    // Also reject encryption that opens with an empty user password.
    const permissions = await pdf.getPermissions();
    signal.throwIfAborted();
    if (permissions !== null) fail("unsupported-encrypted-pdf", filename);
    if (pdf.numPages > limits.pdfPages || pdf.numPages > limits.documentBlocks) fail("document-resource-limit", filename, { limit: Math.min(limits.pdfPages, limits.documentBlocks) });
    const blocks: PageTextBlock[] = [];
    let itemCount = 0;
    let characters = 0;
    let selectableCharacters = 0;
    let emptyPages = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      signal.throwIfAborted();
      const stream = page.streamTextContent({ disableNormalization: true }).getReader();
      const items: PageTextBlock["items"][number][] = [];
      let pageHasText = false;
      let complete = false;
      try {
        while (true) {
          signal.throwIfAborted();
          const chunk = await stream.read() as ReadableStreamReadResult<TextContent>;
          signal.throwIfAborted();
          if (chunk.done) { complete = true; break; }
          for (const item of chunk.value.items) {
            if (!("str" in item)) continue;
            characters += item.str.length;
            itemCount += 1;
            if (itemCount > limits.pdfItems || characters > limits.documentCharacters) fail("document-resource-limit", filename);
            if (![item.width, item.height, ...item.transform].every(Number.isFinite)) fail("corrupt-pdf", filename);
            pageHasText ||= /\S/u.test(item.str);
            selectableCharacters += item.str.replace(/\s/gu, "").length;
            const locator = `page:${pageNumber}/item:${items.length}`;
            items.push({ key: locator, locator, text: item.str, direction: item.dir, transform: [...item.transform], width: item.width, height: item.height, hasLineBreak: item.hasEOL });
          }
        }
      } finally {
        try {
          // PDF.js requires an Error cancellation reason. Cleanup must never
          // obscure a parser/budget error, including during an aborted worker.
          if (!complete && !signal.aborted) await stream.cancel(new Error("PDF extraction stopped")).catch(() => {});
        } finally { stream.releaseLock(); page.cleanup(); }
      }
      if (!pageHasText) emptyPages += 1;
      const viewport = page.getViewport({ scale: 1 });
      blocks.push({ kind: "page-text", key: `page:${pageNumber}`, locator: `page:${pageNumber}`, pageNumber, width: viewport.width, height: viewport.height, items });
    }
    if (selectableCharacters < limits.pdfMinimumTextCharacters || selectableCharacters === 0) fail("no-extractable-text", filename);
    return {
      kind: "extracted-document", sourceDocument, blocks, hasEmbeddedMedia: "unknown",
      warnings: ["pdf-reading-order", "pdf-media-not-extracted", ...(emptyPages > 0 ? ["pages-without-text" as const] : [])],
    };
  } finally {
    signal.removeEventListener("abort", abort);
    // Cleanup must not replace the original policy/parser failure.
    await handle.destroy().catch(() => {});
  }
}
