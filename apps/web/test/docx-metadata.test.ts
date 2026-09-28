import { describe, expect, it, vi } from "vitest";
import { extractDocx } from "../src/import/docx.js";
import { INGESTION_LIMITS } from "../src/import/limits.js";
import { docxFixture, paragraphXml, WORD_NS } from "./document-fixtures.js";

const MAIN_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORD_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STRICT_RELS = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const styles = (entries: string) => `<w:styles xmlns:w="${WORD_NS}">${entries}</w:styles>`;
const contentTypes = (entries: string) => `<Types xmlns="${TYPES_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${entries}</Types>`;
const relationships = (entries: string) => `<Relationships xmlns="${RELS_NS}">${entries}</Relationships>`;

async function extract(bytes: Uint8Array, overrides: Record<string, number> = {}) {
  return extractDocx(bytes, {
    kind: "document-source", format: "docx", byteLength: bytes.byteLength,
    source: { key: "source:0", originalFilename: "material.docx" },
  }, { ...INGESTION_LIMITS, ...overrides }, new AbortController().signal);
}
async function expectCode(bytes: Uint8Array, code: string, overrides: Record<string, number> = {}) {
  await expect(extract(bytes, overrides)).rejects.toMatchObject({ failure: { code, filename: "material.docx" } });
}

describe("DOCX default paragraph styles", () => {
  it.each([false, true])("inherits default paragraph run formatting without pStyle (Strict=%s)", async (strict) => {
    const styleXml = styles('<w:docDefaults><w:rPrDefault><w:rPr><w:u/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:basedOn w:val="Base"/><w:rPr><w:i/></w:rPr></w:style>');
    const body = `${paragraphXml("Inherited")}<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Not bold</w:t></w:r></w:p>`;
    const result = await extract(await docxFixture(body, [], false, styleXml, { strict }));
    expect(result.blocks[0]).toMatchObject({ kind: "paragraph", style: "Normal", runs: [{ text: "Inherited", bold: true, italic: true, underline: true }] });
    expect(result.blocks[1]).toMatchObject({ style: "Normal", runs: [{ text: "Not bold", bold: false, italic: true, underline: true }] });
  });
  it.each([
    { properties: '<w:outlineLvl w:val="2"/>', block: { kind: "heading", headingLevel: 3 } },
    { properties: '<w:numPr><w:ilvl w:val="2"/><w:numId w:val="8"/></w:numPr>', block: { kind: "list-item", list: { key: "list:8", level: 2 } } },
  ])("inherits default paragraph properties: $block.kind", async ({ properties, block }) => {
    const styleXml = styles(`<w:style w:type="paragraph" w:styleId="Base"><w:pPr>${properties}</w:pPr></w:style><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:basedOn w:val="Base"/></w:style>`);
    const result = await extract(await docxFixture(paragraphXml("Text"), [], false, styleXml));
    expect(result.blocks[0]).toMatchObject({ ...block, style: "Normal", runs: [{ text: "Text" }] });
  });
  it("keeps explicit paragraph styles instead of applying the default chain", async () => {
    const styleXml = styles('<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Explicit"><w:rPr><w:i/></w:rPr></w:style>');
    const result = await extract(await docxFixture('<w:p><w:pPr><w:pStyle w:val="Explicit"/></w:pPr><w:r><w:t>Explicit</w:t></w:r></w:p>', [], false, styleXml));
    const block = result.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("Expected paragraph");
    expect(block).toMatchObject({ style: "Explicit", runs: [{ text: "Explicit", italic: true }] });
    expect(block).not.toHaveProperty("headingLevel");
    expect(block.runs[0]).not.toHaveProperty("bold");
  });
  it.each(["true", "on"])("accepts the enabled default-style flag %s", async (flag) => {
    const result = await extract(await docxFixture(paragraphXml("Text"), [], false, styles(`<w:style w:type="paragraph" w:styleId="Normal" w:default="${flag}"><w:rPr><w:b/></w:rPr></w:style>`)));
    expect(result.blocks[0]).toMatchObject({ style: "Normal", runs: [{ bold: true }] });
  });
  it("does not select a default character style or a disabled paragraph default", async () => {
    const styleXml = styles('<w:style w:type="character" w:styleId="Character" w:default="1"><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Disabled" w:default="0"><w:rPr><w:i/></w:rPr></w:style>');
    const result = await extract(await docxFixture(paragraphXml("Text"), [], false, styleXml));
    const block = result.blocks[0];
    if (block?.kind !== "paragraph") throw new Error("Expected paragraph");
    expect(block).not.toHaveProperty("style");
    expect(block).toMatchObject({ runs: [{ text: "Text" }] });
    expect(block.runs[0]).not.toHaveProperty("bold");
    expect(block.runs[0]).not.toHaveProperty("italic");
  });
  it("still rejects cycles reached through an implicit default style", async () => {
    const styleXml = styles('<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:basedOn w:val="Base"/></w:style><w:style w:type="paragraph" w:styleId="Base"><w:basedOn w:val="Normal"/></w:style>');
    await expectCode(await docxFixture(paragraphXml("Text"), [], false, styleXml), "corrupt-docx");
  });
});

describe("DOCX effective main-part content type", () => {
  it.each([false, true])("accepts an XML Default declaration without a main-part Override (Strict=%s)", async (strict) => {
    const contentTypesXml = contentTypes(`<Default Extension="XML" ContentType="${MAIN_TYPE}"/>`);
    const result = await extract(await docxFixture(paragraphXml("Default main type"), [], false, undefined, { strict, contentTypesXml }));
    expect(result.blocks[0]).toMatchObject({ runs: [{ text: "Default main type" }] });
  });
  it("lets a valid main-part Override supersede the XML default", async () => {
    const contentTypesXml = contentTypes(`<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${MAIN_TYPE}"/>`);
    expect((await extract(await docxFixture(undefined, [], false, undefined, { contentTypesXml }))).blocks).toHaveLength(4);
  });
  it.each(["application/xml", ""])("does not bypass an invalid Override with a valid Default: %s", async (type) => {
    const contentTypesXml = contentTypes(`<Default Extension="xml" ContentType="${MAIN_TYPE}"/><Override PartName="/word/document.xml" ContentType="${type}"/>`);
    await expectCode(await docxFixture(undefined, [], false, undefined, { contentTypesXml }), "corrupt-docx");
  });
  it.each([
    `<Default Extension="txt" ContentType="${MAIN_TYPE}"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
    `<Default xmlns="urn:unrelated" Extension="xml" ContentType="${MAIN_TYPE}"/>`,
  ])("rejects a missing or invalid XML default (%s)", async (entries) => {
    await expectCode(await docxFixture(undefined, [], false, undefined, { contentTypesXml: contentTypes(entries) }), "corrupt-docx");
  });
  it.each([
    `<Default Extension="xml" ContentType="${MAIN_TYPE}"/><Default Extension="XML" ContentType="application/xml"/>`,
    `<Override PartName="/word/document.xml" ContentType="${MAIN_TYPE}"/><Override PartName="/word/document.xml" ContentType="application/xml"/>`,
  ])("rejects ambiguous matching declarations (%s)", async (entries) => {
    await expectCode(await docxFixture(undefined, [], false, undefined, { contentTypesXml: contentTypes(entries) }), "corrupt-docx");
  });
  it("still rejects macro-enabled content types supplied through Default", async () => {
    const contentTypesXml = contentTypes('<Default Extension="xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>');
    await expectCode(await docxFixture(undefined, [], false, undefined, { contentTypesXml }), "unsupported-document-content");
  });
});

describe("DOCX omitted-part relationship warnings", () => {
  it.each([false, true].flatMap((strict) => ["header", "footer", "footnotes", "endnotes", "comments"].map((role) => ({ strict, role }))))("warns about $role under a nonconventional filename (Strict=$strict)", async ({ strict, role }) => {
    const type = `${strict ? STRICT_RELS : WORD_RELS}/${role}`;
    const rels = relationships(`<Relationship Id="omitted" Type="${type}" Target="content-section.xml"/>`);
    const bytes = await docxFixture(paragraphXml("Body only"), [["word/_rels/document.xml.rels", rels], ["word/content-section.xml", "omitted content"]], false, undefined, { strict });
    const result = await extract(bytes);
    expect(result.warnings).toContain("omitted-docx-parts");
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ runs: [{ text: "Body only" }] });
  });
  it("detects explicitly internal targets outside the usual word directory without loading them", async () => {
    const rels = relationships(`<Relationship Id="omitted" Type="${WORD_RELS}/header" Target="../custom/content.xml" TargetMode="Internal"/>`);
    const result = await extract(await docxFixture(paragraphXml("Body"), [["word/_rels/document.xml.rels", rels], ["custom/content.xml", "not parsed as body XML"]]));
    expect(result.warnings).toContain("omitted-docx-parts");
  });
  it("does not follow external targets or treat unrelated relationship types as omitted parts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      const rels = relationships(`<Relationship Id="external" Type="${WORD_RELS}/header" Target="https://example.invalid/header.xml" TargetMode="External"/><Relationship Id="image" Type="${WORD_RELS}/image" Target="content.xml"/><Relationship Id="unrelated" Type="urn:unrelated/header" Target="other.xml"/>`);
      const result = await extract(await docxFixture(paragraphXml("Body"), [["word/_rels/document.xml.rels", rels]]));
      expect(result.warnings).not.toContain("omitted-docx-parts");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it.each([
    `<Relationships xmlns="${RELS_NS}"><Relationship>`,
    `<!DOCTYPE Relationships [<!ENTITY x SYSTEM "https://example.invalid">]>${relationships("")}`,
  ])("rejects malformed or DTD-bearing relationships before following any targets (%s)", async (rels) => {
    await expectCode(await docxFixture(undefined, [["word/_rels/document.xml.rels", rels]]), "corrupt-docx");
  });
  it("charges relationship XML against the shared node budget", async () => {
    const rels = relationships(Array.from({ length: 300 }, (_, index) => `<Relationship Id="r${index}" Type="${WORD_RELS}/image" Target="content.xml"/>`).join(""));
    await expectCode(await docxFixture(paragraphXml("Body"), [["word/_rels/document.xml.rels", rels]]), "document-resource-limit", { documentNodes: 1_000 });
  });
});
