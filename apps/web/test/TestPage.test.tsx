import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudySetSchema } from "@openstudy/schema";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import { DATABASE_NAME, studySetStorage } from "../src/storage/study-sets.js";
import { DATABASE_VERSION, requestValue, transactionDone } from "../src/storage/database.js";
import { userProgressStorage } from "../src/storage/user-progress.js";
import { flashcardProgressStorage } from "../src/storage/flashcard-progress.js";

function fixture() {
  return StudySetSchema.parse({ schemaVersion: "1.0.0", id: "set.cities", revision: 1, title: "Cities",
    sources: [{ id: "source.quiz", label: "Quiz" }],
    categories: [{ id: "category.europe", label: "Europe" }, { id: "category.empty", label: "Empty" }],
    questions: [
      { id: "question.portugal", type: "single-choice", prompt: "Capital of Portugal?",
        choices: [{ id: "choice.porto", text: "Porto" }, { id: "choice.lisbon", text: "Lisbon" }], correctChoiceId: "choice.lisbon",
        explanation: "Lisbon is the capital.", categoryIds: ["category.europe"] },
      { id: "question.france", type: "single-choice", prompt: "Capital of France?",
        choices: [{ id: "choice.paris", text: "Paris" }, { id: "choice.lyon", text: "Lyon" }], correctChoiceId: "choice.paris" },
      { id: "question.germany", type: "single-choice", prompt: "Capital of Germany?",
        choices: [{ id: "choice.berlin", text: "Berlin" }, { id: "choice.bonn", text: "Bonn" }], correctChoiceId: "choice.berlin",
        explanation: "Berlin is the capital." },
    ] });
}
const route = "/study-sets/set.cities/test";
function renderAt(path = route) { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
async function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(DATABASE_NAME);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function raw(storeName: string) {
  const db = await openDatabase(); const records = await requestValue(db.transaction(storeName).objectStore(storeName).getAll()); db.close(); return records;
}
async function put(storeName: string, value: unknown) {
  const db = await openDatabase(); const tx = db.transaction(storeName, "readwrite"); const done = transactionDone(tx);
  tx.objectStore(storeName).put(value); await done; db.close();
}
async function removeDatabase() {
  await studySetStorage.close();
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
}
beforeEach(async () => { await removeDatabase(); await studySetStorage.saveStudySet(fixture()); });
afterEach(async () => { vi.restoreAllMocks(); await removeDatabase(); });
async function begin(count = 3) {
  const user = userEvent.setup(); const view = renderAt();
  await user.click(await screen.findByRole("checkbox", { name: "Shuffle questions" }));
  await user.clear(screen.getByLabelText("Questions", { exact: true })); await user.type(screen.getByLabelText("Questions", { exact: true }), String(count));
  await user.click(screen.getByRole("button", { name: "Start test" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toHaveFocus());
  return { user, view };
}
async function finishUnanswered(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Finish test" }));
  await user.click(screen.getByRole("button", { name: "Submit test" }));
}
function expectNoFeedback() {
  for (const text of ["Correct", "Incorrect", "Correct answer", "Explanation", "Lisbon is the capital.", "Berlin is the capital."])
    expect(screen.queryByText(text, { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Check answer" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/correct|incorrect|explanation/i)).not.toBeInTheDocument();
  expect(document.querySelector(".answer-correct, .correct-label, .text-success, .text-danger, [aria-live]")).toBeNull();
}

describe("Test mode", () => {
  it("exposes three real primary study modes and keeps Add material secondary", async () => {
    const user = userEvent.setup(); renderAt("/study-sets/set.cities"); await screen.findByText("Saved on this device");
    for (const mode of ["Learn", "Flashcards", "Test"]) expect(screen.getByRole("link", { name: mode })).toHaveClass("action");
    expect(screen.getByRole("link", { name: "Test" })).toHaveAttribute("href", route);
    expect(screen.getByRole("link", { name: "Add material" })).not.toHaveClass("action");
    await user.click(screen.getByRole("link", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Test “Cities”" })).toHaveFocus());
  });
  it("defaults to All topics, eligible count and enabled shuffle", async () => {
    renderAt(); expect(await screen.findByLabelText("Questions", { exact: true })).toHaveValue(3);
    expect(screen.getByLabelText("Topic / category")).toHaveValue(""); expect(screen.getByRole("checkbox")).toBeChecked();
  });
  it("caps default count at 20", async () => {
    const set = fixture(); set.questions = Array.from({ length: 25 }, (_, i) => ({ ...set.questions[0]!, id: `q.${i}` }));
    await studySetStorage.saveStudySet(set); renderAt(); expect(await screen.findByLabelText("Questions", { exact: true })).toHaveValue(20);
  });
  it("filters category IDs, clamps excess counts, preserves valid counts and handles empty topics", async () => {
    const user = userEvent.setup(); renderAt(); const category = await screen.findByLabelText("Topic / category");
    await user.selectOptions(category, "category.europe"); expect(screen.getByLabelText("Questions", { exact: true })).toHaveValue(1);
    expect(screen.getByText("1 question available")).toBeVisible();
    await user.selectOptions(category, ""); expect(screen.getByLabelText("Questions", { exact: true })).toHaveValue(1);
    await user.selectOptions(category, "category.empty"); expect(screen.getByRole("button", { name: "Start test" })).toBeDisabled();
    expect(screen.getByText("No questions belong to this topic. Choose another topic.")).toBeVisible();
    await user.selectOptions(category, "category.europe"); await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(screen.getByText("Question 1 of 1")).toBeVisible(); expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toBeVisible();
  });
  it.each(["0", "4", "1.5", "9007199254740992"])("rejects invalid count %s", async (count) => {
    const user = userEvent.setup(); renderAt(); const input = await screen.findByLabelText("Questions", { exact: true });
    await user.clear(input); await user.type(input, count); expect(screen.getByRole("button", { name: "Start test" })).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
  it("hides setup after Start, preserves choice order, and focuses the question", async () => {
    await begin(); expect(screen.queryByLabelText("Questions", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Choose one answer" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["choice.porto", "choice.lisbon"]);
    expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toHaveAttribute("aria-describedby", "test-position");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled(); expectNoFeedback();
  });
  it("uses injected web randomness only at start and keeps shuffled order stable", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0); const user = userEvent.setup(); renderAt();
    await user.click(await screen.findByRole("button", { name: "Start test" }));
    expect(screen.getByRole("heading", { name: "Capital of France?" })).toBeVisible();
    const calls = random.mock.calls.length;
    await user.click(screen.getByRole("radio", { name: "Paris" })); await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Capital of Germany?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous" })); expect(screen.getByRole("radio", { name: "Paris" })).toBeChecked();
    expect(random.mock.calls.length).toBe(calls);
  });
  it("selects, changes and clears without feedback or focus movement", async () => {
    const { user } = await begin(); const porto = screen.getByRole("radio", { name: "Porto" });
    await user.click(porto); expect(porto).toBeChecked(); expect(porto).toHaveFocus(); expectNoFeedback();
    await user.click(screen.getByRole("radio", { name: "Lisbon" })); expect(screen.getByRole("radio", { name: "Lisbon" })).toBeChecked(); expectNoFeedback();
    await user.click(screen.getByRole("button", { name: "Clear answer" }));
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true); expectNoFeedback();
  });
  it("navigates unanswered and restores earlier selected answers", async () => {
    const { user } = await begin(); await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of France?" })).toHaveFocus());
    await user.click(screen.getByRole("radio", { name: "Lyon" })); await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Porto" })); await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("radio", { name: "Lyon" })).toBeChecked(); expectNoFeedback();
  });
  it("submits all answered immediately and shows rounded score", async () => {
    const { user } = await begin(); await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Next" })); await user.click(screen.getByRole("radio", { name: "Lyon" }));
    await user.click(screen.getByRole("button", { name: "Next" })); await user.click(screen.getByRole("radio", { name: "Berlin" }));
    await user.click(screen.getByRole("button", { name: "Finish test" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Test complete" })).toHaveFocus());
    for (const text of ["2 / 3", "67%", "2 correct", "1 incorrect", "0 unanswered"]) expect(screen.getByText(text, { exact: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit test" })).not.toBeInTheDocument(); expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
  it("requires explicit unanswered confirmation and Keep working restores Finish focus", async () => {
    const { user } = await begin(); await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: "Paris" })); await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep working" })).toHaveFocus());
    expect(screen.getByRole("group", { name: "2 questions are unanswered." })).toHaveAttribute("aria-describedby", "test-confirmation-help");
    expect(screen.getByText("Unanswered questions receive no points. Submit this test?")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled(); expectNoFeedback();
    await user.click(screen.getByRole("button", { name: "Keep working" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish test" })).toHaveFocus());
    await user.click(screen.getByRole("radio", { name: "Berlin" })); await user.click(screen.getByRole("button", { name: "Finish test" }));
    expect(screen.getByText("1 question is unanswered.")).toBeVisible(); await user.click(screen.getByRole("button", { name: "Submit test" }));
    expect(screen.getByText("2 correct")).toBeVisible(); expect(screen.getByText("0 incorrect")).toBeVisible(); expect(screen.getByText("1 unanswered")).toBeVisible();
  });
  it("reviews wrong and unanswered only with canonical explanation and bounded navigation", async () => {
    const { user } = await begin(); await user.click(screen.getByRole("radio", { name: "Porto" }));
    await user.click(screen.getByRole("button", { name: "Next" })); await user.click(screen.getByRole("radio", { name: "Paris" }));
    await user.click(screen.getByRole("button", { name: "Next" })); await user.click(screen.getByRole("button", { name: "Finish test" }));
    await user.click(screen.getByRole("button", { name: "Submit test" })); await user.click(screen.getByRole("button", { name: "Review mistakes" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toHaveFocus());
    expect(screen.getByText("Mistake 1 of 2")).toBeVisible();
    for (const text of ["Porto", "Lisbon", "Lisbon is the capital."]) expect(screen.getByText(text, { exact: true })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Your answer" })).toBeVisible(); expect(screen.getByRole("heading", { name: "Correct answer" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous mistake" })).toBeDisabled(); expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next mistake" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of Germany?" })).toHaveFocus());
    expect(screen.getByText("No answer")).toBeVisible(); expect(screen.getByText("Berlin", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next mistake" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous mistake" })); expect(screen.getByText("Mistake 1 of 2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to results" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Test complete" })).toHaveFocus()); expect(screen.getByText("1 / 3")).toBeVisible();
  });
  it("offers no mistakes review for a perfect test", async () => {
    const { user } = await begin(1); await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Finish test" })); expect(screen.getByText("100%")).toBeVisible();
    expect(screen.getByText("No mistakes to review.")).toBeVisible(); expect(screen.queryByRole("button", { name: "Review mistakes" })).not.toBeInTheDocument();
  });
  it("Take another test restores setup focus/settings and Back to study set navigates", async () => {
    const { user } = await begin(1); await user.click(screen.getByRole("radio", { name: "Porto" })); await user.click(screen.getByRole("button", { name: "Finish test" }));
    await user.click(screen.getByRole("button", { name: "Take another test" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Test “Cities”" })).toHaveFocus());
    expect(screen.getByLabelText("Questions", { exact: true })).toHaveValue(1); expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Back to study set" })); expect(await screen.findByText("Saved on this device")).toBeVisible();
  });
  it("double Next and its retargeted second click cannot skip a question or exit", async () => {
    const { user } = await begin(); await user.dblClick(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }), { detail: 2 });
    fireEvent.click(screen.getByRole("link", { name: "Exit session" }), { detail: 2 });
    expect(screen.getByText("Question 2 of 3")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of France?" })).toHaveFocus());
  });
  it("double Previous moves once and competing handlers use the latest committed view", async () => {
    const { user } = await begin(); await user.click(screen.getByRole("button", { name: "Next" })); await user.click(screen.getByRole("button", { name: "Next" }));
    await user.dblClick(screen.getByRole("button", { name: "Previous" })); expect(screen.getByText("Question 2 of 3")).toBeVisible();
    const previous = screen.getByRole("button", { name: "Previous" }); const next = screen.getByRole("button", { name: "Next" });
    act(() => { fireEvent.click(previous); fireEvent.click(next); }); expect(screen.getByText("Question 1 of 3")).toBeVisible();
  });
  it("double Finish requires unanswered confirmation and double Submit cannot resubmit or restart", async () => {
    const { user } = await begin(1); await user.dblClick(screen.getByRole("button", { name: "Finish test" }));
    expect(screen.getByText("1 question is unanswered.")).toBeVisible(); expect(screen.queryByText("Test complete")).not.toBeInTheDocument();
    await user.dblClick(screen.getByRole("button", { name: "Submit test" }));
    fireEvent.click(screen.getByRole("button", { name: "Take another test" }), { detail: 2 });
    fireEvent.click(screen.getByRole("link", { name: "Back to study set" }), { detail: 2 });
    expect(screen.getByText("0 / 1")).toBeVisible(); expect(screen.getByText("1 unanswered")).toBeVisible();
  });
  it("double Take another test does not start a new test", async () => {
    const { user } = await begin(1); await user.click(screen.getByRole("radio", { name: "Lisbon" })); await user.click(screen.getByRole("button", { name: "Finish test" }));
    await user.dblClick(screen.getByRole("button", { name: "Take another test" }));
    fireEvent.click(screen.getByRole("button", { name: "Start test" }), { detail: 2 });
    expect(screen.getByRole("heading", { name: "Test “Cities”" })).toBeVisible();
  });
  it("keyboard flow uses native radios without answer-selection focus stealing", async () => {
    const { user } = await begin(1); await user.tab(); const porto = screen.getByRole("radio", { name: "Porto" });
    expect(porto).toHaveFocus(); await user.keyboard(" "); expect(porto).toBeChecked(); expect(porto).toHaveFocus(); expectNoFeedback();
    await user.keyboard("{ArrowDown}"); const lisbon = screen.getByRole("radio", { name: "Lisbon" }); expect(lisbon).toBeChecked(); expect(lisbon).toHaveFocus();
    await user.tab(); expect(screen.getByRole("button", { name: "Clear answer" })).toHaveFocus(); await user.tab();
    expect(screen.getByRole("button", { name: "Finish test" })).toHaveFocus(); await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Test complete" })).toHaveFocus());
  });
  it("Test leaves both progress models and canonical stores byte-for-byte unchanged with layout 3", async () => {
    await userProgressStorage.saveQuestionProgress({ progress: { studySetId: "set.cities", questionId: "question.portugal", attempts: 2,
      firstAttemptCorrect: false, eventualCorrect: true, needsReview: true }, expectedAttempts: 0 });
    await flashcardProgressStorage.saveFlashcardProgress({ progress: { studySetId: "set.cities", questionId: "question.portugal",
      reviews: 3, againCount: 1, knowItCount: 2, lastRating: "know-it" }, expectedReviews: 0 });
    const stores = ["studySets", "libraryEntries", "userProgress", "flashcardProgress"];
    const before = await Promise.all(stores.map(async (store) => JSON.stringify(await raw(store))));
    const learnWrite = vi.spyOn(userProgressStorage, "saveQuestionProgress"); const flashWrite = vi.spyOn(flashcardProgressStorage, "saveFlashcardProgress");
    const { user } = await begin(); await user.click(screen.getByRole("radio", { name: "Porto" })); await finishUnanswered(user);
    expect(await Promise.all(stores.map(async (store) => JSON.stringify(await raw(store))))).toEqual(before);
    expect(learnWrite).not.toHaveBeenCalled(); expect(flashWrite).not.toHaveBeenCalled();
    const db = await openDatabase(); expect(db.version).toBe(DATABASE_VERSION); expect(DATABASE_VERSION).toBe(3);
    expect(Array.from(db.objectStoreNames)).toEqual(["flashcardProgress", "libraryEntries", "studySets", "userProgress"]); db.close();
  });
  it("remount discards an active test and selections", async () => {
    const { user, view } = await begin(); await user.click(screen.getByRole("radio", { name: "Porto" })); view.unmount(); renderAt();
    expect(await screen.findByRole("button", { name: "Start test" })).toBeVisible(); expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
  it("remount discards submitted results and mistake review", async () => {
    const { user, view } = await begin(); await finishUnanswered(user); await user.click(screen.getByRole("button", { name: "Review mistakes" }));
    view.unmount(); renderAt(); expect(await screen.findByRole("button", { name: "Start test" })).toBeVisible(); expect(screen.queryByText("No answer")).not.toBeInTheDocument();
  });
  it("shows loading without enabling Test", async () => {
    vi.spyOn(studySetStorage, "getStudySet").mockReturnValue(new Promise(() => {})); renderAt();
    expect(screen.getByRole("status")).toHaveTextContent("Opening study set"); expect(screen.queryByRole("button", { name: "Start test" })).not.toBeInTheDocument();
  });
  it("handles a missing StudySet", async () => { renderAt("/study-sets/missing/test"); expect(await screen.findByRole("heading", { name: "Study set not found" })).toBeVisible(); });
  it("refuses incompatible canonical content", async () => {
    await put("studySets", { id: "set.cities", schemaVersion: "2.0.0" }); renderAt();
    expect(await screen.findByRole("heading", { name: "This study set can't be opened" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Start test" })).not.toBeInTheDocument();
  });
  it.each(["storage-unavailable", "read-failed"] as const)("handles %s", async (error) => {
    vi.spyOn(studySetStorage, "getStudySet").mockResolvedValue({ success: false, error }); renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't read this study set");
  });
});
