import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudySetSchema } from "@openstudy/schema";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import { DATABASE_NAME, studySetStorage } from "../src/storage/study-sets.js";
import { flashcardProgressStorage } from "../src/storage/flashcard-progress.js";
import { userProgressStorage } from "../src/storage/user-progress.js";
import { requestValue, transactionDone } from "../src/storage/database.js";

function fixture() {
  return StudySetSchema.parse({ schemaVersion: "1.0.0", id: "set.cities", revision: 1, title: "Cities",
    sources: [{ id: "source.quiz", label: "Quiz" }],
    categories: [{ id: "category.europe", label: "Europe" }, { id: "category.americas", label: "Americas" }, { id: "category.empty", label: "Empty" }],
    questions: [
      { id: "question.portugal", type: "single-choice", prompt: "Capital of Portugal?",
        choices: [{ id: "choice.porto", text: "Porto" }, { id: "choice.lisbon", text: "Lisbon" }], correctChoiceId: "choice.lisbon",
        explanation: "Lisbon is the capital.", categoryIds: ["category.europe"] },
      { id: "question.usa", type: "single-choice", prompt: "Capital of the USA?",
        choices: [{ id: "choice.newyork", text: "New York" }, { id: "choice.washington", text: "Washington" }], correctChoiceId: "choice.washington" },
    ] });
}
const path = "/study-sets/set.cities/flashcards";
function renderAt(route = path) { return render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>); }
function removeDatabase() {
  return new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
}
async function raw(storeName: string) {
  const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open(DATABASE_NAME); request.onsuccess = () => resolve(request.result); });
  const values = await requestValue<unknown[]>(db.transaction(storeName).objectStore(storeName).getAll()); db.close(); return values;
}
async function put(storeName: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open(DATABASE_NAME); request.onsuccess = () => resolve(request.result); });
  const tx = db.transaction(storeName, "readwrite"); const done = transactionDone(tx); tx.objectStore(storeName).put(value); await done; db.close();
}
beforeEach(async () => { await studySetStorage.close(); await removeDatabase(); });
afterEach(async () => { vi.restoreAllMocks(); await studySetStorage.close(); await removeDatabase(); });
async function begin() {
  await studySetStorage.saveStudySet(fixture()); const user = userEvent.setup(); renderAt();
  await user.click(await screen.findByRole("button", { name: "Start flashcards" })); return user;
}
async function oneCard() {
  await studySetStorage.saveStudySet(fixture()); const user = userEvent.setup(); renderAt();
  await user.selectOptions(await screen.findByLabelText("Topic / category"), "category.europe");
  await user.click(screen.getByRole("button", { name: "Start flashcards" })); return user;
}
async function stored(reviews: number) {
  await waitFor(async () => { const records = await flashcardProgressStorage.getStudySetFlashcardProgress("set.cities");
    expect(records.success && records.value[0]?.reviews).toBe(reviews); });
}

describe("Flashcards route", () => {
  it("exposes both study modes as real actions and keeps Add material secondary", async () => {
    await studySetStorage.saveStudySet(fixture()); renderAt("/study-sets/set.cities"); await screen.findByText("Saved on this device");
    expect(screen.getByRole("link", { name: "Flashcards" })).toHaveAttribute("href", path);
    expect(screen.getByRole("link", { name: "Flashcards" })).toHaveClass("action");
    expect(screen.getByRole("link", { name: "Learn" })).toHaveClass("action");
    expect(screen.getByRole("link", { name: "Add material" })).not.toHaveClass("action");
    expect(screen.getByRole("link", { name: "Test" })).toHaveAttribute("href", "/study-sets/set.cities/test");
    await userEvent.setup().click(screen.getByRole("link", { name: "Flashcards" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Flashcards “Cities”" })).toHaveFocus());
  });
  it("caps the initial default at 20 cards", async () => {
    const set = fixture(); set.questions = Array.from({ length: 25 }, (_, index) => ({ ...set.questions[0]!, id: `q.${index}` }));
    await studySetStorage.saveStudySet(set); renderAt(); expect(await screen.findByLabelText("Cards")).toHaveValue(20);
  });
  it("filters categories, includes uncategorized only in All, and rejects invalid counts", async () => {
    await studySetStorage.saveStudySet(fixture()); renderAt(); const user = userEvent.setup();
    expect(await screen.findByLabelText("Cards")).toHaveValue(2);
    await user.selectOptions(screen.getByLabelText("Topic / category"), "category.europe");
    expect(screen.getByLabelText("Cards")).toHaveValue(1); expect(screen.getByText("1 card available")).toBeVisible();
    for (const count of ["0", "2", "1.5"]) {
      await user.clear(screen.getByLabelText("Cards")); await user.type(screen.getByLabelText("Cards"), count);
      expect(screen.getByRole("button", { name: "Start flashcards" })).toBeDisabled();
    }
    await user.selectOptions(screen.getByLabelText("Topic / category"), "category.empty");
    expect(screen.getByText("No cards belong to this topic. Choose another topic.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start flashcards" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Topic / category"), ""); expect(screen.getByLabelText("Cards")).toHaveValue(2);
    await user.selectOptions(screen.getByLabelText("Topic / category"), "category.europe");
    await user.click(screen.getByRole("button", { name: "Start flashcards" })); expect(screen.getByText("Card 1 of 1")).toBeVisible();
    expect(screen.queryByLabelText("Cards")).not.toBeInTheDocument(); expect(screen.queryByLabelText("Topic / category")).not.toBeInTheDocument();
  });
  it("mounts no answers, alternatives, explanation or ratings before reveal and reveal writes nothing", async () => {
    const user = await begin(); await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toHaveFocus());
    for (const text of ["Lisbon", "Porto", "Lisbon is the capital.", "Correct answer"]) expect(screen.queryByText(text, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Again" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Know it" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toHaveAttribute("aria-describedby", "flashcard-position");
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Correct answer" })).toHaveFocus());
    expect(screen.getByText("Lisbon", { exact: true })).toBeVisible(); expect(screen.getByText("Lisbon is the capital.")).toBeVisible();
    expect(screen.queryByText("Porto", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Correct answer" })).toHaveAttribute("aria-describedby", "flashcard-answer flashcard-explanation");
    expect(await raw("flashcardProgress")).toEqual([]); expect(await raw("userProgress")).toEqual([]);
  });
  it("ratings advance, next card is unrevealed, and summary/Study again restore focus", async () => {
    const user = await begin(); await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(screen.getByRole("button", { name: "Know it" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of the USA?" })).toHaveFocus());
    expect(screen.getByText("Card 2 of 2")).toBeVisible(); expect(screen.queryByText("Washington", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Again" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: "Again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Session complete" })).toHaveFocus());
    expect(screen.getByText("2 cards reviewed")).toBeVisible(); expect(screen.getByText("1 Know it")).toBeVisible(); expect(screen.getByText("1 Again")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    await waitFor(async () => expect(await raw("flashcardProgress")).toHaveLength(2));
    expect(await studySetStorage.getStudySet("set.cities")).toEqual({ success: true, value: fixture() });
    await user.click(screen.getByRole("button", { name: "Study again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Flashcards “Cities”" })).toHaveFocus());
    await user.click(screen.getByRole("link", { name: "Back to study set" })); expect(await screen.findByText("Saved on this device")).toBeVisible();
  });
  it("keeps Learn records byte-for-byte unchanged after a Flashcard session", async () => {
    await studySetStorage.saveStudySet(fixture());
    await userProgressStorage.saveQuestionProgress({ progress: { studySetId: "set.cities", questionId: "question.portugal", attempts: 2,
      firstAttemptCorrect: false, eventualCorrect: true, needsReview: true }, expectedAttempts: 0 });
    const before = JSON.stringify(await raw("userProgress")); const user = userEvent.setup(); renderAt();
    await user.click(await screen.findByRole("button", { name: "Start flashcards" }));
    for (const rating of ["Again", "Know it"]) { await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: rating })); }
    await waitFor(async () => expect(await raw("flashcardProgress")).toHaveLength(2)); expect(JSON.stringify(await raw("userProgress"))).toBe(before);
  });
  it.each(["Again", "Know it"])("double-clicking %s makes one review and leaves the next card unrevealed", async (rating) => {
    const user = await begin(); const persist = flashcardProgressStorage.saveFlashcardProgress;
    let release: () => void = () => {}; const pending = new Promise<void>((resolve) => { release = resolve; });
    const save = vi.spyOn(flashcardProgressStorage, "saveFlashcardProgress").mockImplementation(async (input) => { await pending; return persist(input); });
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.dblClick(screen.getByRole("button", { name: rating }));
    expect(screen.getByRole("heading", { name: "Capital of the USA?" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Correct answer" })).not.toBeInTheDocument(); expect(save).toHaveBeenCalledTimes(1);
    release(); await stored(1); expect(await raw("flashcardProgress")).toHaveLength(1);
  });
  it("guards rapid competing ratings before React can commit another render", async () => {
    const user = await begin(); await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    const again = screen.getByRole("button", { name: "Again" }); const know = screen.getByRole("button", { name: "Know it" });
    act(() => { fireEvent.click(again); fireEvent.click(know); }); await stored(1);
    expect(await raw("flashcardProgress")).toHaveLength(1); expect(screen.getByText("Card 2 of 2")).toBeVisible();
  });
  it.each(["Again", "Know it"])("ignores a second pointer click landing on Exit session after %s", async (rating) => {
    const user = await begin(); await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(screen.getByRole("button", { name: rating }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of the USA?" })).toHaveFocus());
    fireEvent.click(screen.getByRole("link", { name: "Exit session" }), { detail: 2 });
    expect(screen.getByText("Card 2 of 2")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Correct answer" })).not.toBeInTheDocument();
    await stored(1); expect(await raw("flashcardProgress")).toHaveLength(1);
    await user.tab(); await user.tab();
    expect(screen.getByRole("link", { name: "Exit session" })).toHaveFocus();
    await user.keyboard("{Enter}"); expect(await screen.findByText("Saved on this device")).toBeVisible();
  });
  it("ignores second pointer clicks on completion controls while allowing keyboard activation", async () => {
    const user = await oneCard(); await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(screen.getByRole("button", { name: "Again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Session complete" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Study again" }), { detail: 2 });
    fireEvent.click(screen.getByRole("link", { name: "Back to study set" }), { detail: 2 });
    expect(screen.getByRole("heading", { name: "Session complete" })).toBeVisible();
    await stored(1);
    await user.tab(); expect(screen.getByRole("button", { name: "Study again" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Flashcards “Cities”" })).toHaveFocus());
  });
  it("double-clicking Reveal does not rate the card", async () => {
    const user = await begin(); await user.dblClick(screen.getByRole("button", { name: "Reveal answer" }));
    expect(screen.getByRole("heading", { name: "Correct answer" })).toBeVisible(); expect(await raw("flashcardProgress")).toEqual([]);
  });
  it("persists rated cards across remount while discarding active session state", async () => {
    const user = await begin(); await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: "Again" }));
    await stored(1); await user.click(screen.getByRole("link", { name: "Exit session" })); await user.click(await screen.findByRole("link", { name: "Flashcards" }));
    expect(await screen.findByRole("button", { name: "Start flashcards" })).toBeVisible(); expect(await raw("flashcardProgress")).toHaveLength(1);
  });
  it("warns persistently on failed writes but allows the whole session to complete", async () => {
    vi.spyOn(flashcardProgressStorage, "saveFlashcardProgress").mockResolvedValue({ success: false, error: "write-failed" });
    const user = await begin();
    for (const rating of ["Again", "Know it"]) {
      await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: rating }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Your flashcard progress couldn't be saved on this device. You can continue, but these results may be lost.");
    }
    expect(screen.getByRole("heading", { name: "Session complete" })).toBeVisible(); expect(await raw("flashcardProgress")).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Study again" })); expect(screen.getByRole("alert")).toBeVisible();
  });
  it("recovers cumulative progress on a later session using the last durable baseline", async () => {
    const persist = flashcardProgressStorage.saveFlashcardProgress;
    const save = vi.spyOn(flashcardProgressStorage, "saveFlashcardProgress").mockResolvedValueOnce({ success: false, error: "write-failed" }).mockImplementation(persist);
    const user = await oneCard(); await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: "Again" }));
    await screen.findByRole("alert"); await user.click(screen.getByRole("button", { name: "Study again" }));
    await user.click(screen.getByRole("button", { name: "Start flashcards" })); await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(screen.getByRole("button", { name: "Know it" })); await stored(2);
    expect(save).toHaveBeenLastCalledWith({ progress: expect.objectContaining({ reviews: 2, againCount: 1, knowItCount: 1, lastRating: "know-it" }), expectedReviews: 0 });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
  it("serializes writes across Study again even when the first save is delayed", async () => {
    const persist = flashcardProgressStorage.saveFlashcardProgress; let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const save = vi.spyOn(flashcardProgressStorage, "saveFlashcardProgress").mockImplementation(async (input) => { if (input.expectedReviews === 0) await pending; return persist(input); });
    const user = await oneCard(); await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: "Again" }));
    await user.click(screen.getByRole("button", { name: "Study again" })); await user.click(screen.getByRole("button", { name: "Start flashcards" }));
    await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: "Know it" }));
    expect(save).toHaveBeenCalledTimes(1); release(); await stored(2);
    expect(save).toHaveBeenLastCalledWith({ progress: expect.objectContaining({ reviews: 2 }), expectedReviews: 1 });
  });
  it("never retries conflicted questions from a stale page", async () => {
    const save = vi.spyOn(flashcardProgressStorage, "saveFlashcardProgress").mockResolvedValue({ success: false, error: "progress-conflict" });
    const user = await oneCard(); await user.click(screen.getByRole("button", { name: "Reveal answer" })); await user.click(screen.getByRole("button", { name: "Again" }));
    await screen.findByRole("alert"); await user.click(screen.getByRole("button", { name: "Study again" }));
    await user.click(screen.getByRole("button", { name: "Start flashcards" })); await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(screen.getByRole("button", { name: "Know it" })); expect(save).toHaveBeenCalledTimes(1); expect(screen.getByRole("alert")).toBeVisible();
  });
  it("keyboard-only operation follows question, reveal, answer, rating, and completion", async () => {
    const user = await oneCard(); await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toHaveFocus());
    await user.tab(); expect(screen.getByRole("button", { name: "Reveal answer" })).toHaveFocus(); await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Correct answer" })).toHaveFocus()); await user.tab();
    expect(screen.getByRole("button", { name: "Again" })).toHaveFocus(); await user.tab(); expect(screen.getByRole("button", { name: "Know it" })).toHaveFocus();
    await user.keyboard(" "); await waitFor(() => expect(screen.getByRole("heading", { name: "Session complete" })).toHaveFocus());
  });
  it("handles missing content", async () => { renderAt("/study-sets/missing/flashcards"); expect(await screen.findByRole("heading", { name: "Study set not found" })).toBeVisible(); });
  it("refuses incompatible StudySets", async () => {
    await studySetStorage.saveStudySet(fixture()); await put("studySets", { id: "set.cities", schemaVersion: "2.0.0" }); renderAt();
    expect(await screen.findByRole("heading", { name: "This study set can't be opened" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Start flashcards" })).not.toBeInTheDocument();
  });
  it("blocks malformed FlashcardProgress and offers retry", async () => {
    await studySetStorage.saveStudySet(fixture()); await put("flashcardProgress", { studySetId: "set.cities", questionId: "question.portugal", reviews: 0 }); renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't safely load flashcard progress");
    expect(screen.getByRole("button", { name: "Retry loading progress" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Start flashcards" })).not.toBeInTheDocument();
  });
  it("restores focus through delayed progress retry", async () => {
    await studySetStorage.saveStudySet(fixture());
    let finish: (result: Awaited<ReturnType<typeof flashcardProgressStorage.getStudySetFlashcardProgress>>) => void = () => {};
    const pending = new Promise<Awaited<ReturnType<typeof flashcardProgressStorage.getStudySetFlashcardProgress>>>((resolve) => { finish = resolve; });
    vi.spyOn(flashcardProgressStorage, "getStudySetFlashcardProgress").mockResolvedValueOnce({ success: false, error: "read-failed" }).mockReturnValueOnce(pending);
    renderAt(); await userEvent.setup().click(await screen.findByRole("button", { name: "Retry loading progress" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Flashcards", level: 1 })).toHaveFocus()); finish({ success: true, value: [] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Flashcards “Cities”" })).toHaveFocus());
  });
  it("reports storage unavailable", async () => {
    vi.spyOn(studySetStorage, "getStudySet").mockResolvedValue({ success: false, error: "storage-unavailable" }); renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't read this study set");
  });
});
