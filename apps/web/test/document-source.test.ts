import { expect, it } from "vitest";
import type { PageTextBlock } from "@openstudy/import-core";
import { sourceContextText } from "../src/import/document-source.js";

it("keeps adjacent PDF items on one line and breaks at source line boundaries", () => {
  const page: PageTextBlock = {
    kind: "page-text", key: "page:1", locator: "page:1", pageNumber: 1, width: 612, height: 792,
    items: [
      { text: "1. ", baseline: 750, hasLineBreak: false },
      { text: "Prompt", baseline: 750, hasLineBreak: false },
      { text: "A. First", baseline: 725, hasLineBreak: true },
      { text: "B. Second", baseline: 725, hasLineBreak: false },
    ].map((item, index) => ({ key: "item:" + index, locator: "page:1/item:" + index,
      text: item.text, transform: [12, 0, 0, 12, 40, item.baseline], width: 100, height: 12,
      direction: "ltr", hasLineBreak: item.hasLineBreak })),
  };
  expect(sourceContextText(page, [{ blockKey: page.key, locator: "page:1/item:1/through:page:1/item:2" }]))
    .toBe("1. Prompt\nA. First\nB. Second");
});
