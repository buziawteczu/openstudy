import { expect, test, type Page } from "@playwright/test";
import { docxFixture, paragraphXml } from "../test/document-fixtures.js";

const question = { q: "Which city?", a: ["Paris", "London"], answer: 0, topic: "Geography" };
const detailed = (project: string) => test.skip(!["mobile-320", "desktop"].includes(project), "Detailed storage flows run on phone and desktop.");
async function clearLibrary(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
}
async function structuredReady(page: Page) {
  await page.goto("/import");
  await page.getByLabel("Study material file").setInputFiles({ name: "geography.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([question])) });
  await page.getByLabel("Question (required)", { exact: true }).selectOption('["q"]');
  await page.getByLabel("Answers (required)", { exact: true }).selectOption('["a"]');
  await page.getByLabel("Correct answer (required)", { exact: true }).selectOption('["answer"]');
  await page.getByRole("radio", { name: /^Zero-based index/ }).check();
  await page.getByLabel("Topic / category (optional)", { exact: true }).selectOption('["topic"]');
  await page.getByRole("button", { name: "Validate all records" }).click();
  await expect(page.getByRole("button", { name: "Save to library" })).toBeVisible();
}

test("structured save persists across reload and deletion requires confirmation", async ({ page }, testInfo) => {
  detailed(testInfo.project.name);
  await clearLibrary(page);
  await structuredReady(page);
  const requests: string[] = [];
  await page.context().route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByRole("heading", { name: "geography", exact: true })).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  expect(page.url()).toContain("/study-sets/");
  const savedUrl = page.url();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("openstudy-library"); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(["studySets", "libraryEntries"]);
    const record = await new Promise<unknown>((resolve) => { const request = tx.objectStore("studySets").getAll(); request.onsuccess = () => resolve(request.result); });
    const summaries = await new Promise<unknown>((resolve) => { const request = tx.objectStore("libraryEntries").getAll(); request.onsuccess = () => resolve(request.result); });
    db.close();
    return { record, summaries };
  })).toMatchObject({ record: [{ schemaVersion: "1.0.0", title: "geography" }], summaries: [{ questionCount: 1, categoryCount: 1 }] });
  expect(requests).toEqual([]);
  await page.context().unroute("**/*");
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await page.context().route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("link", { name: /geography.*1 question/ })).toBeVisible();
  await page.getByRole("link", { name: /geography.*1 question/ }).click();
  expect(page.url()).toBe(savedUrl);
  await page.getByRole("button", { name: "Delete study set" }).click();
  await page.screenshot({ path: testInfo.outputPath("delete-confirmation.png") });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await page.getByRole("button", { name: "Delete study set" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  expect(requests).toEqual([]);
  await page.context().unroute("**/*");
});

test("reviewed DOCX saves and reopens after reload", async ({ page }, testInfo) => {
  detailed(testInfo.project.name);
  await clearLibrary(page);
  await page.goto("/import");
  const body = ["1. Which answer?", "A. First", "B. Second", "Answer: B"].map(paragraphXml).join("");
  await page.getByLabel("Study material file").setInputFiles({ name: "questions.docx", mimeType: "application/octet-stream", buffer: Buffer.from(await docxFixture(body)) });
  await page.getByRole("radio", { name: /Questions or an existing test/ }).check();
  await page.getByRole("button", { name: "Continue with document" }).click();
  await page.getByRole("checkbox", { name: /Confirm this question/ }).check();
  await page.getByRole("button", { name: "Validate reviewed questions" }).click();
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByRole("heading", { name: "questions", exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Sources" }).click();
  await expect(page.getByText("questions.docx")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();
});

test("Library and details stay narrow without horizontal overflow", async ({ page }, testInfo) => {
  await clearLibrary(page);
  await page.screenshot({ path: testInfo.outputPath("library-empty.png") });
  await structuredReady(page);
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("study-set-details.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("link", { name: /geography.*1 question/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("library-populated.png"), fullPage: true });
  expect(await page.locator(".app-shell").evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(720);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
