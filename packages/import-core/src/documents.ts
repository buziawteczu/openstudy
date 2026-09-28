import type { SourceDescriptor } from "./contracts.js";

/** Descriptor for this ingestion attempt, not the file or canonical Source. */
export interface SourceDocument {
  readonly kind: "document-source";
  readonly source: SourceDescriptor;
  readonly format: "docx" | "pdf";
  readonly byteLength: number;
}

export interface DocumentRun {
  readonly key: string;
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly style?: string;
  readonly media?: true;
  readonly revision?: "inserted" | "deleted";
}

interface BlockIdentity {
  /** Selection-local token; never a canonical ID. */
  readonly key: string;
  /** Opaque source-local XML path or PDF page/item locator. */
  readonly locator: string;
}

export interface TextBlock extends BlockIdentity {
  readonly kind: "paragraph" | "heading" | "list-item";
  readonly runs: readonly DocumentRun[];
  readonly style?: string;
  readonly headingLevel?: number;
  readonly list?: { readonly key: string; readonly level: number };
}

export interface TableCell extends BlockIdentity {
  readonly blocks: readonly DocumentBlock[];
  readonly columnSpan: number;
  readonly verticalMerge?: "start" | "continue";
}

export interface TableBlock extends BlockIdentity {
  readonly kind: "table";
  readonly rows: readonly { readonly key: string; readonly locator: string; readonly cells: readonly TableCell[] }[];
}

export interface PageTextBlock extends BlockIdentity {
  readonly kind: "page-text";
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly items: readonly {
    readonly key: string;
    readonly locator: string;
    readonly text: string;
    readonly direction: string;
    readonly transform: readonly number[];
    readonly width: number;
    readonly height: number;
    readonly hasLineBreak: boolean;
  }[];
}

export interface UnsupportedBlock extends BlockIdentity {
  readonly kind: "unsupported";
  readonly description: string;
}

export type DocumentBlock = TextBlock | TableBlock | PageTextBlock | UnsupportedBlock;
export type DocumentWarning = "limited-docx-styles" | "omitted-docx-parts" | "unsupported-content" | "pdf-reading-order" | "pdf-media-not-extracted" | "pages-without-text";

/** Detached, serializable source structure. No DOM/parser objects or semantics. */
export interface ExtractedDocument {
  readonly kind: "extracted-document";
  readonly sourceDocument: SourceDocument;
  readonly blocks: readonly DocumentBlock[];
  readonly hasEmbeddedMedia: boolean | "unknown";
  readonly warnings: readonly DocumentWarning[];
}

export interface NormalizedDocument extends Omit<ExtractedDocument, "kind"> {
  readonly kind: "normalized-document";
}

export interface DocumentSummary {
  readonly paragraphs: number;
  readonly headings: number;
  readonly listItems: number;
  readonly tables: number;
  readonly pages: number;
  readonly pagesWithoutText: number;
}

/** Only normalize line endings; never trim, merge, reorder or interpret content. */
export function normalizeDocument(extracted: ExtractedDocument): NormalizedDocument {
  // Extractor output is resource-bounded plain data. Snapshot keeps original text
  // available independently of the normalized representation.
  function normalize(block: DocumentBlock): DocumentBlock {
    if (block.kind === "table") return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: cell.blocks.map(normalize) })) })) };
    if (block.kind === "page-text") return { ...block, items: block.items.map((item) => ({ ...item, transform: [...item.transform], text: item.text.replace(/\r\n?/g, "\n") })) };
    if (block.kind === "unsupported") return { ...block };
    return { ...block, ...(block.list ? { list: { ...block.list } } : {}), runs: block.runs.map((run) => ({ ...run, text: run.text.replace(/\r\n?/g, "\n") })) };
  }
  return {
    ...extracted, kind: "normalized-document",
    sourceDocument: { ...extracted.sourceDocument, source: { ...extracted.sourceDocument.source } },
    warnings: [...extracted.warnings], blocks: extracted.blocks.map(normalize),
  };
}

export function summarizeDocument(document: NormalizedDocument): DocumentSummary {
  const counts = { paragraphs: 0, headings: 0, listItems: 0, tables: 0, pages: 0, pagesWithoutText: 0 };
  const work = [...document.blocks];
  for (let block = work.pop(); block !== undefined; block = work.pop()) {
    switch (block.kind) {
      case "paragraph": counts.paragraphs += 1; break;
      case "heading": counts.headings += 1; break;
      case "list-item": counts.listItems += 1; break;
      case "table": counts.tables += 1; work.push(...block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))); break;
      case "page-text": counts.pages += 1; if (!block.items.some((item) => /\S/u.test(item.text))) counts.pagesWithoutText += 1; break;
    }
  }
  return counts;
}
