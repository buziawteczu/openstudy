import { expect, test } from "@playwright/test";
import { docxFixture, paragraphXml, pdfFixture } from "../test/document-fixtures.js";

const questions = [
  "1. Which source label is first?", "A. First", "B. Second", "Answer: A",
  "2. Existing question without answer", "A. One", "B. Two",
  "3. Fragment to exclude",
];
const body = questions.map(paragraphXml).join("");
const confirmName = /Confirm this question/;
function detailed(project: string) { test.skip(!["mobile-320", "desktop"].includes(project), "Detailed workflows on mobile and desktop; separate smoke test covers all widths."); }
test("DOCX correction, source comparison and explicit exclusion reach a ready set", async ({ page }, testInfo) => {
  detailed(testInfo.project.name);
  await page.goto("/import");
  const requests: string[] = [];
  await page.context().route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.getByLabel("Study material file").setInputFiles({ name: "questions.docx", mimeType: "application/octet-stream", buffer: Buffer.from(await docxFixture(body)) });
  await page.getByRole("radio", { name: /Questions or an existing test/ }).check();
  await page.getByRole("button", { name: "Continue with document" }).click();
  await expect(page.getByRole("heading", { name: "Question 1 of 3" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Structured mapping" })).toHaveCount(0);
  const original = page.locator(".document-review-grid > details");
  if (await original.getAttribute("open") === null) await original.locator("summary").first().click();
  await expect(original).toContainText("1. Which source label is first?");
  await page.getByRole("checkbox", { name: confirmName }).check();
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Question 2 of 3" })).toBeFocused();
  await page.getByLabel("Question text").fill("Corrected existing question");
  await page.getByLabel("Correct answer", { exact: true }).selectOption({ label: "Answer 2: Two" });
  await page.getByRole("checkbox", { name: confirmName }).check();
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await page.getByRole("checkbox", { name: "Exclude this question from the study set" }).check();
  await page.getByRole("button", { name: "Validate reviewed questions" }).click();
  await expect(page.getByRole("heading", { name: "Study set ready" })).toBeFocused();
  await expect(page.locator(".validation-result")).toContainText("3 candidates reviewed · 2 included · 1 excluded · 0 unresolved");
  await expect(page.locator(".validation-result")).toContainText("before saving loses this import");
  await expect(page.getByRole("button", { name: "Save to library" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("docx-review-ready.png"), fullPage: true });
  expect(requests).toEqual([]);
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
});
test("PDF page context and a manually selected answer reach ready without network", async ({ page }, testInfo) => {
  detailed(testInfo.project.name);
  await page.goto("/import");
  const requests: string[] = [];
  await page.context().route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.getByLabel("Study material file").setInputFiles({ name: "existing-test.pdf", mimeType: "application/pdf",
    buffer: Buffer.from(pdfFixture([["1. Existing PDF question", "A. First"], ["B. Second"]])) });
  await page.getByRole("radio", { name: /Questions or an existing test/ }).check();
  await page.getByRole("button", { name: "Continue with document" }).click();
  const original = page.locator(".document-review-grid > details");
  if (await original.getAttribute("open") === null) await original.locator("summary").first().click();
  await expect(original.getByRole("heading", { name: "Page 1" })).toBeVisible();
  await expect(original.getByRole("heading", { name: "Page 2" })).toBeVisible();
  await expect(page.getByText(/PDF text order may differ from the page/)).toBeVisible();
  await page.getByRole("button", { name: "Validate reviewed questions" }).click();
  await expect(page.getByRole("heading", { name: "Study set needs attention" })).toBeVisible();
  await page.getByLabel("Correct answer", { exact: true }).selectOption({ label: "Answer 2: Second" });
  await page.getByRole("checkbox", { name: confirmName }).check();
  await page.getByRole("button", { name: "Validate reviewed questions" }).click();
  await expect(page.getByRole("heading", { name: "Study set ready" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pdf-review-ready.png"), fullPage: true });
  expect(requests).toEqual([]);
});
for (const format of ["docx", "pdf"] as const) test(format + " notes intent remains extraction-only, never fake question generation", async ({ page }, testInfo) => {
  detailed(testInfo.project.name);
  await page.goto("/import");
  const buffer = format === "docx" ? await docxFixture(body) : pdfFixture([questions]);
  await page.getByLabel("Study material file").setInputFiles({ name: "notes." + format, mimeType: "application/octet-stream", buffer: Buffer.from(buffer) });
  await page.getByRole("radio", { name: /Study material \/ notes/ }).check();
  await page.getByRole("button", { name: "Continue with document" }).click();
  await expect(page.getByRole("heading", { name: "Content extracted successfully" })).toBeVisible();
  await expect(page.getByText(/Creating questions from study material will be added later/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Document question review" })).toHaveCount(0);
  await expect(page.getByLabel("Question text")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Structured mapping" })).toHaveCount(0);
});
test("document review responsive, keyboard and 200-percent text smoke", async ({ page }, testInfo) => {
  await page.goto("/import");
  const longBody = [paragraphXml("1. " + "LongOriginalQuestionWithoutWhitespace".repeat(10)),
    paragraphXml("A. " + "LongAnswerWithoutWhitespace".repeat(12)), paragraphXml("B. Second"), paragraphXml("Answer: A")].join("");
  await page.getByLabel("Study material file").setInputFiles({ name: "existing-" + "long-file-name-".repeat(20) + ".docx", mimeType: "application/octet-stream", buffer: Buffer.from(await docxFixture(longBody)) });
  await page.getByRole("radio", { name: /Questions or an existing test/ }).check();
  await page.getByRole("button", { name: "Continue with document" }).click();
  const original = page.locator(".document-review-grid > details");
  if (await original.getAttribute("open") === null) { await original.locator("summary").first().focus(); await page.keyboard.press("Enter"); }
  await expect(original).toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sourceBox = await original.boundingBox();
  const editorBox = await page.locator(".document-editor").boundingBox();
  if (testInfo.project.name.includes("desktop")) expect(editorBox!.x).toBeGreaterThan(sourceBox!.x + sourceBox!.width);
  else expect(editorBox!.y).toBeGreaterThan(sourceBox!.y);
  await page.locator(".document-review").screenshot({ path: testInfo.outputPath("document-review.png") });
  await page.getByRole("button", { name: "Add answer", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Answer 3")).toBeFocused();
  await page.getByLabel("Answer 3").fill("Added correction");
  await page.getByRole("button", { name: "Remove answer 3" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Add answer", exact: true })).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".document-review").screenshot({ path: testInfo.outputPath("document-review-200.png") });
  await page.getByLabel("Question text").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("document-editor-200-viewport.png") });
  await page.getByRole("button", { name: "Choose another file" }).click();
  await expect(page.getByLabel("Study material file")).toBeFocused();
  await expect(page.getByRole("region", { name: "Document question review" })).toHaveCount(0);
});
