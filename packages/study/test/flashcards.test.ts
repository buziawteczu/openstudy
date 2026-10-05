import assert from "node:assert/strict";
import { test } from "node:test";
import { StudySetSchema } from "@openstudy/schema";
import { createFlashcardSession, revealFlashcard, rateFlashcard, summarizeFlashcardSession,
  FlashcardProgressSchema, updateFlashcardProgress, type FlashcardProgress, type FlashcardRating } from "../src/index.js";

function set() {
  return StudySetSchema.parse({ schemaVersion: "1.0.0", id: "set.cards", revision: 1, title: "Cards",
    sources: [{ id: "source.cards", label: "Cards" }],
    categories: [{ id: "topic.a", label: "Topic" }, { id: "topic.b", label: "Topic" }, { id: "topic.empty", label: "Empty" }],
    questions: [
      { id: "q.one", type: "single-choice", prompt: "First?", choices: [{ id: "c.no", text: "Alternative" }, { id: "c.yes", text: "Canonical answer" }], correctChoiceId: "c.yes", explanation: "Explanation text", categoryIds: ["topic.a"] },
      { id: "q.two", type: "single-choice", prompt: "Second?", choices: [{ id: "c.1", text: "One" }, { id: "c.2", text: "Two" }], correctChoiceId: "c.1" },
      { id: "q.three", type: "single-choice", prompt: "Third?", choices: [{ id: "c.3", text: "Three" }, { id: "c.4", text: "Four" }], correctChoiceId: "c.3", categoryIds: ["topic.b"] },
    ] });
}
function value<T>(result: { success: true; value: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.value;
}
const start = (count = 3, categoryId: string | null = null) => value(createFlashcardSession(set(), { count, categoryId }));
const ids = { studySetId: "set.cards", questionId: "q.one" };
function update(previous: FlashcardProgress | undefined, rating: FlashcardRating) {
  const result = updateFlashcardProgress(previous, { ...ids, rating });
  if (!result.success) throw new Error(result.error);
  return result.progress;
}

test("configuration matches category ID even when labels are equal", () => assert.deepEqual(start(1, "topic.b").questionIds, ["q.three"]));
test("All topics includes uncategorized questions", () => assert.deepEqual(start().questionIds, ["q.one", "q.two", "q.three"]));
test("requested count is respected", () => assert.deepEqual(start(2).questionIds, ["q.one", "q.two"]));
for (const count of [0, -1, 4, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
  test(`invalid count ${count} is rejected`, () => assert.deepEqual(createFlashcardSession(set(), { count, categoryId: null }), { success: false, error: "invalid-count" }));
test("invalid and empty categories cannot start", () => {
  assert.deepEqual(createFlashcardSession(set(), { count: 1, categoryId: "missing" }), { success: false, error: "invalid-category" });
  assert.deepEqual(createFlashcardSession(set(), { count: 1, categoryId: "topic.empty" }), { success: false, error: "invalid-count" });
});
test("unvalidated canonical content is rejected", () => assert.deepEqual(createFlashcardSession({ ...set(), schemaVersion: "2.0.0" }, { count: 1, categoryId: null }), { success: false, error: "invalid-study-set" }));
test("saved order is deterministic", () => assert.deepEqual(start(), start()));
test("session starts unrevealed with stable IDs and no results", () => assert.deepEqual(start(), {
  studySetId: "set.cards", questionIds: ["q.one", "q.two", "q.three"], currentIndex: 0, revealed: false, results: [], completed: false,
}));
test("unrevealed state exposes no answers, choices or correctChoiceId", () => {
  const serialized = JSON.stringify(start());
  for (const text of ["Canonical answer", "Alternative", "correctChoiceId", "c.yes", "choices"]) assert.equal(serialized.includes(text), false);
});
test("unrevealed state exposes no explanation", () => assert.equal(JSON.stringify(start()).includes("Explanation"), false));
test("reveal changes only reveal state and records no progress", () => {
  const initial = start(); const before = structuredClone(initial);
  assert.deepEqual(value(revealFlashcard(initial)), { ...initial, revealed: true });
  assert.deepEqual(initial, before);
  assert.deepEqual(initial.results, []);
});
test("rating before reveal is rejected", () => assert.deepEqual(rateFlashcard(start(), "again"), { success: false, error: "not-revealed" }));
for (const rating of ["again", "know-it"] as const)
  test(`${rating} records one result and a separate review event`, () => {
    const result = value(rateFlashcard(value(revealFlashcard(start())), rating));
    assert.deepEqual(result.session.results, [{ questionId: "q.one", rating }]);
    assert.deepEqual(result.review, { ...ids, rating });
    assert.equal("correct" in result.review, false);
  });
test("rating advances exactly one card and the next is unrevealed", () => {
  const next = value(rateFlashcard(value(revealFlashcard(start())), "again")).session;
  assert.equal(next.currentIndex, 1); assert.equal(next.revealed, false); assert.equal(next.completed, false);
  assert.deepEqual(next.questionIds, start().questionIds);
  assert.deepEqual(rateFlashcard(next, "again"), { success: false, error: "not-revealed" });
});
test("final rating completes and completed sessions reject further actions", () => {
  const done = value(rateFlashcard(value(revealFlashcard(start(1))), "know-it")).session;
  assert.equal(done.completed, true); assert.equal(done.currentIndex, 1); assert.equal(done.revealed, false);
  assert.deepEqual(rateFlashcard(done, "again"), { success: false, error: "completed" });
  assert.deepEqual(revealFlashcard(done), { success: false, error: "completed" });
});
test("summary counts Again and Know it without a grade", () => {
  let session = start();
  for (const rating of ["know-it", "again", "know-it"] as const) session = value(rateFlashcard(value(revealFlashcard(session)), rating)).session;
  assert.deepEqual(summarizeFlashcardSession(session), { reviewed: 3, again: 1, knowIt: 2 });
});
test("StudySet and session inputs are not mutated", () => {
  const studySet = set(); const before = structuredClone(studySet);
  const session = value(createFlashcardSession(studySet, { count: 1, categoryId: null }));
  const revealed = value(revealFlashcard(session)); const snapshot = structuredClone(revealed);
  rateFlashcard(revealed, "again");
  assert.deepEqual(studySet, before); assert.deepEqual(revealed, snapshot);
});
test("duplicate reveal, malformed session and invalid rating are rejected", () => {
  const revealed = value(revealFlashcard(start()));
  assert.deepEqual(revealFlashcard(revealed), { success: false, error: "already-revealed" });
  assert.deepEqual(revealFlashcard({ ...revealed, currentIndex: -1 }), { success: false, error: "invalid-session" });
  assert.deepEqual(rateFlashcard(revealed, "wrong" as FlashcardRating), { success: false, error: "invalid-rating" });
});
for (const rating of ["again", "know-it"] as const)
  test(`first ${rating} creates FlashcardProgress`, () => assert.deepEqual(update(undefined, rating), {
    ...ids, reviews: 1, againCount: rating === "again" ? 1 : 0, knowItCount: rating === "know-it" ? 1 : 0, lastRating: rating,
  }));
test("subsequent Again increments only againCount", () => assert.deepEqual(update(update(undefined, "know-it"), "again"), { ...ids, reviews: 2, againCount: 1, knowItCount: 1, lastRating: "again" }));
test("subsequent Know it increments only knowItCount", () => assert.deepEqual(update(update(undefined, "again"), "know-it"), { ...ids, reviews: 2, againCount: 1, knowItCount: 1, lastRating: "know-it" }));
test("counters remain consistent and lastRating follows the latest rating", () => {
  let previous: FlashcardProgress | undefined;
  for (const rating of ["again", "again", "know-it", "again", "know-it"] as const) {
    const before = previous && structuredClone(previous); const next = update(previous, rating);
    assert.deepEqual(previous, before); assert.equal(next.reviews, next.againCount + next.knowItCount);
    assert.equal(next.lastRating, rating); assert.equal(FlashcardProgressSchema.safeParse(next).success, true); previous = next;
  }
});
test("review overflow is rejected", () => assert.deepEqual(updateFlashcardProgress({ ...ids, reviews: Number.MAX_SAFE_INTEGER, againCount: Number.MAX_SAFE_INTEGER, knowItCount: 0, lastRating: "again" }, { ...ids, rating: "again" }), { success: false, error: "review-overflow" }));
test("malformed progress, identities and ratings are rejected", () => {
  const record = update(undefined, "again");
  for (const invalid of [{ ...record, reviews: 0 }, { ...record, reviews: 2 }, { ...record, againCount: -1 },
    { ...record, knowItCount: 0.5 }, { ...record, questionId: "bad id" }, { ...record, lastRating: "know-it" },
    { ...record, lastRating: "wrong" }, { ...record, due: "tomorrow" }]) {
    assert.equal(FlashcardProgressSchema.safeParse(invalid).success, false);
    assert.deepEqual(updateFlashcardProgress(invalid as FlashcardProgress, { ...ids, rating: "again" }), { success: false, error: "invalid-review" });
  }
  assert.deepEqual(updateFlashcardProgress(record, { ...ids, questionId: "different", rating: "again" }), { success: false, error: "invalid-review" });
  assert.deepEqual(updateFlashcardProgress(undefined, { ...ids, rating: "wrong" as FlashcardRating }), { success: false, error: "invalid-review" });
});
