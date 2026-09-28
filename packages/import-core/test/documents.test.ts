import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDocument, summarizeDocument, type ExtractedDocument } from "../src/index.js";

const fixture: ExtractedDocument = {
  kind: "extracted-document",
  sourceDocument: { kind: "document-source", source: { key: "source:0", originalFilename: "material.docx" }, format: "docx", byteLength: 100 },
  hasEmbeddedMedia: true, warnings: ["limited-docx-styles"],
  blocks: [
    { kind: "heading", key: "b:0", locator: "/p[0]", headingLevel: 1, runs: [{ key: "r:0", text: "Which?\r\n", bold: true }] },
    { kind: "list-item", key: "b:1", locator: "/p[1]", list: { key: "list:7", level: 1 }, runs: [{ key: "r:1", text: "  A. answer\r", italic: true, underline: true, revision: "inserted" }] },
    { kind: "table", key: "b:2", locator: "/table[0]", rows: [{ key: "row:0", locator: "/table/row[0]", cells: [{ key: "cell:0", locator: "/table/row/cell[0]", columnSpan: 2, verticalMerge: "start", blocks: [{ kind: "paragraph", key: "b:3", locator: "/table/p[0]", runs: [{ key: "r:2", text: "Cell\r\nline" }] }] }] }] },
  ],
};

test("normalizes only line endings, retaining wording, spaces, runs and formatting", () => {
  const normalized = normalizeDocument(fixture);
  assert.equal(normalized.kind, "normalized-document");
  const list = normalized.blocks[1]!;
  assert.equal(list.kind, "list-item");
  if (list.kind === "list-item") assert.deepEqual(list.runs, [{ key: "r:1", text: "  A. answer\n", italic: true, underline: true, revision: "inserted" }]);
  assert.equal(JSON.stringify(fixture).includes("\\r"), true);
});
test("retains temporary identity, order and nested table cells", () => {
  const normalized = normalizeDocument(fixture);
  assert.deepEqual(normalized.blocks.map((block) => block.key), ["b:0", "b:1", "b:2"]);
  const table = normalized.blocks[2]!;
  assert.equal(table.kind, "table");
  if (table.kind === "table") {
    assert.equal(table.rows[0]!.cells[0]!.columnSpan, 2);
    assert.equal(table.rows[0]!.cells[0]!.verticalMerge, "start");
    assert.equal(table.rows[0]!.cells[0]!.blocks[0]!.locator, "/table/p[0]");
  }
});
test("takes a detached snapshot without mutating caller-owned input", () => {
  const input = structuredClone(fixture);
  const before = structuredClone(input);
  const normalized = normalizeDocument(input);
  assert.deepEqual(input, before);
  assert.notEqual(normalized.sourceDocument.source, input.sourceDocument.source);
  assert.notEqual(normalized.warnings, input.warnings);
  const left = normalized.blocks[1]!;
  const right = input.blocks[1]!;
  if (left.kind === "list-item" && right.kind === "list-item") assert.notEqual(left.list, right.list);
});
test("returns deterministic serializable data without canonical entities", () => {
  assert.deepEqual(normalizeDocument(fixture), normalizeDocument(fixture));
  const normalized = normalizeDocument(fixture);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), normalized);
  assert.equal("questions" in normalized, false);
  assert.equal("schemaVersion" in normalized, false);
  assert.equal("id" in normalized.sourceDocument, false);
});
test("summaries count source roles and paragraphs within tables, not questions", () => {
  assert.deepEqual(summarizeDocument(normalizeDocument(fixture)), { paragraphs: 1, headings: 1, listItems: 1, tables: 1, pages: 0, pagesWithoutText: 0 });
});
test("preserves PDF item order/coordinates and counts blank pages", () => {
  const extracted: ExtractedDocument = { ...fixture, sourceDocument: { ...fixture.sourceDocument, format: "pdf" }, blocks: [
    { kind: "page-text", key: "p:1", locator: "page:1", pageNumber: 1, width: 612, height: 792, items: [{ key: "i:1", locator: "page:1/item:0", text: "Original\r\ntext", direction: "ltr", transform: [12, 0, 0, 12, 40, 750], width: 80, height: 12, hasLineBreak: true }] },
    { kind: "page-text", key: "p:2", locator: "page:2", pageNumber: 2, width: 612, height: 792, items: [] },
  ] };
  const normalized = normalizeDocument(extracted);
  const page = normalized.blocks[0]!;
  assert.equal(page.kind, "page-text");
  if (page.kind === "page-text" && extracted.blocks[0]!.kind === "page-text") {
    assert.equal(page.items[0]!.text, "Original\ntext");
    assert.deepEqual(page.items[0]!.transform, [12, 0, 0, 12, 40, 750]);
    assert.notEqual(page.items[0]!.transform, extracted.blocks[0]!.items[0]!.transform);
  }
  assert.equal(summarizeDocument(normalized).pagesWithoutText, 1);
});
