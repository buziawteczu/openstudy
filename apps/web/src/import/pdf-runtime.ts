import { getDocument, PDFWorker, type PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import InlinePdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?worker&inline";
import { fail } from "./errors.js";

/** No CMap/font/WASM URL can cause a request, even for an unusual font. */
class NoExternalData {
  async fetch(): Promise<never> { throw new Error("External PDF resources are disabled"); }
}

export function openPdf(bytes: Uint8Array, filename: string): { task: PDFDocumentLoadingTask; destroy: () => Promise<void> } {
  if (typeof Worker === "undefined") fail("document-browser-unsupported", filename);
  let thread: Worker;
  try { thread = new InlinePdfWorker(); }
  catch { fail("document-browser-unsupported", filename); }
  const worker = PDFWorker.create({ port: thread, verbosity: 0 });
  try {
    const task = getDocument({
      // Transfer a private copy, never detach the caller's buffer.
      data: new Uint8Array(bytes), worker, verbosity: 0,
      BinaryDataFactory: NoExternalData, useWorkerFetch: false, useWasm: false,
      disableFontFace: true, useSystemFonts: true, enableXfa: false,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      maxImageSize: 0, stopAtErrors: true,
      disableAutoFetch: true, disableRange: true, disableStream: true,
    });
    let cleanup: Promise<void> | undefined;
    return { task, destroy: () => cleanup ??= (async () => {
      try { await task.destroy(); }
      finally { worker.destroy(); thread.terminate(); }
    })() };
  } catch (error) { worker.destroy(); thread.terminate(); throw error; }
}
