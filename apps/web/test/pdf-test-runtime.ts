import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-expect-error The worker distribution has no public declaration file.
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// jsdom has no Worker. Use the real PDF.js parser on its supported in-process
// test transport; E2E exercises the production inline-worker wiring.
Object.defineProperty(globalThis, "pdfjsWorker", { value: { WorkerMessageHandler }, configurable: true });
class NoExternalData {
  async fetch(): Promise<never> { throw new Error("External PDF resources are disabled"); }
}
export function openPdf(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0, disableFontFace: true, useSystemFonts: true, useWorkerFetch: false, useWasm: false, stopAtErrors: true, enableXfa: false, BinaryDataFactory: NoExternalData });
  let cleanup: Promise<void> | undefined;
  return { task, destroy: () => cleanup ??= task.destroy() };
}
