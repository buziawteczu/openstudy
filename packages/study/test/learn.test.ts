import assert from "node:assert/strict";
import { test } from "node:test";
import { StudySetSchema } from "@openstudy/schema";
import {
  checkAnswer, clearAnswer, continueLearnSession, createLearnSession, eligibleQuestions, selectAnswer,
  updateUserProgress, UserProgressSchema,
} from "../src/index.js";

function set() {
  return StudySetSchema.parse({
    schemaVersion: "1.0.0", id: "set.one", revision: 1, title: "Cities",
    sources: [{ id: "source.one", label: "Questions" }],
    categories: [{ id: "category.europe", label: "Europe" }, { id: "category.americas", label: "Americas" }],
    questions: [
      { id: "question.portugal", type: "single-choice", prompt: "Capital of Portugal?",
        choices: [{ id: "choice.porto", text: "Porto" }, { id: "choice.lisbon", text: "Lisbon" }],
        correctChoiceId: "choice.lisbon", explanation: "Lisbon is the capital.", categoryIds: ["category.europe"] },
      { id: "question.uncategorized", type: "single-choice", prompt: "Which number?",
        choices: [{ id: "choice.one", text: "One" }, { id: "choice.two", text: "Two" }], correctChoiceId: "choice.one" },
      { id: "question.usa", type: "single-choice", prompt: "Capital of the USA?",
        choices: [{ id: "choice.newyork", text: "New York" }, { id: "choice.washington", text: "Washington" }],
        correctChoiceId: "choice.washington", categoryIds: ["category.americas"] },
    ],
  });
}
function start(count = 2, categoryId: string | null = null) {
  const result = createLearnSession(set(), { count, categoryId });
  assert.equal(result.success, true);
  if (!result.success) throw new Error("Could not start Learn");
  return result.value;
}
function choose(session: ReturnType<typeof start>, id: string) {
  const result = selectAnswer(session, set(), id);
  assert.equal(result.success, true);
  if (!result.success) throw new Error("Could not select answer");
  return result.value;
}
function check(session: ReturnType<typeof start>) {
  const result = checkAnswer(session, set());
  assert.equal(result.success, true);
  if (!result.success) throw new Error("Could not check answer");
  return result.value;
}

test("configuration filters by canonical category IDs, includes uncategorized in All, and keeps order/count", () => {
  const studySet = set();
  const before = structuredClone(studySet);
  assert.deepEqual(eligibleQuestions(studySet, null).map((question) => question.id), studySet.questions.map((question) => question.id));
  assert.deepEqual(start().questionIds, ["question.portugal", "question.uncategorized"]);
  assert.deepEqual(start(1, "category.americas").questionIds, ["question.usa"]);
  assert.deepEqual(start(1, "category.europe").questionIds, ["question.portugal"]);
  assert.deepEqual(start().questionIds, start().questionIds);
  assert.deepEqual(studySet, before);
  assert.deepEqual(createLearnSession(studySet, { count: 0, categoryId: null }), { success: false, error: "invalid-count" });
  assert.deepEqual(createLearnSession(studySet, { count: 4, categoryId: null }), { success: false, error: "invalid-count" });
  assert.deepEqual(createLearnSession(studySet, { count: 1.5, categoryId: null }), { success: false, error: "invalid-count" });
  assert.deepEqual(createLearnSession(studySet, { count: 1, categoryId: "missing" }), { success: false, error: "invalid-category" });
  assert.deepEqual(createLearnSession({ ...studySet, questions: [] }, { count: 1, categoryId: null }), { success: false, error: "invalid-study-set" });
});

test("selection uses Choice.id, can change or clear, and checking requires a choice", () => {
  const empty = start();
  assert.deepEqual(checkAnswer(empty, set()), { success: false, error: "no-selection" });
  assert.deepEqual(selectAnswer(empty, set(), "missing"), { success: false, error: "invalid-choice" });
  const wrong = choose(empty, "choice.porto");
  assert.equal(wrong.selectedChoiceId, "choice.porto");
  const changed = choose(wrong, "choice.lisbon");
  assert.equal(changed.selectedChoiceId, "choice.lisbon");
  const cleared = clearAnswer(changed);
  assert.equal(cleared.success && cleared.value.selectedChoiceId, null);
  assert.equal(empty.selectedChoiceId, null);
});

test("wrong checks never reveal correct identity or explanation, allow retries, and require resolution to continue", () => {
  const first = check(choose(start(), "choice.porto"));
  assert.equal(first.session.feedback, "wrong");
  assert.equal(first.session.resolved, false);
  assert.equal(first.session.attemptsOnCurrent, 1);
  assert.equal(first.checked.firstAttempt, true);
  assert.equal(first.checked.correct, false);
  assert.equal(JSON.stringify(first).includes("choice.lisbon"), false);
  assert.equal(JSON.stringify(first).includes("Lisbon is the capital"), false);
  assert.deepEqual(continueLearnSession(first.session), { success: false, error: "not-resolved" });
  const second = check(choose(first.session, "choice.porto"));
  assert.equal(second.session.attemptsOnCurrent, 2);
  const correct = check(choose(second.session, "choice.lisbon"));
  assert.equal(correct.session.resolved, true);
  assert.equal(correct.session.feedback, "correct");
  assert.equal(correct.checked.firstAttempt, false);
  assert.deepEqual(correct.session.results, [{ questionId: "question.portugal", firstAttemptCorrect: false }]);
  assert.deepEqual(selectAnswer(correct.session, set(), "choice.porto"), { success: false, error: "already-resolved" });
  const next = continueLearnSession(correct.session);
  assert.equal(next.success, true);
  if (!next.success) return;
  assert.equal(next.value.currentIndex, 1);
  assert.equal(next.value.selectedChoiceId, null);
  assert.equal(next.value.attemptsOnCurrent, 0);
  assert.equal(next.value.feedback, "none");
  assert.equal(next.value.resolved, false);
});

test("correct first try completes the final question and session summary distinguishes retries", () => {
  const first = check(choose(start(2), "choice.lisbon"));
  assert.equal(first.checked.firstAttempt, true);
  assert.equal(first.session.results[0]?.firstAttemptCorrect, true);
  const next = continueLearnSession(first.session);
  assert.equal(next.success, true);
  if (!next.success) return;
  const wrong = check(choose(next.value, "choice.two"));
  const right = check(choose(wrong.session, "choice.one"));
  const done = continueLearnSession(right.session);
  assert.equal(done.success, true);
  if (!done.success) return;
  assert.equal(done.value.completed, true);
  assert.equal(done.value.results.length, 2);
  assert.equal(done.value.results.filter((result) => result.firstAttemptCorrect).length, 1);
  assert.equal(done.value.results.filter((result) => !result.firstAttemptCorrect).length, 1);
  assert.deepEqual(continueLearnSession(done.value), { success: false, error: "completed" });
});

test("progress counts checked attempts and a later first-try success clears review", () => {
  const id = { studySetId: "set.one", questionId: "question.portugal" };
  const wrong = updateUserProgress(undefined, { ...id, firstAttempt: true, correct: false });
  assert.equal(wrong.success, true);
  if (!wrong.success) return;
  assert.deepEqual(wrong.progress, { ...id, attempts: 1, firstAttemptCorrect: false, eventualCorrect: false, needsReview: true });
  const again = updateUserProgress(wrong.progress, { ...id, firstAttempt: false, correct: false });
  assert.equal(again.success, true);
  if (!again.success) return;
  const resolved = updateUserProgress(again.progress, { ...id, firstAttempt: false, correct: true });
  assert.equal(resolved.success, true);
  if (!resolved.success) return;
  assert.deepEqual(resolved.progress, { ...id, attempts: 3, firstAttemptCorrect: false, eventualCorrect: true, needsReview: true });
  const recovered = updateUserProgress(resolved.progress, { ...id, firstAttempt: true, correct: true });
  assert.equal(recovered.success, true);
  if (!recovered.success) return;
  assert.deepEqual(recovered.progress, { ...id, attempts: 4, firstAttemptCorrect: true, eventualCorrect: true, needsReview: false });
  assert.equal(wrong.progress.attempts, 1);
  assert.equal(UserProgressSchema.safeParse(recovered.progress).success, true);
});

test("progress validation rejects malformed records, unrelated identity, and overflow", () => {
  const id = { studySetId: "set.one", questionId: "question.portugal" };
  assert.equal(UserProgressSchema.safeParse({ ...id, attempts: 0, firstAttemptCorrect: true, eventualCorrect: true, needsReview: false }).success, false);
  assert.equal(UserProgressSchema.safeParse({ ...id, attempts: 1, firstAttemptCorrect: true, eventualCorrect: false, needsReview: false }).success, false);
  assert.equal(UserProgressSchema.safeParse({ ...id, attempts: 1, firstAttemptCorrect: false, eventualCorrect: false, needsReview: false }).success, false);
  assert.equal(UserProgressSchema.safeParse({ ...id, attempts: 1, firstAttemptCorrect: "yes", eventualCorrect: true, needsReview: false }).success, false);
  assert.equal(UserProgressSchema.safeParse({ ...id, questionId: "bad id", attempts: 1, firstAttemptCorrect: true, eventualCorrect: true, needsReview: false }).success, false);
  assert.deepEqual(updateUserProgress(undefined, { ...id, firstAttempt: false, correct: true }), { success: false, error: "invalid-attempt" });
  const previous = { ...id, attempts: Number.MAX_SAFE_INTEGER, firstAttemptCorrect: true, eventualCorrect: true, needsReview: false };
  assert.deepEqual(updateUserProgress(previous, { ...id, firstAttempt: true, correct: true }), { success: false, error: "attempt-overflow" });
  assert.deepEqual(updateUserProgress({ ...previous, questionId: "other" }, { ...id, firstAttempt: true, correct: true }), { success: false, error: "invalid-attempt" });
});
