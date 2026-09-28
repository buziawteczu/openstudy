import { describe, expect, it, vi } from "vitest";
import { ingestFile } from "../src/import/ingest-file.js";
import { extractDocx } from "../src/import/docx.js";
import { extractPdf } from "../src/import/pdf.js";
import { INGESTION_LIMITS } from "../src/import/limits.js";
import { docxFixture, encryptedPdfFixture, paragraphXml, pdfFixture, WORD_NS } from "./document-fixtures.js";
import { patchEntrySize, zipFixture } from "./zip-fixture.js";
import type { SourceDocument } from "@openstudy/import-core";
import { ZipReader, type Entry } from "@zip.js/zip.js/lib/zip-core-native.js";
import * as pdfRuntime from "../src/import/pdf-runtime.js";

// Replace only browser Worker wiring in jsdom. PDF.js itself performs every
// parse/text extraction; real inline Worker + offline behavior is covered in E2E.
vi.mock("../src/import/pdf-runtime.js", () => import("./pdf-test-runtime.js"));

const source = (format: "docx" | "pdf"): SourceDocument => ({ kind: "document-source", source: { key: "source:0", originalFilename: `material.${format}` }, format, byteLength: 100 });
async function documentResult(bytes: Uint8Array<ArrayBuffer>, filename: string) {
  const result = await ingestFile(new File([bytes], filename));
  expect(result.success).toBe(true);
  if (!result.success || result.value.kind !== "document") throw new Error(JSON.stringify(result));
  return result.value;
}
async function expectCode(bytes: Uint8Array<ArrayBuffer>, filename: string, code: string, overrides: Record<string, number> = {}) {
  expect(await ingestFile(new File([bytes], filename), { ...INGESTION_LIMITS, ...overrides })).toMatchObject({ success: false, error: { code, filename } });
}

describe("local DOCX extraction", () => {
  it("preserves ordered paragraphs, headings, list roles and table cells without question interpretation", async () => {
    const result = await documentResult(await docxFixture(), "exam.docx");
    expect(result.document.blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list-item", "table"]);
    expect(result.counts).toEqual({ paragraphs: 5, headings: 1, listItems: 1, tables: 1, pages: 0, pagesWithoutText: 0 });
    expect(result.document.blocks[0]).toMatchObject({ headingLevel: 1, style: "Heading1", runs: [{ text: "Railway safety", bold: true }] });
    expect(result.document.blocks[2]).toMatchObject({ list: { key: "list:7", level: 1 }, runs: [{ text: "B. Red" }] });
    const table = result.document.blocks[3]!;
    expect(table.kind).toBe("table");
    if (table.kind === "table") {
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]!.cells).toHaveLength(2);
      expect(table.rows[1]!.cells[1]!.blocks[0]).toMatchObject({ runs: [{ text: "Stop" }] });
    }
    expect(result.document).not.toHaveProperty("questions");
    expect(result.document).not.toHaveProperty("schemaVersion");
    expect(result.sourceDocument.source.key).toBe("source:0");
  });
  it("retains runs, meaningful whitespace, tabs, breaks, bold, italic and underline", async () => {
    const result = await documentResult(await docxFixture(), "exam.docx");
    expect(result.document.blocks[1]).toMatchObject({ runs: [
      { text: "Which signal means stop? " }, { text: "Red", bold: true, italic: true, underline: true }, { text: "\t\nA. Green" },
    ] });
  });
  it.each([false, true])("accepts Strict OOXML with the regular DOCX main-part content type (compressed=%s)", async (compressed) => {
    const transitional = await documentResult(await docxFixture(undefined, [], compressed), "exam.docx");
    const strict = await documentResult(await docxFixture(undefined, [], compressed, undefined, { strict: true }), "exam.docx");
    expect(strict.extracted.blocks).toEqual(transitional.extracted.blocks);
    expect(strict.document.blocks).toEqual(transitional.document.blocks);
    expect(strict.document.warnings).toEqual(transitional.document.warnings);
    expect(strict.counts).toEqual(transitional.counts);
  });
  it.each([
    "application/vnd.ms-word.document.main+xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
    "application/xml",
  ])("rejects an unsupported main-part content type even with Strict namespaces: %s", async (mainContentType) => {
    await expectCode(await docxFixture(undefined, [], false, undefined, { strict: true, mainContentType }), "invalid.docx", "corrupt-docx");
  });
  it("rejects a macro-enabled main-part content type even with Strict namespaces", async () => {
    await expectCode(await docxFixture(undefined, [], false, undefined, {
      strict: true, mainContentType: "application/vnd.ms-word.document.macroEnabled.main+xml",
    }), "macro.docx", "unsupported-document-content");
  });
  it("retains merged-cell metadata and nested tables", async () => {
    const body = `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr>${paragraphXml("Cell")}<w:tbl><w:tr><w:tc>${paragraphXml("Nested")}</w:tc></w:tr></w:tbl></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>${paragraphXml("")}</w:tc></w:tr></w:tbl>`;
    const result = await documentResult(await docxFixture(body), "table.docx");
    const table = result.document.blocks[0]!;
    if (table.kind !== "table") throw new Error("Expected table");
    expect(table.rows[0]!.cells[0]).toMatchObject({ columnSpan: 2, verticalMerge: "start", blocks: [{ kind: "paragraph" }, { kind: "table" }] });
    expect(table.rows[1]!.cells[0]!.verticalMerge).toBe("continue");
    expect(result.counts.tables).toBe(2);
  });
  it("keeps source-local block/run identity deterministic and serializable", async () => {
    const bytes = await docxFixture();
    const first = await documentResult(bytes, "exam.docx");
    expect(first).toEqual(await documentResult(bytes, "exam.docx"));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(new Set(first.document.blocks.map((block) => block.key)).size).toBe(4);
    expect(first.document.blocks[0]!.locator).toContain("word/document.xml#");
    expect(first.extracted.blocks).not.toBe(first.document.blocks);
  });
  it("supports DEFLATE OOXML packages", async () => {
    expect((await documentResult(await docxFixture(undefined, [], true), "exam.DOCX")).counts.tables).toBe(1);
  });
  it("does not mutate or detach caller-owned bytes", async () => {
    const bytes = await docxFixture();
    const before = new Uint8Array(bytes);
    await extractDocx(bytes, source("docx"), INGESTION_LIMITS, new AbortController().signal);
    expect(bytes.byteLength).toBe(before.byteLength);
    expect(Array.from(bytes)).toEqual(Array.from(before));
  });
  it("reports media/omitted sections and preserves hyperlink text without loading resources", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      const bytes = await docxFixture('<w:p><w:hyperlink r:id="external"><w:r><w:t>External link text</w:t></w:r></w:hyperlink><w:r><w:drawing/></w:r></w:p><w:altChunk r:id="html"/>', [
        ["word/media/image.png", new Uint8Array([1, 2])], ["word/header1.xml", paragraphXml("Header")],
        ["word/_rels/document.xml.rels", '<Relationships><Relationship Id="external" Target="https://example.invalid/remote.png" TargetMode="External"/></Relationships>'],
      ]);
      const result = await documentResult(bytes, "linked.docx");
      expect(result.document.hasEmbeddedMedia).toBe(true);
      expect(result.document.warnings).toEqual(expect.arrayContaining(["omitted-docx-parts", "unsupported-content"]));
      expect(result.document.blocks[0]).toMatchObject({ runs: [{ text: "External link text" }, { text: "", media: true }] });
      expect(result.document.blocks[1]).toMatchObject({ kind: "unsupported" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it("preserves tracked run wording and revision markers rather than accepting changes", async () => {
    const result = await documentResult(await docxFixture('<w:p><w:ins><w:r><w:t>Added</w:t></w:r></w:ins><w:del><w:r><w:delText>Removed</w:delText></w:r></w:del></w:p>'), "changes.docx");
    expect(result.document.blocks[0]).toMatchObject({ runs: [{ text: "Added", revision: "inserted" }, { text: "Removed", revision: "deleted" }] });
  });
  it("keeps explicit formatting-off overrides", async () => {
    const result = await documentResult(await docxFixture('<w:p><w:pPr><w:pStyle w:val="Base"/></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Not bold</w:t></w:r></w:p>'), "format.docx");
    expect(result.document.blocks[0]).toMatchObject({ runs: [{ text: "Not bold", bold: false }] });
  });
  it("rejects malformed ZIP and renamed non-DOCX archives", async () => {
    await expectCode(new TextEncoder().encode("broken"), "broken.docx", "corrupt-docx");
    await expectCode(await zipFixture([["a.json", "[]"]]), "renamed.docx", "corrupt-docx");
  });
  it("rejects malformed document XML", async () => { await expectCode(await docxFixture("<w:p>"), "broken.docx", "corrupt-docx"); });
  it("rejects DTD/entity declarations before XML parsing", async () => {
    await expectCode(await docxFixture('<!DOCTYPE x [<!ENTITY external SYSTEM "https://example.invalid">]><w:p><w:r><w:t>&external;</w:t></w:r></w:p>'), "entities.docx", "corrupt-docx");
  });
  it("rejects macro-bearing DOCX packages", async () => {
    await expectCode(await docxFixture(undefined, [["word/vbaProject.bin", "macro"]]), "macro.docx", "unsupported-document-content");
  });
  it("rejects duplicate parts and unsafe package paths", async () => {
    const bytes = await docxFixture(undefined, [["word/duplicat.xml", "duplicate"]]);
    const oldName = new TextEncoder().encode("word/duplicat.xml");
    const newName = new TextEncoder().encode("word/document.xml");
    for (let index = 0; index <= bytes.length - oldName.length; index += 1) {
      if (oldName.every((byte, offset) => bytes[index + offset] === byte)) bytes.set(newName, index);
    }
    await expectCode(bytes, "duplicate.docx", "corrupt-docx");
    await expectCode(await docxFixture(undefined, [["../escape.xml", "unsafe"]]), "unsafe.docx", "corrupt-docx");
  });
  it("rejects oversized files before FileReader", async () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    try { await expectCode(await docxFixture(), "large.docx", "file-too-large", { docxBytes: 2 }); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); }
  });
  it.each([
    { docxEntries: 2 }, { docxExtractedBytes: 8 }, { docxXmlBytes: 8 }, { documentNodes: 8 },
    { documentDepth: 2 }, { documentBlocks: 2 }, { documentCharacters: 2 }, { compressionRatio: 0.5 },
  ])("enforces tunable document budgets %j", async (overrides) => { await expectCode(await docxFixture(), "budget.docx", "document-resource-limit", overrides); });
  it("rejects underreported archive sizes", async () => {
    await expectCode(patchEntrySize(await docxFixture(), 1), "metadata.docx", "corrupt-docx");
  });
  it("rejects cyclic style inheritance", async () => {
    const styleXml = `<w:styles xmlns:w="${WORD_NS}"><w:style w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:styleId="B"><w:basedOn w:val="A"/></w:style></w:styles>`;
    await expectCode(await docxFixture('<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr></w:p>', [], false, styleXml), "cycle.docx", "corrupt-docx");
  });
  it.each(["replaces", "swallows"])("keeps actual DOCX output budgets when cleanup %s the sink failure", async (cleanup) => {
    const entry = {
      filename: "word/document.xml", directory: false, encrypted: false, symlink: false,
      diskNumberStart: 0, compressionMethod: 0, compressedSize: 1, uncompressedSize: 1,
      getData: async (sink: WritableStream<Uint8Array>) => {
        const writer = sink.getWriter();
        try {
          try { await writer.write(new Uint8Array(16)); }
          catch { if (cleanup === "replaces") throw new TypeError("WritableStream is closed"); }
        } finally { writer.releaseLock(); }
      },
    } as unknown as Entry;
    const spy = vi.spyOn(ZipReader.prototype, "getEntriesGenerator").mockImplementation(async function* () { yield entry; return true; });
    try { await expectCode(new Uint8Array(1), "cleanup.docx", "document-resource-limit", { docxExtractedBytes: 8 }); }
    finally { spy.mockRestore(); }
  });
  it("reports unavailable native DOCX decompression without a download fallback", async () => {
    const bytes = await docxFixture(undefined, [], true);
    vi.stubGlobal("DecompressionStream", undefined);
    try { await expectCode(bytes, "compressed.docx", "document-browser-unsupported"); }
    finally { vi.unstubAllGlobals(); }
  });
  it("does not add legacy DOC support even with a misleading MIME type", async () => {
    const result = await ingestFile(new File([await docxFixture()], "legacy.doc", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    expect(result).toMatchObject({ success: false, error: { code: "unsupported-file-type" } });
  });
});

describe("local PDF extraction", () => {
  it("preserves pages, text-item order, coordinates and local locators", async () => {
    const result = await documentResult(pdfFixture([["Safety principles", "Second line"], ["Revision notes"]]), "notes.pdf");
    expect(result.counts.pages).toBe(2);
    expect(result.document.blocks.map((block) => block.kind)).toEqual(["page-text", "page-text"]);
    const page = result.document.blocks[0]!;
    if (page.kind !== "page-text") throw new Error("Expected page");
    expect(page.pageNumber).toBe(1);
    expect(page.items.filter((item) => /\S/.test(item.text)).map((item) => item.text)).toEqual(["Safety principles", "Second line"]);
    expect(page.items[0]).toMatchObject({ transform: [12, 0, 0, 12, 40, 750], locator: "page:1/item:0" });
    expect(result.document.hasEmbeddedMedia).toBe("unknown");
    expect(result.document).not.toHaveProperty("questions");
  });
  it("preserves blank pages in mixed PDFs and surfaces their absence of text", async () => {
    const result = await documentResult(pdfFixture([["Useful selectable text"], []]), "mixed.pdf");
    expect(result.counts).toMatchObject({ pages: 2, pagesWithoutText: 1 });
    expect(result.document.warnings).toContain("pages-without-text");
  });
  it("is deterministic and preserves caller-owned bytes", async () => {
    const bytes = pdfFixture();
    const before = new Uint8Array(bytes);
    const first = await extractPdf(bytes, source("pdf"), INGESTION_LIMITS, new AbortController().signal);
    expect(first).toEqual(await extractPdf(bytes, source("pdf"), INGESTION_LIMITS, new AbortController().signal));
    expect(bytes.byteLength).toBe(before.byteLength);
    expect(Array.from(bytes)).toEqual(Array.from(before));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
  it.each([false, true])("rejects no-text PDFs (image-only: %s) without pretending extraction succeeded", async (imageOnly) => { await expectCode(pdfFixture([[]], imageOnly), "scan.pdf", "no-extractable-text"); });
  it("rejects sparse selectable text rather than treating a tiny scan label as usable content", async () => {
    await expectCode(pdfFixture([["  Page 1  "]]), "sparse.pdf", "no-extractable-text");
  });
  it("makes the sparse-text threshold tunable without changing extracted wording", async () => {
    const result = await ingestFile(new File([pdfFixture([["A"]])], "tiny.pdf"), { ...INGESTION_LIMITS, pdfMinimumTextCharacters: 1 });
    expect(result).toMatchObject({ success: true, value: { document: { blocks: [{ items: [{ text: "A" }] }] } } });
  });
  it("rejects malformed PDF with a document-specific error", async () => { await expectCode(new TextEncoder().encode("%PDF-1.4\ninvalid"), "broken.pdf", "corrupt-pdf"); });
  it.each(["secret", ""])("rejects encrypted PDFs with user password %j", async (password) => { await expectCode(encryptedPdfFixture(password), "encrypted.pdf", "unsupported-encrypted-pdf"); });
  it("rejects oversized PDFs before reading", async () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    try { await expectCode(pdfFixture(), "large.pdf", "file-too-large", { pdfBytes: 2 }); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); }
  });
  it.each([{ pdfPages: 1 }, { pdfItems: 1 }, { documentCharacters: 2 }, { documentBlocks: 1 }])("enforces PDF budgets %j", async (overrides) => { await expectCode(pdfFixture(), "budget.pdf", "document-resource-limit", overrides); });
  it("does not execute embedded PDF scripts or fetch linked content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      await documentResult(pdfFixture(), "script.pdf");
      expect(Reflect.get(globalThis, "documentScriptExecuted")).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it("supports uppercase PDF extensions without trusting MIME", async () => { expect((await documentResult(pdfFixture(), "notes.PDF")).sourceDocument.format).toBe("pdf"); });
  it("honors cancellation rather than returning a stale error", async () => {
    const request = new AbortController();
    request.abort();
    await expect(ingestFile(new File([pdfFixture()], "cancel.pdf"), undefined, request.signal)).rejects.toThrow();
  });
  it("destroys an active PDF task and rejects cancellation without a stale success", async () => {
    const request = new AbortController();
    const original = pdfRuntime.openPdf;
    const destroyed = vi.fn();
    const spy = vi.spyOn(pdfRuntime, "openPdf").mockImplementation((bytes, filename) => {
      const handle = original(bytes, filename);
      void handle.task.promise.then(() => { request.abort(); }, () => {});
      return { task: handle.task, destroy: async () => { destroyed(); await handle.destroy(); } };
    });
    try {
      await expect(extractPdf(pdfFixture(), source("pdf"), INGESTION_LIMITS, request.signal)).rejects.toThrow();
      expect(destroyed).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
