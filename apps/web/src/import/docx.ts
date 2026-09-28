import type { DocumentBlock, DocumentRun, DocumentWarning, ExtractedDocument, SourceDocument, TableCell, TextBlock } from "@openstudy/import-core";
import { fail } from "./errors.js";
import type { IngestionLimits } from "./limits.js";
import { readDocxPackage } from "./docx-package.js";

const WORD_NAMESPACES = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);
const CONTENT_TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";
const OMITTED_PART_TYPES = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"].flatMap((namespace) => ["header", "footer", "footnotes", "endnotes", "comments"].map((role) => `${namespace}/${role}`)));
const isWord = (element: Element, name: string) => WORD_NAMESPACES.has(element.namespaceURI ?? "") && element.localName === name;
const children = (element: Element | undefined, name: string): Element[] => element ? Array.from(element.children).filter((child) => isWord(child, name)) : [];
const child = (element: Element | undefined, name: string) => children(element, name)[0];
const value = (element: Element | undefined, name = "val") => element ? Array.from(element.attributes).find((attribute) => WORD_NAMESPACES.has(attribute.namespaceURI ?? "") && attribute.localName === name)?.value : undefined;

/** Read only XML data: no HTML rendering, DTDs, entities or relationship target loading. */
function parseXml(bytes: Uint8Array, filename: string, limits: IngestionLimits, budget: { nodes: number }): Document {
  let text: string;
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch { fail("corrupt-docx", filename); }
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) fail("corrupt-docx", filename);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length || document.documentElement.localName === "parsererror") fail("corrupt-docx", filename);
  const work: { node: Element; depth: number }[] = [{ node: document.documentElement, depth: 0 }];
  while (work.length) {
    const { node, depth } = work.pop()!;
    budget.nodes += 1 + node.attributes.length;
    if (budget.nodes > limits.documentNodes || depth > limits.documentDepth) fail("document-resource-limit", filename);
    for (const item of Array.from(node.childNodes)) {
      if (item.nodeType === 1) work.push({ node: item as Element, depth: depth + 1 });
      else if (++budget.nodes > limits.documentNodes) fail("document-resource-limit", filename);
    }
  }
  return document;
}

type Formatting = Pick<DocumentRun, "bold" | "italic" | "underline">;
function formatting(properties: Element | undefined): Formatting {
  const result: { bold?: boolean; italic?: boolean; underline?: boolean } = {};
  for (const [name, key] of [["b", "bold"], ["i", "italic"], ["u", "underline"]] as const) {
    const property = child(properties, name);
    if (property) result[key] = !["0", "false", "off", "none"].includes(value(property) ?? "true");
  }
  return result;
}

/** Narrow, source-faithful WordprocessingML extraction, not a Word renderer. */
export async function extractDocx(bytes: Uint8Array, sourceDocument: SourceDocument, limits: IngestionLimits, signal: AbortSignal): Promise<ExtractedDocument> {
  const filename = sourceDocument.source.originalFilename ?? "document.docx";
  signal.throwIfAborted();
  if (bytes.byteLength > limits.docxBytes) fail("file-too-large", filename, { limit: limits.docxBytes });
  const archive = await readDocxPackage(bytes, filename, limits, signal);
  signal.throwIfAborted();
  const budget = { nodes: 0 };
  const contentTypes = parseXml(archive.parts.get("[Content_Types].xml")!, filename, limits, budget);
  if (contentTypes.documentElement.namespaceURI !== CONTENT_TYPES_NAMESPACE || contentTypes.documentElement.localName !== "Types") fail("corrupt-docx", filename);
  const types = Array.from(contentTypes.documentElement.children);
  if (types.some((part) => /macroEnabled|vbaProject/i.test(part.getAttribute("ContentType") ?? ""))) fail("unsupported-document-content", filename);
  const declarations = types.filter((part) => part.namespaceURI === CONTENT_TYPES_NAMESPACE);
  const overrides = declarations.filter((part) => part.localName === "Override" && part.getAttribute("PartName")?.toLowerCase() === "/word/document.xml");
  const defaultsForXml = declarations.filter((part) => part.localName === "Default" && part.getAttribute("Extension")?.toLowerCase() === "xml");
  if (overrides.length > 1 || defaultsForXml.length > 1) fail("corrupt-docx", filename);
  // An Override wins even if invalid; never fall back to Default to bypass it.
  const mainType = (overrides[0] ?? defaultsForXml[0])?.getAttribute("ContentType");
  // Strict and Transitional DOCX share this main-part type; their XML namespaces differ.
  if (mainType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") fail("corrupt-docx", filename);
  const xml = parseXml(archive.parts.get("word/document.xml")!, filename, limits, budget);
  if (!isWord(xml.documentElement, "document")) fail("corrupt-docx", filename);
  const body = child(xml.documentElement, "body");
  if (!body) fail("corrupt-docx", filename);
  const warnings = new Set<DocumentWarning>(["limited-docx-styles"]);
  if ([...archive.names].some((name) => /^word\/(header|footer|footnotes|endnotes|comments)/.test(name))) warnings.add("omitted-docx-parts");
  const relationshipsBytes = archive.parts.get("word/_rels/document.xml.rels");
  if (relationshipsBytes) {
    const root = parseXml(relationshipsBytes, filename, limits, budget).documentElement;
    if (root.namespaceURI !== RELATIONSHIPS_NAMESPACE || root.localName !== "Relationships") fail("corrupt-docx", filename);
    // Inspect roles only. Targets are never resolved, parsed, fetched or executed.
    if (Array.from(root.children).some((relationship) => relationship.namespaceURI === RELATIONSHIPS_NAMESPACE && relationship.localName === "Relationship" && (relationship.getAttribute("TargetMode") ?? "Internal") === "Internal" && OMITTED_PART_TYPES.has(relationship.getAttribute("Type") ?? ""))) warnings.add("omitted-docx-parts");
  }
  let hasEmbeddedMedia = [...archive.names].some((name) => /^word\/(media|embeddings)\//.test(name));
  const styles = new Map<string, Element>();
  const stylesBytes = archive.parts.get("word/styles.xml");
  let defaults: Formatting = {};
  let defaultParagraphStyle: string | undefined;
  if (stylesBytes) {
    const root = parseXml(stylesBytes, filename, limits, budget).documentElement;
    if (!isWord(root, "styles")) fail("corrupt-docx", filename);
    defaults = formatting(child(child(child(root, "docDefaults"), "rPrDefault"), "rPr"));
    for (const style of children(root, "style")) {
      const id = value(style, "styleId");
      if (id) {
        if (styles.has(id)) fail("corrupt-docx", filename);
        styles.set(id, style);
        if (value(style, "type") === "paragraph" && ["1", "true", "on"].includes(value(style, "default") ?? "")) defaultParagraphStyle = id;
      }
    }
  }
  const styleCache = new Map<string, Element[]>();
  function styleChain(id: string | undefined): Element[] {
    if (!id) return [];
    const cached = styleCache.get(id);
    if (cached) return cached;
    const chain: Element[] = [];
    const seen = new Set<string>();
    let next: string | undefined = id;
    while (next) {
      if (seen.has(next)) fail("corrupt-docx", filename);
      if (seen.size >= limits.documentDepth) fail("document-resource-limit", filename);
      seen.add(next);
      const style = styles.get(next);
      if (!style) break;
      chain.unshift(style);
      next = value(child(style, "basedOn"));
    }
    styleCache.set(id, chain);
    return chain;
  }
  let blockCount = 0;
  let characters = 0;
  const identity = (locator: string) => {
    if (++blockCount > limits.documentBlocks) fail("document-resource-limit", filename, { limit: limits.documentBlocks });
    return { key: `block:${locator}`, locator };
  };
  const location = (path: string, element: Element, index: number) => `${path}/${element.localName}[${index}]`;

  function paragraph(element: Element, locator: string): TextBlock {
    const properties = child(element, "pPr");
    const style = value(child(properties, "pStyle")) ?? defaultParagraphStyle;
    const chain = styleChain(style);
    const propertyChain = [...chain.map((entry) => child(entry, "pPr")), properties];
    const inherited = Object.assign({}, defaults, ...chain.map((entry) => formatting(child(entry, "rPr")))) as Formatting;
    let outline: string | undefined;
    let numbering: Element | undefined;
    for (const props of propertyChain) {
      outline = value(child(props, "outlineLvl")) ?? outline;
      numbering = child(props, "numPr") ?? numbering;
    }
    const numberId = value(child(numbering, "numId"));
    const level = Number(value(child(numbering, "ilvl")) ?? 0);
    const headingLevel = outline !== undefined && Number(outline) >= 0 && Number(outline) <= 8 ? Number(outline) + 1 : undefined;
    const list = numberId !== undefined && numberId !== "0" ? { key: `list:${numberId}`, level: Number.isInteger(level) && level >= 0 && level <= 8 ? level : 0 } : undefined;
    const runs: DocumentRun[] = [];
    function inline(parent: Element, path: string, revision?: "inserted" | "deleted") {
      for (const [index, node] of Array.from(parent.children).entries()) {
        const local = location(path, node, index);
        if (isWord(node, "r")) {
          const props = child(node, "rPr");
          const runStyle = value(child(props, "rStyle"));
          let text = "";
          let media = false;
          for (const part of Array.from(node.children)) {
            if (isWord(part, "t") || isWord(part, "delText")) text += part.textContent ?? "";
            else if (isWord(part, "tab")) text += "\t";
            else if (isWord(part, "br") || isWord(part, "cr")) text += "\n";
            else if (["drawing", "pict", "object"].some((name) => isWord(part, name))) { media = true; hasEmbeddedMedia = true; warnings.add("unsupported-content"); }
            else if (!["rPr", "lastRenderedPageBreak"].some((name) => isWord(part, name))) warnings.add("unsupported-content");
          }
          characters += text.length;
          if (characters > limits.documentCharacters) fail("document-resource-limit", filename, { limit: limits.documentCharacters });
          const marks = Object.assign({}, inherited, ...styleChain(runStyle).map((entry) => formatting(child(entry, "rPr"))), formatting(props)) as Formatting;
          runs.push({ key: `run:${local}`, text, ...marks, ...(runStyle ? { style: runStyle } : {}), ...(media ? { media: true } : {}), ...(revision ? { revision } : {}) });
        } else if (["hyperlink", "smartTag", "sdtContent", "sdt", "ins", "del", "fldSimple"].some((name) => isWord(node, name))) {
          if (isWord(node, "ins") || isWord(node, "del") || isWord(node, "fldSimple")) warnings.add("unsupported-content");
          inline(node, local, isWord(node, "ins") ? "inserted" : isWord(node, "del") ? "deleted" : revision);
        } else if (!["pPr", "bookmarkStart", "bookmarkEnd", "proofErr", "sdtPr", "sdtEndPr"].some((name) => isWord(node, name))) warnings.add("unsupported-content");
      }
    }
    inline(element, locator);
    return { ...identity(locator), kind: list ? "list-item" : headingLevel ? "heading" : "paragraph", runs, ...(style ? { style } : {}), ...(headingLevel ? { headingLevel } : {}), ...(list ? { list } : {}) };
  }
  function blocks(parent: Element, path: string): DocumentBlock[] {
    const result: DocumentBlock[] = [];
    for (const [index, element] of Array.from(parent.children).entries()) {
      signal.throwIfAborted();
      const locator = location(path, element, index);
      if (isWord(element, "p")) result.push(paragraph(element, locator));
      else if (isWord(element, "tbl")) {
        const tableIdentity = identity(locator);
        if (Array.from(element.children).some((part) => !["tblPr", "tblGrid", "tr", "bookmarkStart", "bookmarkEnd"].some((name) => isWord(part, name)))) warnings.add("unsupported-content");
        const rows = children(element, "tr").map((row, rowIndex) => {
          const rowLocator = `${locator}/tr[${rowIndex}]`;
          if (Array.from(row.children).some((part) => !["trPr", "tc", "bookmarkStart", "bookmarkEnd"].some((name) => isWord(part, name)))) warnings.add("unsupported-content");
          const cells: TableCell[] = children(row, "tc").map((cell, cellIndex) => {
            const cellLocator = `${rowLocator}/tc[${cellIndex}]`;
            const props = child(cell, "tcPr");
            const span = Number(value(child(props, "gridSpan")) ?? 1);
            const merge = child(props, "vMerge");
            return { ...identity(cellLocator), blocks: blocks(cell, cellLocator), columnSpan: Number.isSafeInteger(span) && span > 0 ? span : 1, ...(merge ? { verticalMerge: value(merge) === "restart" ? "start" as const : "continue" as const } : {}) };
          });
          return { ...identity(rowLocator), cells };
        });
        result.push({ ...tableIdentity, kind: "table", rows });
      } else if (["sdt", "sdtContent", "customXml", "ins", "del"].some((name) => isWord(element, name))) {
        if (isWord(element, "ins") || isWord(element, "del")) warnings.add("unsupported-content");
        result.push(...blocks(element, locator));
      } else if (!["sectPr", "tcPr", "sdtPr", "sdtEndPr", "bookmarkStart", "bookmarkEnd"].some((name) => isWord(element, name))) {
        warnings.add("unsupported-content");
        result.push({ ...identity(locator), kind: "unsupported", description: `Unsupported DOCX block: ${element.localName}` });
      }
    }
    return result;
  }
  return { kind: "extracted-document", sourceDocument, blocks: blocks(body, "word/document.xml#/document/body"), hasEmbeddedMedia, warnings: [...warnings] };
}
