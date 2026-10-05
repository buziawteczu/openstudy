import { expect, test, type Page } from "@playwright/test";
import type { StudySet } from "@openstudy/schema";

const studySet: StudySet = {
  schemaVersion: "1.0.0", id: "set.cards", revision: 1, title: "Cities",
  sources: [{ id: "source.quiz", label: "Quiz" }], categories: [{ id: "category.europe", label: "Europe" }],
  questions: [
    { id: "question.portugal", type: "single-choice", prompt: "Capital of Portugal?",
      choices: [{ id: "choice.porto", text: "Porto" }, { id: "choice.lisbon", text: "Lisbon" }],
      correctChoiceId: "choice.lisbon", explanation: "Lisbon is the capital.", categoryIds: ["category.europe"] },
    { id: "question.france", type: "single-choice", prompt: "Capital of France?",
      choices: [{ id: "choice.paris", text: "Paris" }, { id: "choice.lyon", text: "Lyon" }], correctChoiceId: "choice.paris" },
  ],
};
async function seed(page: Page, count = 2, long = false) {
  await page.goto("/"); await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  const value = structuredClone({ ...studySet, questions: studySet.questions.slice(0, count) });
  if (long) {
    const token = "exceptionallylongunbrokentoken".repeat(8);
    value.questions[0]!.prompt += ` ${token}`;
    value.questions[0]!.choices[1]!.text += ` ${token}`;
    value.questions[0]!.explanation += ` ${token}`;
  }
  await page.evaluate(async (set) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openstudy-library"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["studySets", "libraryEntries"], "readwrite");
      tx.objectStore("studySets").put(set); tx.objectStore("libraryEntries").put({ id: set.id, title: set.title, revision: set.revision,
        questionCount: set.questions.length, categoryCount: set.categories.length, sourceCount: set.sources.length });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, value);
  await page.goto("/study-sets/set.cards"); await expect(page.getByRole("link", { name: "Flashcards" })).toBeVisible();
}
async function readStore(page: Page, store: string) {
  return page.evaluate(async (storeName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("openstudy-library"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const records = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); db.close(); return records;
  }, store);
}
async function start(page: Page) {
  await page.getByRole("link", { name: "Flashcards", exact: true }).click();
  await page.getByRole("button", { name: "Start flashcards" }).click();
}
async function rate(page: Page, rating: "Again" | "Know it") {
  await page.getByRole("button", { name: "Reveal answer" }).click(); await page.getByRole("button", { name: rating, exact: true }).click();
}

test("Flashcards reveal privately, self-rate two cards and show a focused summary", async ({ page }, info) => {
  test.skip(!["mobile-320", "desktop"].includes(info.project.name));
  await seed(page); await page.getByRole("link", { name: "Flashcards", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flashcards “Cities”" })).toBeFocused();
  await page.getByLabel("Cards", { exact: true }).fill("2"); await page.getByRole("button", { name: "Start flashcards" }).click();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused();
  await expect(page.getByLabel("Cards", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lisbon", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Porto", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lisbon is the capital.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Again", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Know it", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reveal answer" }).click();
  await expect(page.getByRole("heading", { name: "Correct answer" })).toBeFocused();
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible(); await expect(page.getByText("Lisbon is the capital.", { exact: true })).toBeVisible();
  expect(await readStore(page, "flashcardProgress")).toEqual([]);
  await page.getByRole("button", { name: "Know it", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Capital of France?" })).toBeFocused();
  await expect(page.getByText("Paris", { exact: true })).toHaveCount(0); await expect(page.getByRole("heading", { name: "Correct answer" })).toHaveCount(0);
  await rate(page, "Again"); await expect(page.getByRole("heading", { name: "Session complete" })).toBeFocused();
  await expect(page.getByText("2 cards reviewed", { exact: true })).toBeVisible();
  await expect(page.getByText("1 Know it", { exact: true })).toBeVisible(); await expect(page.getByText("1 Again", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readStore(page, "flashcardProgress")).length).toBe(2);
  expect(await readStore(page, "userProgress")).toEqual([]); expect(await readStore(page, "studySets")).toEqual([studySet]);
  await page.getByRole("button", { name: "Study again" }).click(); await expect(page.getByRole("heading", { name: "Flashcards “Cities”" })).toBeFocused();
  await page.getByRole("link", { name: "Back to study set", exact: true }).click(); await expect(page.getByText("Saved on this device")).toBeVisible();
});
test("rated progress survives leaving and reloading while the active session does not", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop"); await seed(page); await start(page); await rate(page, "Again");
  await expect.poll(async () => (await readStore(page, "flashcardProgress")).length).toBe(1);
  const before = await readStore(page, "flashcardProgress");
  await page.getByRole("link", { name: "Exit session" }).click(); await page.reload();
  await page.getByRole("link", { name: "Flashcards", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start flashcards" })).toBeVisible();
  expect(await readStore(page, "flashcardProgress")).toEqual(before);
  await page.getByRole("button", { name: "Start flashcards" }).click(); await page.getByRole("button", { name: "Reveal answer" }).click();
  await page.reload(); await expect(page.getByRole("button", { name: "Start flashcards" })).toBeVisible();
  await expect(page.getByText("Lisbon", { exact: true })).toHaveCount(0); expect(await readStore(page, "flashcardProgress")).toEqual(before);
});
test("a Flashcard session leaves real Learn progress byte-for-byte unchanged", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop"); await seed(page);
  await page.getByRole("link", { name: "Learn", exact: true }).click(); await page.getByRole("button", { name: "Start learning" }).click();
  await page.getByRole("radio", { name: "Porto" }).check(); await page.getByRole("button", { name: "Check answer" }).click();
  await expect.poll(async () => (await readStore(page, "userProgress"))[0]?.attempts).toBe(1);
  await page.getByRole("radio", { name: "Lisbon" }).check(); await page.getByRole("button", { name: "Check answer" }).click();
  await expect.poll(async () => (await readStore(page, "userProgress"))[0]?.attempts).toBe(2);
  const before = JSON.stringify(await readStore(page, "userProgress"));
  await page.getByRole("link", { name: "Exit session" }).click(); await start(page); await rate(page, "Again"); await rate(page, "Know it");
  await expect.poll(async () => (await readStore(page, "flashcardProgress")).length).toBe(2);
  expect(JSON.stringify(await readStore(page, "userProgress"))).toBe(before);
});
test("Add Material retains Flashcard and Learn progress on exact duplicates", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop"); await seed(page, 1);
  await page.getByRole("link", { name: "Learn", exact: true }).click(); await page.getByRole("button", { name: "Start learning" }).click();
  await page.getByRole("radio", { name: "Lisbon" }).check(); await page.getByRole("button", { name: "Check answer" }).click();
  await expect.poll(async () => (await readStore(page, "userProgress")).length).toBe(1);
  await page.getByRole("link", { name: "Exit session" }).click(); await start(page); await rate(page, "Again");
  await expect.poll(async () => (await readStore(page, "flashcardProgress")).length).toBe(1);
  const beforeCards = await readStore(page, "flashcardProgress"); const beforeLearn = await readStore(page, "userProgress");
  await page.getByRole("link", { name: "Back to study set", exact: true }).click(); await page.getByRole("link", { name: "Add material" }).click();
  const rows = [{ q: "Capital of Portugal?", a: ["Porto", "Lisbon"], answer: 1, topic: "Europe", explanation: "Lisbon is the capital." },
    { q: "Capital of France?", a: ["Paris", "Lyon"], answer: 0, topic: "Europe" }];
  await page.getByLabel("Study material file").setInputFiles({ name: "more.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rows)) });
  await page.getByLabel("Question (required)", { exact: true }).selectOption('["q"]');
  await page.getByLabel("Answers (required)", { exact: true }).selectOption('["a"]');
  await page.getByLabel("Correct answer (required)", { exact: true }).selectOption('["answer"]');
  await page.getByRole("radio", { name: /^Zero-based index/ }).check();
  await page.getByLabel("Topic / category (optional)", { exact: true }).selectOption('["topic"]');
  await page.getByLabel("Explanation (optional)", { exact: true }).selectOption('["explanation"]');
  await page.getByRole("button", { name: "Validate all records" }).click();
  await expect(page.getByText(/1 new · 1 already exist/)).toBeVisible(); await page.getByRole("button", { name: "Update study set" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  expect(await readStore(page, "flashcardProgress")).toEqual(beforeCards); expect(await readStore(page, "userProgress")).toEqual(beforeLearn);
  const saved = (await readStore(page, "studySets"))[0]!;
  expect(saved.revision).toBe(2); expect(saved.questions).toHaveLength(2);
  await page.getByRole("link", { name: "Flashcards", exact: true }).click(); await expect(page.getByLabel("Cards", { exact: true })).toHaveValue("2");
});
test("deleting a StudySet removes both mode-specific progress stores", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop"); await seed(page, 1);
  await page.getByRole("link", { name: "Learn", exact: true }).click(); await page.getByRole("button", { name: "Start learning" }).click();
  await page.getByRole("radio", { name: "Lisbon" }).check(); await page.getByRole("button", { name: "Check answer" }).click();
  await expect.poll(async () => (await readStore(page, "userProgress")).length).toBe(1);
  await page.getByRole("link", { name: "Exit session" }).click(); await start(page); await rate(page, "Know it");
  await expect.poll(async () => (await readStore(page, "flashcardProgress")).length).toBe(1);
  await page.getByRole("link", { name: "Back to study set", exact: true }).click();
  await page.getByRole("button", { name: "Delete study set" }).click(); await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  for (const store of ["studySets", "libraryEntries", "userProgress", "flashcardProgress"]) expect(await readStore(page, store)).toEqual([]);
});
for (const rating of ["Again", "Know it"] as const) test(`double-clicking ${rating} reviews once and does not reveal the next card`, async ({ page }, info) => {
  test.skip(!["mobile-320", "desktop"].includes(info.project.name)); await seed(page); await start(page);
  await page.getByRole("button", { name: "Reveal answer" }).click(); await page.getByRole("button", { name: rating, exact: true }).dblclick();
  await expect(page).toHaveURL(/\/study-sets\/set\.cards\/flashcards$/);
  await expect(page.getByRole("heading", { name: "Capital of France?" })).toBeFocused();
  await expect(page.getByText("Card 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Correct answer" })).toHaveCount(0);
  await expect.poll(async () => (await readStore(page, "flashcardProgress"))[0]?.reviews).toBe(1);
  expect(await readStore(page, "flashcardProgress")).toEqual([{ studySetId: "set.cards", questionId: "question.portugal",
    reviews: 1, againCount: rating === "Again" ? 1 : 0, knowItCount: rating === "Know it" ? 1 : 0,
    lastRating: rating === "Again" ? "again" : "know-it" }]);
});
test("Flashcards keyboard flow has visible focus and comfortable controls", async ({ page }, info) => {
  test.skip(!["mobile-320", "desktop"].includes(info.project.name)); await seed(page, 1); await start(page);
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused(); await page.keyboard.press("Tab");
  const reveal = page.getByRole("button", { name: "Reveal answer" }); await expect(reveal).toBeFocused();
  expect(await reveal.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  expect((await reveal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter"); await expect(page.getByRole("heading", { name: "Correct answer" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Again", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); const know = page.getByRole("button", { name: "Know it", exact: true }); await expect(know).toBeFocused();
  expect((await know.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Space"); await expect(page.getByRole("heading", { name: "Session complete" })).toBeFocused();
});
test("Flashcards wrap long content and reflow at 200% text size", async ({ page }, info) => {
  await seed(page, 1, true); await page.getByRole("link", { name: "Flashcards", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Start flashcards" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Reveal answer" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("flashcards-revealed.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ["Again", "Know it"]) {
    const button = page.getByRole("button", { name, exact: true });
    // A readable word must fit even when the two actions need to stack.
    expect(await button.evaluate((node) => {
      const style = getComputedStyle(node);
      return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= parseFloat(style.fontSize) * 2.5;
    })).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("flashcards-200-percent.png"), fullPage: true });
  await page.getByRole("button", { name: "Again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Study again" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
