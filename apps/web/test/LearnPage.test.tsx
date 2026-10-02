import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudySetSchema } from "@openstudy/schema";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import { DATABASE_NAME, studySetStorage } from "../src/storage/study-sets.js";
import { userProgressStorage } from "../src/storage/user-progress.js";

function fixture() {
  return StudySetSchema.parse({
    schemaVersion: "1.0.0", id: "set.cities", revision: 1, title: "Cities",
    sources: [{ id: "source.quiz", label: "Quiz" }],
    categories: [{ id: "category.europe", label: "Europe" }, { id: "category.americas", label: "Americas" }],
    questions: [
      { id: "question.portugal", type: "single-choice", prompt: "Capital of Portugal?",
        choices: [{ id: "choice.porto", text: "Porto" }, { id: "choice.lisbon", text: "Lisbon" }],
        correctChoiceId: "choice.lisbon", explanation: "Lisbon is the capital.", categoryIds: ["category.europe"] },
      { id: "question.usa", type: "single-choice", prompt: "Capital of the USA?",
        choices: [{ id: "choice.newyork", text: "New York" }, { id: "choice.washington", text: "Washington" }],
        correctChoiceId: "choice.washington", categoryIds: ["category.americas"] },
    ],
  });
}
const learnPath = "/study-sets/set.cities/learn";
function renderAt(path = learnPath) { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
function removeDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
beforeEach(async () => { await studySetStorage.close(); await removeDatabase(); });
afterEach(async () => { vi.restoreAllMocks(); await studySetStorage.close(); await removeDatabase(); });

describe("Learn route", () => {
  it("links from StudySet details and keeps Add material secondary", async () => {
    expect((await studySetStorage.saveStudySet(fixture())).success).toBe(true);
    renderAt("/study-sets/set.cities");
    await screen.findByText("Saved on this device");
    expect(screen.getByRole("link", { name: "Learn" })).toHaveAttribute("href", learnPath);
    expect(screen.getByRole("link", { name: "Add material" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("link", { name: "Learn" }));
    expect(await screen.findByRole("heading", { name: "Learn “Cities”" })).toBeInTheDocument();
  });

  it("focuses the loading route heading and restores focus when Learn is ready", async () => {
    const set = fixture();
    expect((await studySetStorage.saveStudySet(set)).success).toBe(true);
    const user = userEvent.setup();
    renderAt("/study-sets/set.cities");
    await screen.findByText("Saved on this device");
    let finishRead: (result: Awaited<ReturnType<typeof studySetStorage.getStudySet>>) => void = () => {};
    const pendingRead = new Promise<Awaited<ReturnType<typeof studySetStorage.getStudySet>>>(
      (resolve) => { finishRead = resolve; });
    vi.spyOn(studySetStorage, "getStudySet").mockReturnValue(pendingRead);
    await user.click(screen.getByRole("link", { name: "Learn" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Learn", level: 1 })).toHaveFocus());
    finishRead({ success: true, value: set });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Learn “Cities”" })).toHaveFocus());
  });

  it("configures category/count and hides configuration once studying starts", async () => {
    expect((await studySetStorage.saveStudySet(fixture())).success).toBe(true);
    const user = userEvent.setup();
    renderAt();
    expect(await screen.findByLabelText("Questions")).toHaveValue(2);
    await user.selectOptions(screen.getByLabelText("Topic / category"), "category.europe");
    expect(screen.getByLabelText("Questions")).toHaveValue(1);
    expect(screen.getByText("1 question available")).toBeVisible();
    await user.clear(screen.getByLabelText("Questions"));
    await user.type(screen.getByLabelText("Questions"), "2");
    expect(screen.getByRole("button", { name: "Start learning" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Questions"));
    await user.type(screen.getByLabelText("Questions"), "1");
    await user.click(screen.getByRole("button", { name: "Start learning" }));
    expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Questions")).not.toBeInTheDocument();
    expect(screen.queryByText("Capital of the USA?")).not.toBeInTheDocument();
    expect(screen.getByText("Question 1 of 1")).toBeVisible();
  });

  it("keeps wrong answers unresolved without revealing correctness, then persists retries and completion", async () => {
    const saved = fixture();
    expect((await studySetStorage.saveStudySet(saved)).success).toBe(true);
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Start learning" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Check answer" })).toBeDisabled();
    expect(await userProgressStorage.getStudySetProgress(saved.id)).toEqual({ success: true, value: [] });
    await user.click(screen.getByRole("radio", { name: "Porto" }));
    await user.click(screen.getByRole("button", { name: "Clear answer" }));
    expect(screen.getByRole("button", { name: "Check answer" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Porto" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByRole("status")).toHaveTextContent("Not quite. Try another answer.");
    expect(screen.queryByText("Correct answer")).not.toBeInTheDocument();
    expect(screen.queryByText("Lisbon is the capital.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    await waitFor(async () => expect((await userProgressStorage.getStudySetProgress(saved.id)).success).toBe(true));
    await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Correct." })).toHaveFocus());
    expect(screen.getByText("Lisbon is the capital.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Capital of the USA?" })).toHaveFocus());
    await user.click(screen.getByRole("radio", { name: "Washington" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Session complete" })).toHaveFocus());
    expect(screen.getByText("2 questions completed")).toBeVisible();
    expect(screen.getByText("1 correct on the first try")).toBeVisible();
    expect(screen.getByText("1 needed another attempt")).toBeVisible();
    await waitFor(async () => {
      const result = await userProgressStorage.getStudySetProgress(saved.id);
      expect(result.success && result.value).toHaveLength(2);
    });
    const result = await userProgressStorage.getStudySetProgress(saved.id);
    if (!result.success) throw new Error("progress missing");
    expect(result.value.find((item) => item.questionId === "question.portugal")).toMatchObject({
      attempts: 2, firstAttemptCorrect: false, eventualCorrect: true, needsReview: true,
    });
    expect((await studySetStorage.getStudySet(saved.id)).success).toBe(true);
    const reopened = await studySetStorage.getStudySet(saved.id);
    expect(reopened.success && reopened.value.revision).toBe(1);
    await user.click(screen.getByRole("button", { name: "Study again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Learn “Cities”" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Start learning" }));
    await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(async () => {
      const latest = await userProgressStorage.getStudySetProgress(saved.id);
      expect(latest.success && latest.value.find((item) => item.questionId === "question.portugal")?.needsReview).toBe(false);
    });
  });

  it.each([1, 2])("keeps correct feedback visible after a double-click in a %i-question session", async (count) => {
    const set = fixture();
    expect((await studySetStorage.saveStudySet(set)).success).toBe(true);
    const user = userEvent.setup();
    renderAt();
    const questions = await screen.findByLabelText("Questions");
    await user.clear(questions);
    await user.type(questions, String(count));
    await user.click(screen.getByRole("button", { name: "Start learning" }));
    await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.dblClick(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByRole("heading", { name: "Capital of Portugal?" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Correct." })).toBeVisible();
    expect(screen.getByText("Lisbon is the capital.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: count === 1 ? "Session complete" : "Capital of the USA?" })).toBeVisible();
  });

  it("warns on progress write failure but lets the learner continue", async () => {
    expect((await studySetStorage.saveStudySet(fixture())).success).toBe(true);
    vi.spyOn(userProgressStorage, "saveQuestionProgress").mockResolvedValue({ success: false, error: "write-failed" });
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Start learning" }));
    await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("progress couldn't be saved");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Capital of the USA?" })).toBeVisible();
  });

  it("recovers cumulative progress on a later check after a temporary write failure", async () => {
    const set = fixture();
    expect((await studySetStorage.saveStudySet(set)).success).toBe(true);
    const persist = userProgressStorage.saveQuestionProgress;
    const save = vi.spyOn(userProgressStorage, "saveQuestionProgress")
      .mockResolvedValueOnce({ success: false, error: "write-failed" })
      .mockImplementation((input) => persist(input));
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Start learning" }));
    await user.click(screen.getByRole("radio", { name: "Porto" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("progress couldn't be saved");
    await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(async () => {
      const stored = await userProgressStorage.getStudySetProgress(set.id);
      expect(stored.success && stored.value[0]).toMatchObject({ attempts: 2, eventualCorrect: true, needsReview: true });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(save).toHaveBeenNthCalledWith(1, { progress: expect.objectContaining({ attempts: 1 }), expectedAttempts: 0 });
    expect(save).toHaveBeenNthCalledWith(2, { progress: expect.objectContaining({ attempts: 2 }), expectedAttempts: 0 });
  });

  it("keeps repeated checks from one session in write order", async () => {
    const set = fixture();
    expect((await studySetStorage.saveStudySet(set)).success).toBe(true);
    const persist = userProgressStorage.saveQuestionProgress;
    let releaseFirst: () => void = () => {};
    const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const expectedAttempts: number[] = [];
    vi.spyOn(userProgressStorage, "saveQuestionProgress").mockImplementation(async (input) => {
      expectedAttempts.push(input.expectedAttempts);
      if (input.expectedAttempts === 0) await firstWrite;
      return persist(input);
    });
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Start learning" }));
    await user.click(screen.getByRole("radio", { name: "Porto" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(expectedAttempts).toEqual([0]));
    await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(expectedAttempts).toEqual([0]);
    releaseFirst();
    await waitFor(async () => {
      expect(expectedAttempts).toEqual([0, 1]);
      const stored = await userProgressStorage.getStudySetProgress(set.id);
      expect(stored.success && stored.value[0]?.attempts).toBe(2);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns on a conflict and does not submit later snapshots from the stale page", async () => {
    const set = fixture();
    expect((await studySetStorage.saveStudySet(set)).success).toBe(true);
    const save = vi.spyOn(userProgressStorage, "saveQuestionProgress").mockResolvedValue({ success: false, error: "progress-conflict" });
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Start learning" }));
    await user.click(screen.getByRole("radio", { name: "Porto" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("progress couldn't be saved");
    expect(save).toHaveBeenCalledWith({ progress: expect.objectContaining({ attempts: 1 }), expectedAttempts: 0 });
    await user.click(screen.getByRole("radio", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByRole("heading", { name: "Correct." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Capital of the USA?" })).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("progress couldn't be saved");
    expect(await userProgressStorage.getStudySetProgress(set.id)).toEqual({ success: true, value: [] });
  });

  it("handles missing, incompatible, and malformed-progress states", async () => {
    renderAt("/study-sets/missing/learn");
    expect(await screen.findByRole("heading", { name: "Study set not found" })).toBeVisible();
  });

  it("refuses an incompatible saved StudySet", async () => {
    expect((await studySetStorage.saveStudySet(fixture())).success).toBe(true);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(DATABASE_NAME); request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("studySets", "readwrite");
      tx.objectStore("studySets").put({ id: "set.cities", schemaVersion: "2.0.0" });
      tx.oncomplete = () => resolve();
    });
    db.close();
    renderAt();
    expect(await screen.findByRole("heading", { name: "This study set can't be opened" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Start learning" })).not.toBeInTheDocument();
  });

  it("blocks a session when stored progress is malformed and offers retry", async () => {
    expect((await studySetStorage.saveStudySet(fixture())).success).toBe(true);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(DATABASE_NAME); request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("userProgress", "readwrite");
      tx.objectStore("userProgress").put({ studySetId: "set.cities", questionId: "question.portugal", attempts: 0,
        firstAttemptCorrect: true, eventualCorrect: true, needsReview: false });
      tx.oncomplete = () => resolve();
    });
    db.close();
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't safely load learning progress");
    expect(screen.getByRole("button", { name: "Retry loading progress" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Start learning" })).not.toBeInTheDocument();
  });

  it("restores heading focus through a progress-loading retry", async () => {
    expect((await studySetStorage.saveStudySet(fixture())).success).toBe(true);
    let finishRetry: (result: Awaited<ReturnType<typeof userProgressStorage.getStudySetProgress>>) => void = () => {};
    const pendingRetry = new Promise<Awaited<ReturnType<typeof userProgressStorage.getStudySetProgress>>>(
      (resolve) => { finishRetry = resolve; });
    vi.spyOn(userProgressStorage, "getStudySetProgress")
      .mockResolvedValueOnce({ success: false, error: "read-failed" })
      .mockReturnValueOnce(pendingRetry);
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Retry loading progress" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Learn", level: 1 })).toHaveFocus());
    finishRetry({ success: true, value: [] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Learn “Cities”" })).toHaveFocus());
  });

  it("shows a controlled storage error", async () => {
    vi.spyOn(studySetStorage, "getStudySet").mockResolvedValue({ success: false, error: "storage-unavailable" });
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't read this study set");
  });
});
