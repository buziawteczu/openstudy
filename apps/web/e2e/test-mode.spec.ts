import { expect, test, type Page } from "@playwright/test";
import type { StudySet } from "@openstudy/schema";

const studySet: StudySet = {
  schemaVersion: "1.0.0", id: "set.test", revision: 1, title: "Cities",
  sources: [{ id: "source.quiz", label: "Quiz" }], categories: [{ id: "category.europe", label: "Europe" }],
  questions: [
    { id: "q.portugal", type: "single-choice", prompt: "Capital of Portugal?",
      choices: [{ id: "c.porto", text: "Porto" }, { id: "c.lisbon", text: "Lisbon" }], correctChoiceId: "c.lisbon",
      explanation: "Lisbon is the capital.", categoryIds: ["category.europe"] },
    { id: "q.france", type: "single-choice", prompt: "Capital of France?",
      choices: [{ id: "c.paris", text: "Paris" }, { id: "c.lyon", text: "Lyon" }], correctChoiceId: "c.paris",
      explanation: "Paris is the capital." },
    { id: "q.germany", type: "single-choice", prompt: "Capital of Germany?",
      choices: [{ id: "c.berlin", text: "Berlin" }, { id: "c.bonn", text: "Bonn" }], correctChoiceId: "c.berlin",
      explanation: "Berlin is the capital." },
  ],
};
async function seed(page: Page, long = false) {
  await page.goto("/"); await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  const value = structuredClone(studySet);
  if (long) {
    const token = "longunbrokenquestionandanswercontent".repeat(8);
    value.questions[0]!.prompt += ` ${token}`; value.questions[0]!.choices[1]!.text += ` ${token}`;
    value.questions[0]!.explanation += ` ${token}`;
  }
  await page.evaluate(async (set) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("openstudy-library");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["studySets", "libraryEntries"], "readwrite"); tx.objectStore("studySets").put(set);
      tx.objectStore("libraryEntries").put({ id: set.id, title: set.title, revision: 1, questionCount: 3, categoryCount: 1, sourceCount: 1 });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, value);
  await page.goto("/study-sets/set.test"); await expect(page.getByRole("link", { name: "Test", exact: true })).toBeVisible();
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("openstudy-library");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const names = Array.from(db.objectStoreNames);
    const stores: Record<string, unknown[]> = {};
    for (const name of names) stores[name] = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const version = db.version; db.close(); return { version, names, stores };
  });
}
async function start(page: Page, count = 3, shuffle = false) {
  await page.getByRole("link", { name: "Test", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Test “Cities”" })).toBeFocused();
  await page.getByLabel("Questions", { exact: true }).fill(String(count));
  await page.getByRole("checkbox", { name: "Shuffle questions" }).setChecked(shuffle);
  await page.getByRole("button", { name: "Start test" }).click();
}
async function next(page: Page) { await page.getByRole("button", { name: "Next", exact: true }).click(); }
async function finishUnanswered(page: Page) {
  await next(page); await next(page); await page.getByRole("button", { name: "Finish test" }).click();
  await page.getByRole("button", { name: "Submit test" }).click();
}
async function privateActive(page: Page) {
  await expect(page.getByRole("heading", { name: "Correct answer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Explanation", exact: true })).toHaveCount(0);
  await expect(page.getByText(/^(Correct|Incorrect|Not quite\. Try another answer\.)$/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check answer" })).toHaveCount(0);
  await expect(page.getByLabel(/correct answer|incorrect|explanation/i)).toHaveCount(0);
  for (const question of studySet.questions) await expect(page.getByText(question.explanation!, { exact: false })).toHaveCount(0);
  await expect(page.locator(".answer-correct, .correct-label, .text-success, [aria-live]")).toHaveCount(0);
}
const detailed = (project: string) => ["mobile-320", "desktop"].includes(project);

test("Test answers can change, navigation retains them, and results review only mistakes", async ({ page }, info) => {
  test.skip(!detailed(info.project.name)); await seed(page); await start(page);
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused();
  await expect(page.getByLabel("Questions", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "Porto", exact: true }).check();
  await page.getByRole("button", { name: "Clear answer" }).click(); await expect(page.getByRole("radio", { name: "Porto", exact: true })).not.toBeChecked();
  await page.getByRole("radio", { name: "Lisbon", exact: true }).check(); await next(page);
  await page.getByRole("radio", { name: "Lyon", exact: true }).check();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Lisbon", exact: true })).toBeChecked();
  await next(page); await expect(page.getByRole("radio", { name: "Lyon", exact: true })).toBeChecked();
  await next(page); await page.getByRole("radio", { name: "Bonn", exact: true }).check(); await page.getByRole("radio", { name: "Berlin", exact: true }).check();
  await page.getByRole("button", { name: "Finish test" }).click();
  await expect(page.getByRole("heading", { name: "Test complete" })).toBeFocused();
  for (const text of ["2 / 3", "67%", "2 correct", "1 incorrect", "0 unanswered"]) await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.getByRole("button", { name: "Review mistakes" }).click(); await expect(page.getByRole("heading", { name: "Capital of France?" })).toBeFocused();
  await expect(page.getByText("Mistake 1 of 1", { exact: true })).toBeVisible();
  for (const text of ["Lyon", "Paris", "Paris is the capital."]) await expect(page.getByText(text, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click(); await expect(page.getByRole("heading", { name: "Test complete" })).toBeFocused();
  await page.getByRole("link", { name: "Back to study set", exact: true }).click(); await expect(page.getByText("Saved on this device")).toBeVisible();
});

test("Test does not reveal correctness or explanation until final submission", async ({ page }, info) => {
  test.skip(!detailed(info.project.name)); await seed(page); await start(page);
  // The correct choice is an ordinary option, with no answer-key identification.
  await expect(page.getByRole("radio", { name: "Lisbon", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Porto", exact: true }).check(); await privateActive(page);
  await next(page); await privateActive(page); await page.getByRole("button", { name: "Previous", exact: true }).click(); await privateActive(page);
  await expect(page.getByRole("radio", { name: "Porto", exact: true })).toBeChecked();
  await next(page); await page.getByRole("radio", { name: "Paris", exact: true }).check();
  await next(page); await page.getByRole("radio", { name: "Berlin", exact: true }).check(); await privateActive(page);
  await page.getByRole("button", { name: "Finish test" }).click(); await page.getByRole("button", { name: "Review mistakes" }).click();
  await expect(page.getByRole("heading", { name: "Correct answer", exact: true })).toBeVisible();
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible(); await expect(page.getByText("Lisbon is the capital.", { exact: true })).toBeVisible();
});

test("unanswered confirmation can be cancelled and unanswered receives zero credit", async ({ page }, info) => {
  test.skip(!detailed(info.project.name)); await seed(page); await start(page); await next(page);
  await page.getByRole("radio", { name: "Paris", exact: true }).check(); await next(page);
  await page.getByRole("button", { name: "Finish test" }).click();
  await expect(page.getByRole("group", { name: "2 questions are unanswered." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep working" })).toBeFocused(); await privateActive(page);
  await page.getByRole("button", { name: "Keep working" }).click(); await expect(page.getByRole("button", { name: "Finish test" })).toBeFocused();
  await page.getByRole("radio", { name: "Berlin", exact: true }).check(); await page.getByRole("button", { name: "Finish test" }).click();
  await expect(page.getByText("1 question is unanswered.", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Submit test" }).click();
  await expect(page.getByText("67%", { exact: true })).toBeVisible(); await expect(page.getByText("0 incorrect", { exact: true })).toBeVisible();
  await expect(page.getByText("1 unanswered", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Review mistakes" }).click();
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused(); await expect(page.getByText("No answer", { exact: true })).toBeVisible();
});

test("shuffle changes the eligible order once without duplicates or choice shuffling", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.addInitScript(() => { Math.random = () => 0; });
  await seed(page); await start(page, 3, true);
  const order: string[] = [];
  for (let index = 0; index < 3; index++) {
    const prompt = await page.getByRole("heading", { level: 1 }).innerText(); order.push(prompt);
    const canonical = studySet.questions.find((question) => question.prompt === prompt)!;
    expect(await page.getByRole("radio").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))).toEqual(canonical.choices.map((choice) => choice.id));
    if (index < 2) await next(page);
  }
  expect(new Set(order).size).toBe(3); expect([...order].sort()).toEqual(studySet.questions.map((q) => q.prompt).sort());
  expect(order).not.toEqual(studySet.questions.map((q) => q.prompt));
  for (let index = 1; index >= 0; index--) {
    await page.getByRole("button", { name: "Previous", exact: true }).click(); await expect(page.getByRole("heading", { level: 1 })).toHaveText(order[index]!);
  }
  await page.getByRole("radio").first().check(); await next(page); await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(order[0]!); await expect(page.getByRole("radio").first()).toBeChecked();
});

test("Test never changes real Learn or Flashcard progress, canonical revision, or database layout", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop"); await seed(page);
  await page.getByRole("link", { name: "Learn", exact: true }).click(); await page.getByRole("button", { name: "Start learning" }).click();
  await page.getByRole("radio", { name: "Porto", exact: true }).check(); await page.getByRole("button", { name: "Check answer" }).click();
  await expect.poll(async () => (await records(page)).stores.userProgress?.length).toBe(1);
  await page.getByRole("radio", { name: "Lisbon", exact: true }).check(); await page.getByRole("button", { name: "Check answer" }).click();
  await expect.poll(async () => ((await records(page)).stores.userProgress?.[0] as { attempts: number })?.attempts).toBe(2);
  await page.getByRole("link", { name: "Exit session" }).click(); await page.getByRole("link", { name: "Flashcards", exact: true }).click();
  await page.getByLabel("Cards", { exact: true }).fill("1"); await page.getByRole("button", { name: "Start flashcards" }).click();
  await page.getByRole("button", { name: "Reveal answer" }).click(); await page.getByRole("button", { name: "Again", exact: true }).click();
  await expect.poll(async () => (await records(page)).stores.flashcardProgress?.length).toBe(1);
  await page.getByRole("link", { name: "Back to study set", exact: true }).click();
  const before = JSON.stringify(await records(page)); await start(page); await page.getByRole("radio", { name: "Porto", exact: true }).check(); await finishUnanswered(page);
  expect(JSON.stringify(await records(page))).toBe(before);
  const snapshot = await records(page); expect(snapshot.version).toBe(3);
  expect(snapshot.names).toEqual(["flashcardProgress", "libraryEntries", "studySets", "userProgress"]); expect(snapshot.stores.studySets).toEqual([studySet]);
});

for (const phase of ["active", "results", "review"] as const) test(`reload discards ${phase} Test state`, async ({ page }, info) => {
  test.skip(info.project.name !== "desktop"); await seed(page); const before = JSON.stringify(await records(page)); await start(page);
  await page.getByRole("radio", { name: "Porto", exact: true }).check();
  if (phase !== "active") await finishUnanswered(page);
  if (phase === "review") await page.getByRole("button", { name: "Review mistakes" }).click();
  await page.reload(); await expect(page.getByRole("button", { name: "Start test" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Shuffle questions" })).toBeChecked();
  await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByRole("heading", { name: "Test complete" })).toHaveCount(0);
  expect(JSON.stringify(await records(page))).toBe(before);
});

test("double Test navigation, Finish, Submit and Take another test advance only once", async ({ page }, info) => {
  test.skip(!detailed(info.project.name)); await seed(page); await start(page);
  await page.getByRole("button", { name: "Next", exact: true }).dblclick(); await expect(page.getByText("Question 2 of 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).dblclick(); await expect(page.getByText("Question 3 of 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep working" })).toHaveCount(0);
  await page.getByRole("button", { name: "Previous", exact: true }).dblclick(); await expect(page.getByText("Question 2 of 3", { exact: true })).toBeVisible();
  await next(page); await page.getByRole("button", { name: "Finish test" }).dblclick();
  await expect(page.getByText("3 questions are unanswered.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test complete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Submit test" }).dblclick(); await expect(page.getByRole("heading", { name: "Test complete" })).toBeFocused();
  await expect(page.getByText("0 / 3", { exact: true })).toBeVisible(); await expect(page).toHaveURL(/\/study-sets\/set\.test\/test$/);
  await page.getByRole("button", { name: "Take another test" }).dblclick(); await expect(page.getByRole("heading", { name: "Test “Cities”" })).toBeFocused();
  await expect(page.getByLabel("Questions", { exact: true })).toHaveValue("3"); await expect(page.getByRole("radio")).toHaveCount(0);
});

test("mistake navigation remains in Test after double clicks", async ({ page }, info) => {
  test.skip(!detailed(info.project.name)); await seed(page); await start(page); await finishUnanswered(page);
  await page.getByRole("button", { name: "Review mistakes" }).click();
  await page.getByRole("button", { name: "Next mistake" }).dblclick(); await expect(page.getByText("Mistake 2 of 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous mistake" }).dblclick(); await expect(page.getByText("Mistake 1 of 3", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/study-sets\/set\.test\/test$/);
});

test("Test keyboard operation preserves native radio behavior and visible focus", async ({ page }, info) => {
  test.skip(!detailed(info.project.name)); await seed(page); await start(page, 1);
  await expect(page.getByRole("heading", { name: "Capital of Portugal?" })).toBeFocused(); await page.keyboard.press("Tab");
  const porto = page.getByRole("radio", { name: "Porto", exact: true }); await expect(porto).toBeFocused();
  expect(await porto.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Space"); await page.keyboard.press("ArrowDown"); await expect(page.getByRole("radio", { name: "Lisbon", exact: true })).toBeChecked();
  await privateActive(page); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Clear answer" })).toBeFocused();
  await page.keyboard.press("Tab"); const finish = page.getByRole("button", { name: "Finish test" }); await expect(finish).toBeFocused();
  expect((await finish.boundingBox())!.height).toBeGreaterThanOrEqual(44); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Test complete" })).toBeFocused(); await expect(page.getByText("No mistakes to review.")).toBeVisible();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Take another test" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByRole("heading", { name: "Test “Cities”" })).toBeFocused();
});

test("Test wraps long content and reflows active, results and review at 200 percent", async ({ page }, info) => {
  await seed(page, true); await start(page, 1);
  await page.getByRole("radio", { name: "Porto", exact: true }).check(); await privateActive(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("test-active.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("test-active-200.png"), fullPage: true });
  await page.getByRole("button", { name: "Finish test" }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("test-results-200.png"), fullPage: true });
  await page.getByRole("button", { name: "Review mistakes" }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("test-review-200.png"), fullPage: true });
  await page.getByRole("button", { name: "Back to results" }).click(); await page.getByRole("button", { name: "Take another test" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
