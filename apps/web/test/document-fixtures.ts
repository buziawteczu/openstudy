import { createHash } from "node:crypto";
import { zipFixture } from "./zip-fixture.js";

export const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const paragraphXml = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
export const sampleDocxBody = `
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Railway safety</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Which signal means stop? </w:t></w:r><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/></w:rPr><w:t>Red</w:t></w:r><w:r><w:tab/><w:br/><w:t>A. Green</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>B. Red</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc>${paragraphXml("Code")}</w:tc><w:tc>${paragraphXml("Meaning")}</w:tc></w:tr><w:tr><w:tc>${paragraphXml("R")}</w:tc><w:tc>${paragraphXml("Stop")}</w:tc></w:tr></w:tbl>`;
const mainContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const styles = `<w:styles xmlns:w="${WORD_NS}"><w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Base"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`;

/** Tiny owned OOXML fixtures, generated in memory with fixed ZIP timestamps. */
export async function docxFixture(body = sampleDocxBody, extra: readonly (readonly [string, string | Uint8Array])[] = [], compressed = false, styleXml = styles, options: { strict?: boolean; mainContentType?: string; contentTypesXml?: string } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const wordNamespace = options.strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : WORD_NS;
  const relationshipNamespace = options.strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const contentTypes = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="${options.mainContentType ?? mainContentType}"/></Types>`;
  return zipFixture([
    ["[Content_Types].xml", options.contentTypesXml ?? contentTypes],
    ["_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationshipNamespace}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/document.xml", `<w:document xmlns:w="${wordNamespace}" xmlns:r="${relationshipNamespace}"${options.strict ? ' w:conformance="strict"' : ""}><w:body>${body}</w:body></w:document>`],
    ["word/styles.xml", styleXml.replaceAll(WORD_NS, wordNamespace)],
    ...extra,
  ], compressed);
}

function pdfObjects(objects: readonly string[], trailer = ""): Uint8Array<ArrayBuffer> {
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}

/** Minimal ASCII PDFs: no third-party/copyrighted files or network fixture. */
export function pdfFixture(pages: readonly (readonly string[])[] = [["Safety principles"], ["Revision notes"]], imageOnly = false): Uint8Array<ArrayBuffer> {
  const imageId = 4 + pages.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (globalThis.documentScriptExecuted = true) >> >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, lines] of pages.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${imageOnly ? `/XObject << /Im1 ${imageId} 0 R >>` : ""} >> /Contents ${5 + index * 2} 0 R >>`);
    const content = imageOnly ? "q 100 0 0 100 40 600 cm /Im1 Do Q" : lines.map((line, lineIndex) => `BT /F1 12 Tf 40 ${750 - lineIndex * 25} Td (${line.replace(/([\\()])/g, "\\$1")}) Tj ET`).join("\n");
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  if (imageOnly) objects.push("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n00>\nendstream");
  return pdfObjects(objects);
}

const padding = new Uint8Array([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
function padded(password: string): Buffer { return Buffer.concat([Buffer.from(password), Buffer.from(padding)]).subarray(0, 32); }
function rc4(key: Uint8Array, input: Uint8Array): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) { j = (j + state[i]! + key[i % key.length]!) % 256; [state[i], state[j]] = [state[j]!, state[i]!]; }
  let i = 0;
  j = 0;
  return Buffer.from(input.map((byte) => { i = (i + 1) % 256; j = (j + state[i]!) % 256; [state[i], state[j]] = [state[j]!, state[i]!]; return byte ^ state[(state[i]! + state[j]!) % 256]!; }));
}

/** Standard PDF revision-2 encryption fixture; crypto exists only in test code. */
export function encryptedPdfFixture(userPassword = "secret"): Uint8Array<ArrayBuffer> {
  const id = Buffer.alloc(16, 1);
  const owner = rc4(createHash("md5").update(padded("owner")).digest().subarray(0, 5), padded(userPassword));
  const permissions = Buffer.from([0xfc, 0xff, 0xff, 0xff]);
  const key = createHash("md5").update(Buffer.concat([padded(userPassword), owner, permissions, id])).digest().subarray(0, 5);
  const user = rc4(key, padding);
  return pdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> >>`,
  ], `/Encrypt 4 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]`);
}
