import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { StudySet } from "@openstudy/schema";

const fixture: StudySet = {
  schemaVersion: "1.0.0", id: "set.core-ui", revision: 1, title: "Cities",
  sources: [{ id: "source.quiz", label: "Quiz", originalFilename: "cities.json" }],
  categories: [{ id: "category.europe", label: "Europe" }],
  questions: [
    { id: "q.portugal", type: "single-choice", prompt: "Capital of Portugal?", categoryIds: ["category.europe"],
      choices: [{ id: "c.porto", text: "Porto" }, { id: "c.lisbon", text: "Lisbon" }],
      correctChoiceId: "c.lisbon", explanation: "Lisbon is the capital." },
    { id: "q.france", type: "single-choice", prompt: "Capital of France?",
      choices: [{ id: "c.paris", text: "Paris" }, { id: "c.lyon", text: "Lyon" }],
      correctChoiceId: "c.paris", explanation: "Paris is the capital." },
    { id: "q.germany", type: "single-choice", prompt: "Capital of Germany?",
      choices: [{ id: "c.berlin", text: "Berlin" }, { id: "c.bonn", text: "Bonn" }],
      correctChoiceId: "c.berlin", explanation: "Berlin is the capital." },
  ],
};

async function seed(page: Page, value = fixture) {
  await page.evaluate(async (set) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openstudy-library");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["studySets", "libraryEntries"], "readwrite");
      tx.objectStore("studySets").put(set);
      tx.objectStore("libraryEntries").put({ id: set.id, title: set.title, revision: set.revision,
        questionCount: set.questions.length, categoryCount: set.categories.length, sourceCount: set.sources.length });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, value);
  await page.reload();
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
}
async function chrome(page: Page, focused: boolean) {
  await expect(page.locator("[data-study-session]")).toHaveCount(focused ? 1 : 0);
  const header = page.getByRole("banner", { includeHidden: true });
  const footer = page.getByRole("contentinfo", { includeHidden: true });
  if (focused) {
    await expect(header).toBeHidden(); await expect(footer).toBeHidden();
    await expect(page.getByRole("link", { name: "OpenStudy library" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Exit session" })).toBeVisible();
  } else { await expect(header).toBeVisible(); await expect(footer).toBeVisible(); }
  await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
}
async function position(page: Page, label: "Question" | "Card" | "Mistake", current: number, total: number) {
  await expect(page.getByText(`${label} ${current} of ${total}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: `${label} position` })).toHaveAttribute("value", String(current));
  await expect(page.getByRole("progressbar", { name: `${label} position` })).toHaveAttribute("max", String(total));
}

test("core screens keep focused chrome, private answers and clear results", async ({ page }, info) => {
  test.skip(!["mobile-390", "desktop"].includes(info.project.name));
  const width = page.viewportSize()!.width;
  const folder = resolve("../../test-results/core-ui-polish/after", String(width));
  await mkdir(folder, { recursive: true });
  const shot = async (name: string) => {
    await noOverflow(page); await page.mouse.move(0, 0);
    await page.screenshot({ path: resolve(folder, `${name}.png`), fullPage: true });
  };
  await page.goto("/"); await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  await chrome(page, false); await shot("01-library-empty");
  await seed(page); await expect(page.getByRole("link", { name: /Cities.*3 questions/ })).toBeVisible();
  await shot("02-library-populated"); await page.getByRole("link", { name: /Cities.*3 questions/ }).click();
  for (const mode of ["Learn", "Flashcards", "Test"]) {
    await expect(page.getByRole("region", { name: "Study", exact: true }).getByRole("link", { name: mode, exact: true })).toBeVisible();
  }
  await expect(page.getByText("cities.json", { exact: true })).toBeHidden();
  await shot("03-study-set");
  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start learning" })).toBeVisible();
  await chrome(page, false); await shot("04-learn-setup");
  await page.getByLabel("Questions", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused();
  await chrome(page, true); await position(page, "Question", 1, 2);
  await expect(page.getByLabel("Topic / category")).toHaveCount(0); await shot("05-learn-unanswered");
  await page.getByRole("radio", { name: "Porto", exact: true }).check();
  const selectedSurface = await page.getByRole("radio", { name: "Porto", exact: true }).locator("..").evaluate((row) => getComputedStyle(row).backgroundColor);
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Not quite. Try another answer.", { exact: true })).toBeVisible();
  await expect(page.getByText("Incorrect selection", { exact: true })).toBeVisible();
  // Feedback must override the neutral selected surface; no exact color coupling.
  const incorrectSurface = await page.getByRole("radio", { name: /Porto/ }).locator("..").evaluate((row) => getComputedStyle(row).backgroundColor);
  expect(incorrectSurface).not.toBe(selectedSurface);
  await expect(page.getByText("Correct answer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lisbon is the capital.")).toHaveCount(0); await shot("06-learn-wrong");
  await page.getByRole("radio", { name: "Lisbon", exact: true }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByRole("heading", { name: "Correct.", exact: true })).toBeFocused();
  await expect(page.getByText("Lisbon is the capital.")).toBeVisible(); await shot("07-learn-correct");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: "Paris", exact: true }).check();
  await page.getByRole("button", { name: "Check answer" }).click(); await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeFocused();
  await chrome(page, true); await shot("16-learn-summary");
  await page.getByRole("button", { name: "Study again" }).click();
  await expect(page.getByRole("heading", { name: "Learn “Cities”" })).toBeFocused(); await chrome(page, false);
  await page.getByRole("link", { name: "Back to study set" }).click();

  await page.getByRole("link", { name: "Flashcards", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start flashcards" })).toBeVisible(); await shot("08-flashcards-setup");
  await page.getByLabel("Cards", { exact: true }).fill("2"); await page.getByRole("button", { name: "Start flashcards" }).click();
  await chrome(page, true); await position(page, "Card", 1, 2);
  await expect(page.getByRole("button", { name: "Again", exact: true })).toHaveCount(0);
  await expect(page.getByText("Lisbon", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lisbon is the capital.")).toHaveCount(0); await shot("09-flashcard-front");
  await page.getByRole("button", { name: "Reveal answer" }).click();
  await expect(page.getByRole("heading", { name: "Correct answer", exact: true })).toBeFocused();
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible(); await shot("10-flashcard-revealed");
  await page.getByRole("button", { name: "Know it", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Capital of France?" })).toBeFocused();
  await position(page, "Card", 2, 2); await page.getByRole("button", { name: "Reveal answer" }).click();
  await page.getByRole("button", { name: "Again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeFocused();
  await chrome(page, true); await shot("17-flashcard-summary");
  await page.getByRole("link", { name: "Back to study set" }).click();

  await page.getByRole("link", { name: "Test", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start test" })).toBeVisible(); await shot("11-test-setup");
  await page.getByRole("checkbox", { name: "Shuffle questions" }).uncheck(); await page.getByRole("button", { name: "Start test" }).click();
  await page.getByRole("radio", { name: "Porto", exact: true }).check();
  await chrome(page, true); await position(page, "Question", 1, 3);
  await expect(page.locator("[data-feedback]")).toHaveCount(0);
  await expect(page.getByText("Lisbon is the capital.")).toHaveCount(0); await shot("12-test-active");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await page.getByRole("radio", { name: "Paris", exact: true }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click(); await page.getByRole("button", { name: "Finish test" }).click();
  await expect(page.getByRole("button", { name: "Keep working" })).toBeFocused(); await shot("15-test-confirmation");
  await page.getByRole("button", { name: "Submit test" }).click();
  await expect(page.getByRole("heading", { name: "Test complete" })).toBeFocused(); await chrome(page, true);
  await expect(page.getByText("1 / 3", { exact: true })).toBeVisible(); await expect(page.getByText("33%", { exact: true })).toBeVisible();
  await shot("13-test-results"); await page.getByRole("button", { name: "Review mistakes" }).click();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused();
  await chrome(page, true); await position(page, "Mistake", 1, 2); await shot("14-test-mistake");
  await page.getByRole("button", { name: "Back to results" }).click(); await page.getByRole("button", { name: "Take another test" }).click();
  await expect(page.getByRole("heading", { name: "Test “Cities”" })).toBeFocused(); await chrome(page, false);
});

test("focused study supports native keyboard selection, skip link and forced colors", async ({ page }, info) => {
  test.skip(!["mobile-320", "desktop"].includes(info.project.name));
  await page.goto("/"); await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible(); await seed(page);
  await page.getByRole("link", { name: /Cities.*3 questions/ }).click(); await page.getByRole("link", { name: "Learn", exact: true }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(page.getByRole("link", { name: "Exit session" })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Exit session" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("radio", { name: "Porto", exact: true })).toBeFocused();
  await expect(page.getByRole("radio", { name: "Porto", exact: true })).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("ArrowDown"); await expect(page.getByRole("radio", { name: "Lisbon", exact: true })).toBeChecked();
  await page.keyboard.press("Space");
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Check answer" }).click(); await expect(page.getByRole("heading", { name: "Correct." })).toBeFocused();
  await expect(page.getByText("Correct answer", { exact: true })).toBeVisible();
  for (const radio of await page.getByRole("radio").all()) {
    const bounds = await radio.locator("..").boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  const folder = resolve("../../test-results/core-ui-polish/accessibility"); await mkdir(folder, { recursive: true });
  await page.screenshot({ path: resolve(folder, `forced-colors-${page.viewportSize()!.width}.png`), fullPage: true });
});

test("long core content and six answer rows reflow at 200 percent text", async ({ page }, info) => {
  const long = structuredClone(fixture);
  const token = "longunbrokenstudycontent".repeat(8);
  long.title = `Study set with a long title ${token}`;
  long.sources[0]!.originalFilename = `${token}.json`; long.categories[0]!.label = `Long topic ${token}`;
  long.questions[0]!.prompt = `A very long question that must remain readable ${token}`;
  long.questions[0]!.choices = Array.from({ length: 6 }, (_, index) => ({ id: `choice.${index}`, text: `Answer ${index + 1} ${token}` }));
  long.questions[0]!.correctChoiceId = "choice.5"; long.questions[0]!.explanation = `Explanation ${token}`;
  await page.goto("/"); await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible(); await seed(page, long);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await noOverflow(page); await page.getByRole("link", { name: /Study set with a long title/ }).click(); await noOverflow(page);
  await page.locator("summary").filter({ hasText: "Sources" }).click(); await expect(page.getByText(`${token}.json`, { exact: true })).toBeVisible(); await noOverflow(page);
  for (const mode of ["Learn", "Flashcards", "Test"] as const) {
    await page.getByRole("link", { name: mode, exact: true }).click();
    await expect(page.getByLabel("Topic / category")).toBeVisible(); await noOverflow(page);
    await page.getByLabel("Topic / category").selectOption("category.europe");
    await page.getByRole("button", { name: mode === "Learn" ? "Start learning" : `Start ${mode.toLowerCase()}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: long.questions[0]!.prompt })).toBeFocused();
    await chrome(page, true); await noOverflow(page);
    // At enlarged text the quiet set title must wrap across a readable width,
    // rather than collapsing to a sliver beside Exit despite no page overflow.
    const contextWidth = await page.locator(".session-context").evaluate((element) => element.getBoundingClientRect().width);
    expect(contextWidth).toBeGreaterThanOrEqual(Math.min(240, page.viewportSize()!.width - 32));
    if (mode === "Flashcards") {
      await expect(page.getByText(long.questions[0]!.explanation!)).toHaveCount(0);
      await page.getByRole("button", { name: "Reveal answer" }).click();
      await expect(page.getByText(long.questions[0]!.explanation!)).toBeVisible();
    } else {
      await expect(page.getByRole("radio")).toHaveCount(6);
      const rows = await page.getByRole("radio").evaluateAll((radios) => radios.map((radio) => {
        const row = radio.closest("label")!;
        return { row: row.getBoundingClientRect().width, text: row.querySelector(".answer-text")!.getBoundingClientRect().width };
      }));
      for (const widths of rows) expect(widths.text).toBeGreaterThan(widths.row / 2);
      await page.getByRole("radio", { name: long.questions[0]!.choices[5]!.text, exact: true }).check();
      if (mode === "Learn") {
        await page.getByRole("button", { name: "Check answer" }).click();
        await expect(page.getByText(long.questions[0]!.explanation!)).toBeVisible();
      } else {
        await expect(page.locator("[data-feedback]")).toHaveCount(0);
        await expect(page.getByText(long.questions[0]!.explanation!)).toHaveCount(0);
        await page.getByRole("button", { name: "Finish test" }).click();
        await expect(page.getByRole("heading", { name: "Test complete" })).toBeFocused();
      }
    }
    await noOverflow(page);
    const folder = resolve("../../test-results/core-ui-polish/accessibility"); await mkdir(folder, { recursive: true });
    await page.screenshot({ path: resolve(folder, `${info.project.name}-${mode.toLowerCase()}-text-200.png`), fullPage: true });
    await page.getByRole("link", { name: "Exit session" }).click();
  }
});
