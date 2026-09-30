import type { DocumentBlock } from "@openstudy/import-core";
import { documentBlockText, type SourceBlockRef } from "@openstudy/mapping";

/** Presentation only: original item/cell wording plus nearby context, never grouping rules. */
export function sourceContextText(block: DocumentBlock, refs: readonly SourceBlockRef[]): string {
  const locators = refs.filter((ref) => ref.blockKey === block.key).map((ref) => ref.locator);
  if (block.kind === "table") {
    const rows = block.rows.filter((row, index) => index === 0 || locators.some((locator) =>
      locator === row.locator || locator.startsWith(row.locator + "/")));
    return rows.map((row) => row.cells.map((cell) => cell.blocks.map(documentBlockText).join("\n")).join("\t")).join("\n");
  }
  if (block.kind === "page-text") {
    const indexes = new Set<number>();
    for (const locator of locators) {
      const match = locator.match(/\/item:(\d+)(?:\/through:page:\d+\/item:(\d+))?$/u);
      if (!match) continue;
      const first = Number(match[1]);
      const last = Number(match[2] ?? match[1]);
      for (let index = Math.max(0, first - 1); index <= Math.min(block.items.length - 1, last + 1); index++) indexes.add(index);
    }
    if (indexes.size > 0) {
      let text = "";
      let previous: typeof block.items[number] | undefined;
      let previousIndex = -1;
      block.items.forEach((item, index) => {
        if (!indexes.has(index)) return;
        if (previous && (index !== previousIndex + 1 || previous.hasLineBreak || previous.transform[5] !== item.transform[5])) text += "\n";
        text += item.text;
        previous = item;
        previousIndex = index;
      });
      return text;
    }
  }
  return documentBlockText(block);
}
