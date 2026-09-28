import { expect, test } from "@playwright/test";
import { docxFixture, encryptedPdfFixture, pdfFixture } from "../test/document-fixtures.js";

test("DOCX extraction, long filenames and reset work locally without question mapping", async ({ page }, testInfo) => {
  const bytes = await docxFixture(undefined, [["word/_rels/document.xml.rels", '<Relationships><Relationship Target="https://example.invalid/image.png" TargetMode="External"/></Relationships>']], true);
  const name = "exam-" + "railway-material-".repeat(12) + ".docx";
  await page.goto("/import");
  const requests: string[] = [];
  await page.context().route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  const input = page.getByLabel("Study material file");
  await input.setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(bytes) });
  await expect(page.getByRole("heading", { name: "Document extracted" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Content ready for review");
  await expect(page.getByRole("status")).toContainText("No questions have been created");
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("docx-extracted.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Choose another file" }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await input.setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  await expect(page.getByRole("heading", { name: "Document extracted" })).toBeVisible();
  expect(requests).toEqual([]);
});

test("PDF text, scanned error and encryption use the bundled local worker without network", async ({ page }, testInfo) => {
  await page.goto("/import");
  const requests: string[] = [];
  await page.context().route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  const input = page.getByLabel("Study material file");
  await input.setInputFiles({ name: "revision-notes-" + "long-".repeat(30) + ".pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfFixture()) });
  await expect(page.getByRole("heading", { name: "Document extracted" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2 pages processed");
  await expect(page.getByRole("status")).toContainText("Selectable text extracted");
  await page.screenshot({ path: testInfo.outputPath("pdf-extracted.png"), fullPage: true });
  expect(await page.evaluate(() => Reflect.get(globalThis, "documentScriptExecuted"))).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Choose another file" }).click();
  await input.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfFixture([[]], true)) });
  await expect(page.getByRole("alert")).toHaveText("We couldn't find enough selectable text in this PDF. Scanned PDFs aren't supported yet.");
  await expect(page.getByRole("heading", { name: "Document extracted" })).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Choose another file" }).click();
  await input.setInputFiles({ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(encryptedPdfFixture()) });
  await expect(page.getByRole("alert")).toContainText("password-protected or encrypted");
  expect(requests).toEqual([]);
});
