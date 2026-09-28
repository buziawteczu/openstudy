import type { ImportFailure } from "@openstudy/import-core";

export type IngestionErrorCode =
  | "unsupported-file-type" | "file-too-large" | "read-failure"
  | "malformed-json" | "json-resource-limit" | "corrupt-zip"
  | "too-many-archive-entries" | "extracted-size-limit" | "compression-ratio-limit"
  | "nested-archive-unsupported" | "duplicate-archive-entry" | "unsafe-archive-path"
  | "unsupported-archive-entry" | "unsupported-browser"
  | "no-json-files" | "no-record-collection" | "inspection-failure"
  | "corrupt-docx" | "corrupt-pdf" | "no-extractable-text"
  | "unsupported-encrypted-pdf" | "document-resource-limit"
  | "unsupported-document-content" | "document-browser-unsupported";

export interface IngestionFailure {
  readonly code: IngestionErrorCode;
  readonly filename: string;
  readonly entry?: string;
  readonly limit?: number;
  readonly inspection?: ImportFailure;
}

export type IngestionResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: IngestionFailure };

/** Internal control flow only; expected public failures are discriminated results. */
export class IngestionError extends Error {
  constructor(readonly failure: IngestionFailure) {
    super(failure.code);
  }
}

export function fail(code: IngestionErrorCode, filename: string, context: Omit<IngestionFailure, "code" | "filename"> = {}): never {
  throw new IngestionError({ code, filename, ...context });
}

export function ingestionErrorMessage(error: IngestionFailure): string {
  switch (error.code) {
    case "unsupported-file-type": return "Choose a DOCX, PDF with selectable text, JSON, or ZIP containing JSON files.";
    case "file-too-large": return "This file is larger than OpenStudy currently supports.";
    case "read-failure": return "This file could not be read. Please choose it again.";
    case "malformed-json": return `${error.entry ?? error.filename} is not valid UTF-8 JSON.`;
    case "json-resource-limit": return "This JSON is too complex to inspect safely. Try a smaller or less deeply nested file.";
    case "corrupt-zip": return "This ZIP could not be read safely. It may be damaged.";
    case "too-many-archive-entries": return "This ZIP contains too many entries.";
    case "extracted-size-limit": return "The contents of this ZIP are larger than OpenStudy currently supports.";
    case "compression-ratio-limit": return "This ZIP expands too much to inspect safely. Try an uncompressed ZIP.";
    case "nested-archive-unsupported": return "Archives inside a ZIP are not supported. Choose the JSON files directly.";
    case "duplicate-archive-entry": return "This ZIP contains duplicate entry names. Give each entry a unique name.";
    case "unsafe-archive-path": return "This ZIP contains an unsafe entry path.";
    case "unsupported-archive-entry": return "This ZIP uses unsupported entries, encryption, or compression. Use a regular unencrypted ZIP.";
    case "unsupported-browser": return "This browser cannot extract ZIP files. Try a recent browser or choose a JSON file.";
    case "no-json-files": return "This archive does not contain any JSON files.";
    case "no-record-collection": return `${error.entry ?? error.filename} contains no supported record collections. Use arrays of objects.`;
    case "inspection-failure": return "This source could not be inspected as structured records.";
    case "corrupt-docx": return "This DOCX file could not be read. It may be damaged or use an unsupported document structure.";
    case "corrupt-pdf": return "This PDF file could not be read. It may be damaged.";
    case "no-extractable-text": return "We couldn't find enough selectable text in this PDF. Scanned PDFs aren't supported yet.";
    case "unsupported-encrypted-pdf": return "This PDF is password-protected or encrypted and can't be opened here.";
    case "document-resource-limit": return "This document is too large or complex to extract safely. Try a smaller document.";
    case "unsupported-document-content": return "This DOCX contains macros or unsupported active content. Save it as a regular DOCX without macros.";
    case "document-browser-unsupported": return "This browser cannot extract this document. Try a recent browser.";
  }
}
