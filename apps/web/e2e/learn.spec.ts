import { expect, test, type Page } from "@playwright/test";

const studySet = {
  schemaVersion: "1.0.0", id: "set.cities", revision: 1, title: "Cities",
  sources: [{ id: "source.quiz", label: "Quiz" }],
  categories: [{ id: "category.europe", label: "Europe" }],
  questions: [
    { id: "question.portugal", type: "single-choice", prompt: "Capital of Portugal?",
      choices: [{ id: "choice.porto", text: "Porto" }, { id: "choice.lisbon", text: "Lisbon" }],
      correctChoiceId: "choice.lisbon", explanation: "Lisbon is the capital.", categoryIds: ["category.europe"] },
    { id: "question.france", type: "single-choice", prompt: "Capital of France?",
      choices: [{ id: "choice.paris", text: "Paris" }, { id: "choice.lyon", text: "Lyon" }],
      correctChoiceId: "choice.paris", categoryIds: ["category.europe"] },
  ],
};

async function seed(page: Page, questions = 2, longContent = false) {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  const value = structuredClone({ ...studySet, questions: studySet.questions.slice(0, questions) });
  if (longContent) {
    value.questions[0]!.prompt = "What does this exceptionallylongunbrokentokenwithoutspacesinthequestion mean for the capital of Portugal?";
    value.questions[0]!.choices[0]!.text = "Porto with an exceptionallylongunbrokentokenwithoutspacesintheanswer";
    value.questions[0]!.explanation = "Lisbon is the capital. exceptionallylongunbrokentokenwithoutspacesintheexplanation";
  }
  await page.evaluate(async (set) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("openstudy-library"); request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["studySets", "libraryEntries"], "readwrite");
      tx.objectStore("studySets").put(set);
      tx.objectStore("libraryEntries").put({ id: set.id, title: set.title, revision: set.revision,
        questionCount: set.questions.length, categoryCount: set.categories.length, sourceCount: set.sources.length });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, value);
  await page.goto("/study-sets/set.cities");
  await expect(page.getByRole("link", { name: "Learn" })).toBeVisible();
}

async function readProgress(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("openstudy-library"); request.onsuccess = () => resolve(request.result);
    });
    const values = await new Promise<{ studySetId: string; questionId: string; attempts: number; firstAttemptCorrect: boolean;
      eventualCorrect: boolean; needsReview: boolean }[]>((resolve) => {
      const request = db.transaction("userProgress").objectStore("userProgress").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return values;
  });
}

test("Learn retries without revealing the answer, completes, persists progress and deletes it with the set", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop"].includes(testInfo.project.name));
  await seed(page);
  await page.getByRole("link", { name: "Learn" }).click();
  await expect(page.getByRole("heading", { name: "Learn “Cities”" })).toBeVisible();
  await expect(page.getByLabel("Questions")).toHaveValue("2");
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused();
  await expect(page.getByLabel("Questions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check answer" })).toBeDisabled();
  await page.getByRole("radio", { name: "Porto" }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByRole("status")).toContainText("Not quite. Try another answer.");
  await expect(page.getByText("Correct answer")).toHaveCount(0);
  await expect(page.getByText("Lisbon is the capital.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect.poll(async () => (await readProgress(page))[0]?.attempts).toBe(1);
  await page.getByRole("button", { name: "Clear answer" }).click();
  await expect(page.getByRole("button", { name: "Check answer" })).toBeDisabled();
  await page.getByRole("radio", { name: "Lisbon" }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByRole("heading", { name: "Correct." })).toBeFocused();
  await expect(page.getByText("Lisbon is the capital.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Capital of France?" })).toBeFocused();
  await page.getByRole("radio", { name: "Paris" }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeFocused();
  await expect(page.getByText("1 correct on the first try")).toBeVisible();
  await expect(page.getByText("1 needed another attempt")).toBeVisible();
  await expect.poll(async () => (await readProgress(page)).length).toBe(2);
  const records = await readProgress(page);
  expect(records.find((item) => item.questionId === "question.portugal")).toMatchObject({
    attempts: 2, firstAttemptCorrect: false, eventualCorrect: true, needsReview: true,
  });
  await page.getByRole("button", { name: "Study again" }).click();
  await expect(page.getByRole("heading", { name: "Learn “Cities”" })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("button", { name: "Start learning" })).toBeVisible();
  expect(await readProgress(page)).toEqual(records);
  await page.getByRole("link", { name: "Back to study set" }).click();
  await page.getByRole("button", { name: "Delete study set" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  expect(await readProgress(page)).toEqual([]);
});

test("double-clicking Check answer leaves feedback visible until a separate Continue activation", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop"].includes(testInfo.project.name));
  await seed(page);
  await page.getByRole("link", { name: "Learn" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await page.getByRole("radio", { name: "Porto" }).check();
  await page.getByRole("button", { name: "Check answer" }).dblclick();
  await expect(page.getByRole("status")).toContainText("Not quite. Try another answer.");
  await expect(page.getByText("Lisbon is the capital.")).toHaveCount(0);
  await expect.poll(async () => (await readProgress(page))[0]?.attempts).toBe(1);
  await page.getByRole("radio", { name: "Lisbon" }).check();
  await page.getByRole("button", { name: "Check answer" }).dblclick();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Correct." })).toBeVisible();
  await expect(page.getByText("Lisbon is the capital.")).toBeVisible();
  await expect.poll(async () => (await readProgress(page))[0]?.attempts).toBe(2);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: "Paris" }).check();
  await page.getByRole("button", { name: "Check answer" }).dblclick();
  await expect(page.getByRole("heading", { name: "Capital of France?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Correct." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Session complete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeFocused();
});

test("Add Material preserves progress on a matching question and gives new questions no progress", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await seed(page, 1);
  await page.getByRole("link", { name: "Learn" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await page.getByRole("radio", { name: "Lisbon" }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect.poll(async () => (await readProgress(page)).length).toBe(1);
  await page.getByRole("link", { name: "Exit session" }).click();
  await page.getByRole("link", { name: "Add material" }).click();
  const rows = [
    { q: "Capital of Portugal?", a: ["Porto", "Lisbon"], answer: 1, topic: "Europe", explanation: "Lisbon is the capital." },
    { q: "Capital of France?", a: ["Paris", "Lyon"], answer: 0, topic: "Europe" },
  ];
  await page.getByLabel("Study material file").setInputFiles({ name: "more.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rows)) });
  await page.getByLabel("Question (required)", { exact: true }).selectOption('["q"]');
  await page.getByLabel("Answers (required)", { exact: true }).selectOption('["a"]');
  await page.getByLabel("Correct answer (required)", { exact: true }).selectOption('["answer"]');
  await page.getByRole("radio", { name: /^Zero-based index/ }).check();
  await page.getByLabel("Topic / category (optional)", { exact: true }).selectOption('["topic"]');
  await page.getByLabel("Explanation (optional)", { exact: true }).selectOption('["explanation"]');
  await page.getByRole("button", { name: "Validate all records" }).click();
  await expect(page.getByText(/1 new · 1 already exist/)).toBeVisible();
  await page.getByRole("button", { name: "Update study set" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  const progress = await readProgress(page);
  expect(progress).toHaveLength(1);
  expect(progress[0]!.questionId).toBe("question.portugal");
  await page.getByRole("link", { name: "Learn" }).click();
  await expect(page.getByText("2 questions available")).toBeVisible();
});

test("Learn reflows long content at 200% text size", async ({ page }, testInfo) => {
  await seed(page, 1, true);
  await page.getByRole("link", { name: "Learn" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.screenshot({ path: testInfo.outputPath("learn-active.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByRole("status")).toContainText("Not quite");
  await page.getByRole("radio", { name: "Lisbon" }).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText(/exceptionallylongunbrokentokenwithoutspacesintheexplanation/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Learn answers can be selected with the keyboard and expose visible focus", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop"].includes(testInfo.project.name));
  await seed(page, 1);
  await page.getByRole("link", { name: "Learn" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Porto" })).toBeFocused();
  const outline = await page.getByRole("radio", { name: "Porto" }).evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Lisbon" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Clear answer" })).toBeFocused();
});
