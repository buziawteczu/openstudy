import { expect, test, type Page } from "@playwright/test";
import { docxFixture, paragraphXml } from "../test/document-fixtures.js";

const original = { q: "Which city?", a: ["Paris", "London"], answer: 0, topic: "Geography" };
const extra = { q: "Which river?", a: ["Thames", "Seine"], answer: 0, topic: "Rivers" };

async function mapStructured(page: Page, rows: unknown[], filename: string) {
  await page.getByLabel("Study material file").setInputFiles({ name: filename, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rows)) });
  await page.getByLabel("Question (required)", { exact: true }).selectOption('["q"]');
  await page.getByLabel("Answers (required)", { exact: true }).selectOption('["a"]');
  await page.getByLabel("Correct answer (required)", { exact: true }).selectOption('["answer"]');
  await page.getByRole("radio", { name: /^Zero-based index/ }).check();
  await page.getByLabel("Topic / category (optional)", { exact: true }).selectOption('["topic"]');
  await page.getByRole("button", { name: "Validate all records" }).click();
}
async function saveOriginal(page: Page) {
  await page.goto("/import");
  await mapStructured(page, [original], "geography.json");
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  return page.url();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("openstudy-library"); request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(["studySets", "libraryEntries"]);
    const get = <T>(store: string) => new Promise<T[]>((resolve) => {
      const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result);
    });
    const result = { sets: await get<{ id: string; revision: number; questions: { id: string; choices: { id: string }[]; provenance?: unknown[] }[]; sources: unknown[] }>("studySets"),
      summaries: await get<{ revision: number; questionCount: number; sourceCount: number }>("libraryEntries") };
    db.close();
    return result;
  });
}

test("structured material previews exact duplicates and updates the saved set atomically", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop"].includes(testInfo.project.name));
  const details = await saveOriginal(page);
  const before = await stored(page);
  await page.getByRole("link", { name: "Add material" }).click();
  await expect(page.getByRole("heading", { name: /Add material to/ })).toBeVisible();
  await mapStructured(page, [original, extra], "another-geography.json");
  await expect(page.getByText(/2 questions found · 1 new · 1 already exist/)).toBeVisible();
  await page.getByText("1 already in this study set").click();
  await expect(page.getByText(/Incoming question 1: Which city\?/)).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("merge-preview.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Update study set" }).click();
  await expect(page).toHaveURL(details);
  const after = await stored(page);
  expect(after.sets[0]!.id).toBe(before.sets[0]!.id);
  expect(after.sets[0]!.revision).toBe(2);
  expect(after.sets[0]!.questions).toHaveLength(2);
  expect(after.sets[0]!.questions[0]!.id).toBe(before.sets[0]!.questions[0]!.id);
  expect(after.sets[0]!.questions[0]!.choices).toEqual(before.sets[0]!.questions[0]!.choices);
  expect(after.sets[0]!.questions[0]!.provenance).toHaveLength(2);
  expect(after.sets[0]!.sources).toHaveLength(2);
  expect(after.summaries).toMatchObject([{ revision: 2, questionCount: 2, sourceCount: 2 }]);
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();
});

test("leaving add material does not change the saved study set", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop"].includes(testInfo.project.name));
  const details = await saveOriginal(page);
  const before = await stored(page);
  await page.getByRole("link", { name: "Add material" }).click();
  await mapStructured(page, [extra], "extra.json");
  await page.getByRole("link", { name: "Back to study set" }).last().click();
  await expect(page).toHaveURL(details);
  expect(await stored(page)).toEqual(before);
});

test("reviewed DOCX material merges through the same preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await saveOriginal(page);
  await page.getByRole("link", { name: "Add material" }).click();
  const body = ["1. Which answer?", "A. First", "B. Second", "Answer: B"].map(paragraphXml).join("");
  await page.getByLabel("Study material file").setInputFiles({ name: "questions.docx", mimeType: "application/octet-stream", buffer: Buffer.from(await docxFixture(body)) });
  await page.getByRole("radio", { name: /Questions or an existing test/ }).check();
  await page.getByRole("button", { name: "Continue with document" }).click();
  await expect(page.getByLabel("Study set title")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Confirm this question/ }).check();
  await page.getByRole("button", { name: "Validate reviewed questions" }).click();
  await expect(page.getByRole("button", { name: "Update study set" })).toBeVisible();
  await page.getByRole("button", { name: "Update study set" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  const after = await stored(page);
  expect(after.sets[0]!.revision).toBe(2);
  expect(after.sets[0]!.questions).toHaveLength(2);
});
