import assert from "node:assert/strict";
import { test } from "node:test";
import { StudySetSchema } from "@openstudy/schema";
import { createTestSession, selectTestAnswer, clearTestAnswer, goToTestQuestion, nextTestQuestion,
  previousTestQuestion, submitTest, summarizeTest, testMistakes, type TestSession } from "../src/index.js";

function fixture() {
  return StudySetSchema.parse({ schemaVersion: "1.0.0", id: "set.test", revision: 1, title: "Test",
    sources: [{ id: "source.test", label: "Questions" }],
    categories: [{ id: "topic.a", label: "Same" }, { id: "topic.b", label: "Same" }, { id: "topic.empty", label: "Empty" }],
    questions: Array.from({ length: 4 }, (_, index) => ({ id: `q.${index}`, type: "single-choice", prompt: `Prompt ${index}`,
      choices: [{ id: `c.${index}.no`, text: `Wrong ${index}` }, { id: `c.${index}.yes`, text: `Right ${index}` }],
      correctChoiceId: `c.${index}.yes`, explanation: `Explanation ${index}`,
      ...(index === 1 ? {} : { categoryIds: [index === 3 ? "topic.b" : "topic.a"] }) })) });
}
function value<T>(outcome: { success: true; value: T } | { success: false; error: string }): T {
  if (!outcome.success) throw new Error(outcome.error); return outcome.value;
}
const start = (count = 4, categoryId: string | null = null, shuffle = false, random = () => 0) =>
  value(createTestSession(fixture(), { count, categoryId, shuffle }, random));
function answer(session: TestSession, choiceId: string) { return value(selectTestAnswer(session, fixture(), choiceId)); }
function allCorrect(count = 4) {
  let session = start(count);
  for (let index = 0; index < count; index++) {
    session = answer(value(goToTestQuestion(session, index)), `c.${index}.yes`);
  }
  return session;
}

test("All topics includes uncategorized questions", () => assert.deepEqual(start().questionIds, ["q.0", "q.1", "q.2", "q.3"]));
test("category filtering uses IDs despite duplicate labels", () => assert.deepEqual(start(2, "topic.a").questionIds, ["q.0", "q.2"]));
test("invalid category is rejected", () => assert.deepEqual(createTestSession(fixture(), { count: 1, categoryId: "missing", shuffle: false }, () => 0), { success: false, error: "invalid-category" }));
test("empty category is rejected", () => assert.deepEqual(createTestSession(fixture(), { count: 1, categoryId: "topic.empty", shuffle: true }, () => 0), { success: false, error: "invalid-count" }));
for (const count of [0, -1, 5, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid count ${count} rejected`, () => {
  assert.deepEqual(createTestSession(fixture(), { count, categoryId: null, shuffle: false }, () => 0), { success: false, error: "invalid-count" });
});
test("unvalidated StudySet is rejected", () => assert.deepEqual(createTestSession({ ...fixture(), schemaVersion: "2.0.0" }, { count: 1, categoryId: null, shuffle: true }, () => 0), { success: false, error: "invalid-study-set" }));
test("invalid shuffle is rejected", () => assert.deepEqual(createTestSession(fixture(), { count: 1, categoryId: null, shuffle: null as unknown as boolean }, () => 0), { success: false, error: "invalid-shuffle" }));
test("non-shuffled selection respects count and canonical order without calling random", () => {
  assert.deepEqual(start(2, null, false, () => { throw new Error("must not run"); }).questionIds, ["q.0", "q.1"]);
});
test("Fisher-Yates consumes one supplied value per swap and shuffles before truncation", () => {
  let calls = 0;
  assert.deepEqual(start(2, null, true, () => { calls++; return 0; }).questionIds, ["q.1", "q.2"]);
  assert.equal(calls, 3);
});
test("the same random sequence produces deterministic order", () => {
  const random = () => { let index = 0; return () => [0.75, 0.1, 0.8][index++]!; };
  assert.deepEqual(start(4, null, true, random()), start(4, null, true, random()));
});
test("shuffled questions are unique and contain only eligible IDs", () => {
  assert.deepEqual(start(2, "topic.a", true).questionIds, ["q.2", "q.0"]);
  const ids = start(4, null, true, () => 0.999999).questionIds;
  assert.equal(new Set(ids).size, 4); assert.deepEqual([...ids].sort(), ["q.0", "q.1", "q.2", "q.3"]);
});
for (const random of [-1, 1, Infinity, NaN]) test(`random value ${random} rejected`, () => {
  assert.deepEqual(createTestSession(fixture(), { count: 1, categoryId: null, shuffle: true }, () => random), { success: false, error: "invalid-random-source" });
});
test("throwing random source returns a failure", () => assert.deepEqual(createTestSession(fixture(), { count: 2, categoryId: null, shuffle: true }, () => { throw new Error("failed"); }), { success: false, error: "invalid-random-source" }));
test("single eligible question needs no random values", () => assert.deepEqual(start(1, "topic.b", true, () => { throw new Error("unused"); }).questionIds, ["q.3"]));
test("choice order remains canonical after shuffle", () => {
  const set = fixture(); const choices = structuredClone(set.questions.map((q) => q.choices));
  value(createTestSession(set, { count: 4, categoryId: null, shuffle: true }, () => 0));
  assert.deepEqual(set.questions.map((q) => q.choices), choices);
});
test("session starts at question one with all answers explicitly unanswered", () => {
  const session = start(); assert.equal(session.currentIndex, 0); assert.equal(session.submitted, false);
  assert.deepEqual(session.answers, session.questionIds.map((questionId) => ({ questionId, selectedChoiceId: null })));
});
test("selection uses Choice.id and can change", () => {
  const first = answer(start(), "c.0.no"); const second = answer(first, "c.0.yes");
  assert.equal(first.answers[0]!.selectedChoiceId, "c.0.no"); assert.equal(second.answers[0]!.selectedChoiceId, "c.0.yes");
});
test("answer can be cleared", () => assert.equal(value(clearTestAnswer(answer(start(), "c.0.yes"))).answers[0]!.selectedChoiceId, null));
for (const choiceId of ["missing", "c.1.yes", "Wrong 0"]) test(`invalid choice ${choiceId} rejected`, () => {
  assert.deepEqual(selectTestAnswer(start(), fixture(), choiceId), { success: false, error: "invalid-choice" });
});
test("Next works while unanswered", () => { const next = value(nextTestQuestion(start())); assert.equal(next.currentIndex, 1); assert.equal(next.answers[0]!.selectedChoiceId, null); });
test("Previous restores an earlier answer", () => {
  const first = answer(start(), "c.0.yes"); const second = answer(value(nextTestQuestion(first)), "c.1.no");
  const previous = value(previousTestQuestion(second)); assert.equal(previous.currentIndex, 0);
  assert.deepEqual(previous.answers.slice(0, 2), [{ questionId: "q.0", selectedChoiceId: "c.0.yes" }, { questionId: "q.1", selectedChoiceId: "c.1.no" }]);
});
test("cannot navigate before first", () => assert.deepEqual(previousTestQuestion(start()), { success: false, error: "out-of-bounds" }));
test("cannot navigate beyond final", () => assert.deepEqual(nextTestQuestion(value(goToTestQuestion(start(), 3))), { success: false, error: "out-of-bounds" }));
for (const index of [-1, 4, 1.5, NaN]) test(`invalid navigation index ${index} rejected`, () => assert.deepEqual(goToTestQuestion(start(), index), { success: false, error: "out-of-bounds" }));
test("answers stay associated with Question.id in shuffled order", () => {
  const first = start(4, null, true); const selected = answer(first, "c.1.yes");
  assert.deepEqual(selected.answers[0], { questionId: "q.1", selectedChoiceId: "c.1.yes" });
  assert.equal(value(nextTestQuestion(selected)).answers[0]!.selectedChoiceId, "c.1.yes");
});
test("question order is stable through selection, clearing and navigation", () => {
  const first = start(4, null, true); const selected = answer(first, "c.1.no");
  const cleared = value(clearTestAnswer(selected)); const next = value(nextTestQuestion(cleared));
  assert.deepEqual(value(previousTestQuestion(next)).questionIds, first.questionIds);
});
test("active and selected state contain no correctness, explanation, question or answer text", () => {
  for (const session of [start(), answer(start(), "c.0.yes"), answer(start(), "c.0.no")]) {
    const serialized = JSON.stringify(session);
    for (const text of ["correct", "feedback", "Explanation", "Right", "Wrong", "Prompt", "results"]) assert.equal(serialized.includes(text), false);
  }
});
test("unanswered submission requires explicit permission and leaves state active", () => {
  const session = start(); assert.deepEqual(submitTest(session, fixture()), { success: false, error: "unanswered-questions" });
  assert.equal(session.submitted, false);
});
test("submission evaluates correct, wrong and unanswered separately with zero unanswered credit", () => {
  let session = answer(start(3), "c.0.yes"); session = answer(value(nextTestQuestion(session)), "c.1.no");
  const submitted = value(submitTest(session, fixture(), { allowUnanswered: true }));
  assert.equal(submitted.session.submitted, true);
  assert.deepEqual(submitted.result.questions, [{ questionId: "q.0", selectedChoiceId: "c.0.yes", correct: true },
    { questionId: "q.1", selectedChoiceId: "c.1.no", correct: false }, { questionId: "q.2", selectedChoiceId: null, correct: false }]);
  assert.deepEqual(summarizeTest(submitted.result), { total: 3, correct: 1, incorrect: 1, unanswered: 1, percentage: 33 });
});
test("all answered can submit without confirmation", () => assert.equal(value(submitTest(allCorrect(), fixture())).session.submitted, true));
test("submitted result and mistakes follow shuffled Test order", () => {
  const session = answer(start(4, null, true), "c.1.yes");
  const result = value(submitTest(session, fixture(), { allowUnanswered: true })).result;
  assert.deepEqual(result.questions.map((q) => q.questionId), session.questionIds);
  assert.deepEqual(testMistakes(result).map((q) => q.questionId), ["q.2", "q.3", "q.0"]);
});
test("mistakes include wrong and unanswered and exclude correct", () => {
  const session = answer(value(nextTestQuestion(answer(start(3), "c.0.yes"))), "c.1.no");
  const result = value(submitTest(session, fixture(), { allowUnanswered: true })).result;
  assert.deepEqual(testMistakes(result).map((q) => q.questionId), ["q.1", "q.2"]);
});
test("all-correct summary is 100 percent with no mistakes", () => {
  const result = value(submitTest(allCorrect(), fixture())).result;
  assert.deepEqual(summarizeTest(result), { total: 4, correct: 4, incorrect: 0, unanswered: 0, percentage: 100 }); assert.deepEqual(testMistakes(result), []);
});
test("all unanswered produces zero score and no answered-incorrect count", () => {
  assert.deepEqual(summarizeTest(value(submitTest(start(), fixture(), { allowUnanswered: true })).result), { total: 4, correct: 0, incorrect: 0, unanswered: 4, percentage: 0 });
});
test("percentage rounds to nearest integer", () => {
  const session = answer(value(nextTestQuestion(answer(start(3), "c.0.yes"))), "c.1.yes");
  assert.equal(summarizeTest(value(submitTest(session, fixture(), { allowUnanswered: true })).result).percentage, 67);
});
for (const [name, transition] of [
  ["select", (session: TestSession) => selectTestAnswer(session, fixture(), "c.3.yes")],
  ["clear", clearTestAnswer], ["next", nextTestQuestion], ["previous", previousTestQuestion],
  ["direct navigation", (session: TestSession) => goToTestQuestion(session, 0)],
  ["submit", (session: TestSession) => submitTest(session, fixture())],
] as const) test(`submitted Test rejects ${name}`, () => assert.deepEqual(transition(value(submitTest(allCorrect(), fixture())).session), { success: false, error: "submitted" }));
test("mismatched StudySet rejected for selection and submit", () => {
  const other = { ...fixture(), id: "set.other" };
  assert.deepEqual(selectTestAnswer(start(), other, "c.0.yes"), { success: false, error: "invalid-session" });
  assert.deepEqual(submitTest(start(), other, { allowUnanswered: true }), { success: false, error: "invalid-session" });
});
test("submission rejects missing questions and choices rather than scoring malformed state", () => {
  assert.deepEqual(submitTest({ ...start(), questionIds: ["missing"], answers: [{ questionId: "missing", selectedChoiceId: null }] }, fixture(), { allowUnanswered: true }), { success: false, error: "invalid-session" });
  const invalid = { ...start(), answers: start().answers.map((a, i) => i === 0 ? { ...a, selectedChoiceId: "missing" } : a) };
  assert.deepEqual(submitTest(invalid, fixture(), { allowUnanswered: true }), { success: false, error: "invalid-choice" });
});
test("malformed session identities, indices and answer associations are rejected", () => {
  for (const session of [{ ...start(), currentIndex: 9 }, { ...start(), questionIds: ["q.0", "q.0"] },
    { ...start(), answers: [] }, { ...start(), answers: [...start().answers].reverse() }])
    assert.deepEqual(nextTestQuestion(session), { success: false, error: "invalid-session" });
});
test("StudySet creation and submission do not mutate canonical input", () => {
  const set = fixture(); const before = structuredClone(set);
  value(createTestSession(set, { count: 4, categoryId: null, shuffle: true }, () => 0));
  value(submitTest(allCorrect(), set)); assert.deepEqual(set, before);
});
test("all transitions leave prior state and its arrays unchanged", () => {
  const original = start(); const before = structuredClone(original);
  original.answers.forEach(Object.freeze); Object.freeze(original.answers); Object.freeze(original.questionIds); Object.freeze(original);
  const selected = answer(original, "c.0.yes"); const moved = value(nextTestQuestion(selected));
  value(previousTestQuestion(moved)); value(clearTestAnswer(selected)); value(submitTest(selected, fixture(), { allowUnanswered: true }));
  assert.deepEqual(original, before); assert.equal(selected.submitted, false); assert.equal(selected.currentIndex, 0);
});
