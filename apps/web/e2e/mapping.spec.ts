import { expect, test, type Page } from "@playwright/test";

const good = { q: "Which city?", a: ["Lisbon", "Paris", "London"], answer: 1, topic: "Geography", why: "Capital cities.", external: "record-8" };
async function upload(page: Page, value: unknown, filename = "questions.json") {
  await page.getByLabel("Study material file").setInputFiles({
    name: filename, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole("heading", { name: "Ready for mapping" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Document question review" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What are you uploading?" })).toHaveCount(0);
}
async function map(page: Page, paths = { prompt: ["q"], choices: ["a"], answer: ["answer"] }) {
  await page.getByLabel("Question (required)", { exact: true }).selectOption(JSON.stringify(paths.prompt));
  await page.getByLabel("Answers (required)", { exact: true }).selectOption(JSON.stringify(paths.choices));
  await page.getByLabel("Correct answer (required)", { exact: true }).selectOption(JSON.stringify(paths.answer));
  await page.getByRole("radio", { name: /^Zero-based index/ }).check();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("JSON collection selection, explicit mapping, validation and session-only success", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop"].includes(testInfo.project.name), "Detailed flows run on phone and desktop; responsive smoke covers all widths.");
  await page.goto("/import");
  const requests: string[] = [];
  await page.context().route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await upload(page, { questions: [good, good], metadata: [{ author: "Someone" }] });
  const selector = page.getByLabel("Record collection");
  await expect(selector).toHaveValue("");
  await expect(page.getByLabel("Question (required)", { exact: true })).toHaveCount(0);
  const key = await selector.locator("option").filter({ hasText: "/questions" }).getAttribute("value");
  await selector.selectOption(key!);
  await expect(page.getByRole("button", { name: "Validate all records" })).toBeDisabled();
  await map(page);
  await page.getByLabel("Topic / category (optional)", { exact: true }).selectOption('["topic"]');
  await page.getByLabel("Explanation (optional)", { exact: true }).selectOption('["why"]');
  await page.getByLabel("Source record ID (optional)", { exact: true }).selectOption('["external"]');
  const preview = page.getByRole("region", { name: "A first look" });
  await expect(preview.getByRole("article")).toHaveCount(2);
  await expect(preview.getByText("Correct answer", { exact: true })).toHaveCount(2);
  await expect(preview).toContainText("Topic: Geography");
  // Exercise the native radio group with keys; preview updates must leave focus alone.
  const zeroBased = page.getByRole("radio", { name: /^Zero-based index/ });
  await zeroBased.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /^One-based index/ })).toBeFocused();
  await expect(preview.locator(".answer-correct").first()).toContainText("Lisbon");
  await page.keyboard.press("ArrowLeft");
  await expect(zeroBased).toBeFocused();
  await expect(preview.locator(".answer-correct").first()).toContainText("Paris");
  await expect(page.getByRole("heading", { name: "Study set ready" })).toHaveCount(0);
  await page.getByLabel("Study set title (required)", { exact: true }).fill("My geography");
  await page.getByRole("button", { name: "Validate all records" }).focus();
  await page.keyboard.press("Enter");
  const ready = page.getByRole("region", { name: "Study set ready" });
  await expect(ready).toContainText("2 records inspected · 2 ready · 0 need attention");
  await expect(ready).toContainText("My geography · 2 questions · 1 category");
  await expect(ready).toContainText("Leaving or reloading loses it");
  await expect(page.getByRole("heading", { name: "Study set ready" })).toBeFocused();
  await expect(page.getByRole("button", { name: /Save/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("mapping-ready.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  expect(await page.locator(".app-shell").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(720);
  await page.getByRole("link", { name: "Import study set" }).click();
  await expect(page.getByRole("region", { name: "Structured mapping" })).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.context().unroute("**/*");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Import study material" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Study set ready" })).toHaveCount(0);
});

test("all-record validation finds a later issue and shows unchanged source values", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop"].includes(testInfo.project.name), "Detailed flows run on phone and desktop.");
  await page.goto("/import");
  await upload(page, [good, good, good, { ...good, answer: 8 }]);
  await map(page);
  const preview = page.getByRole("region", { name: "A first look" });
  await expect(preview.getByRole("article")).toHaveCount(3);
  await expect(preview).not.toContainText("needs attention");
  await page.getByRole("button", { name: "Validate all records" }).click();
  const result = page.getByRole("region", { name: "Final validation: needs attention" });
  await expect(result).toContainText("4 records inspected · 3 ready · 1 needs attention");
  await expect(page.getByRole("heading", { name: "Final validation: needs attention" })).toBeFocused();
  await page.getByRole("button", { name: /^Record 4 · Correct answer/ }).click();
  const inspection = page.getByRole("region", { name: "Inspect record 4" });
  await expect(inspection).toContainText("Index 8 is outside the 3 available answers");
  await expect(inspection.getByText("8", { exact: true })).toBeVisible();
  await expect(inspection).toContainText("Transformed preview");
  await expect(inspection.getByRole("heading", { name: "Inspect record 4" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Study set ready" })).toHaveCount(0);
  await noOverflow(page);
  await result.screenshot({ path: testInfo.outputPath("mapping-issue.png") });
  await page.getByRole("button", { name: "Choose another file" }).click();
  await expect(page.getByRole("region", { name: "Structured mapping" })).toHaveCount(0);
  await expect(page.getByLabel("Study material file")).toBeFocused();
});

test("mapping responsive hierarchy and long source values remain usable", async ({ page }, testInfo) => {
  await page.goto("/import");
  const longField = "source_field_" + "unbroken".repeat(16);
  const longAnswer = "Answer with a long explanation " + "readable content ".repeat(12);
  await upload(page, [{
    details: { [longField]: "A long question with an unbroken reference " + "REFERENCE".repeat(30) },
    a: [longAnswer, "Second answer"], answer: 5,
  }], "mapping-" + "source".repeat(20) + ".json");
  await map(page, { prompt: ["details", longField], choices: ["a"], answer: ["answer"] });
  const controls = page.getByRole("region", { name: "Give your data meaning" });
  await expect(controls).toBeVisible();
  await expect(page.getByRole("region", { name: "A first look" })).toContainText("needs attention");
  await noOverflow(page);
  const shellWidth = await page.locator(".app-shell").evaluate((element) => element.getBoundingClientRect().width);
  if (testInfo.project.name === "desktop" || testInfo.project.name === "large-desktop") {
    expect(shellWidth).toBeGreaterThan(1100);
    expect(shellWidth).toBeLessThanOrEqual(1300);
    const boxes = await Promise.all([".mapping-source", ".mapping-controls", ".mapping-preview"].map((selector) => page.locator(selector).boundingBox()));
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  } else {
    const boxes = await Promise.all([".mapping-source", ".mapping-controls", ".mapping-preview"].map((selector) => page.locator(selector).boundingBox()));
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
  }
  await page.screenshot({ path: testInfo.outputPath("mapping-layout.png"), fullPage: true });
  await page.locator(".mapping-controls").screenshot({ path: testInfo.outputPath("mapping-controls.png") });
  await page.locator(".mapping-preview").screenshot({ path: testInfo.outputPath("mapping-preview.png") });
  await page.getByRole("button", { name: "Validate all records" }).click();
  await page.getByRole("button", { name: /^Record 1 · Correct answer/ }).click();
  await noOverflow(page);
  await page.locator(".validation-result").screenshot({ path: testInfo.outputPath("mapping-validation.png") });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await noOverflow(page);
});
