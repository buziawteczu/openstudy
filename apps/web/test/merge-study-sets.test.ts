import fixture from "../../../packages/schema/test/fixtures/1.0.0/minimal.json";
import { StudySetSchema, type StudySet } from "@openstudy/schema";
import { describe, expect, it } from "vitest";
import { analyzeStudySetMerge, applyStudySetMerge, questionFingerprint } from "../src/merge/study-sets.js";

const base = () => StudySetSchema.parse(structuredClone(fixture));
function incoming(): StudySet {
  const set = base();
  set.id = "incoming.set";
  set.title = "Should not replace title";
  set.sources[0]!.id = "incoming.source";
  set.sources[0]!.originalFilename = "questions.json";
  set.questions[0]!.id = "incoming.question";
  set.questions[0]!.choices[0]!.id = "incoming.choice.a";
  set.questions[0]!.choices[1]!.id = "incoming.choice.b";
  set.questions[0]!.correctChoiceId = "incoming.choice.a";
  set.questions[0]!.provenance = [{ sourceId: "incoming.source", locator: "record:1" }];
  return set;
}
function merge(existing: StudySet, added: StudySet) {
  const result = applyStudySetMerge(existing, added);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  return result.studySet;
}
function issue(existing: StudySet, added: StudySet, code: string) {
  const analysis = analyzeStudySetMerge(existing, added);
  expect(analysis.success).toBe(true);
  if (!analysis.success) return;
  expect(analysis.plan.issues.map((entry) => entry.code)).toContain(code);
  expect(applyStudySetMerge(existing, added)).toEqual({ success: false, error: "blocked" });
}

describe("canonical StudySet merge", () => {
  it("preserves aggregate metadata and existing question identity, and appends new content in order", () => {
    const existing = base();
    existing.description = "Saved description";
    const added = incoming();
    added.questions[0]!.prompt = "A genuinely new question?";
    const before = structuredClone(existing);
    const incomingBefore = structuredClone(added);
    const result = merge(existing, added);
    expect(result.id).toBe(before.id);
    expect(result.title).toBe(before.title);
    expect(result.description).toBe(before.description);
    expect(result.revision).toBe(2);
    expect(result.questions.map((entry) => entry.id)).toEqual([before.questions[0]!.id, added.questions[0]!.id]);
    expect(result.questions[0]).toEqual(before.questions[0]);
    expect(result.questions[1]!.choices).toEqual(added.questions[0]!.choices);
    expect(result.sources.map((source) => source.id)).toEqual([before.sources[0]!.id, added.sources[0]!.id]);
    expect(StudySetSchema.safeParse(result).success).toBe(true);
    expect(existing).toEqual(before);
    expect(added).toEqual(incomingBefore);
  });

  it("keeps one exact question and its choices while unioning provenance and categories", () => {
    const existing = base();
    existing.questions[0]!.provenance = [{ sourceId: existing.sources[0]!.id, locator: "record:1" }];
    existing.categories = [{ id: "category.safety", label: "Safety" }];
    existing.questions[0]!.categoryIds = ["category.safety"];
    const added = incoming();
    added.categories = [{ id: "incoming.safety", label: "Safety" }, { id: "incoming.signals", label: "Signals" }];
    added.questions[0]!.categoryIds = added.categories.map((category) => category.id);
    added.questions[0]!.provenance!.push({ sourceId: "incoming.source", locator: "record:1" });
    const result = merge(existing, added);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.id).toBe(existing.questions[0]!.id);
    expect(result.questions[0]!.choices).toEqual(existing.questions[0]!.choices);
    expect(result.questions[0]!.provenance).toEqual([
      existing.questions[0]!.provenance![0], added.questions[0]!.provenance![0],
    ]);
    expect(result.questions[0]!.categoryIds).toEqual(["category.safety", "incoming.signals"]);
    expect(result.categories.map((category) => category.id)).toEqual(["category.safety", "incoming.signals"]);
    expect(result.sources).toHaveLength(2); // Same filename is not a source identity.
  });

  it("uses structural exact content including order, correct position, and explanation presence", () => {
    const original = base().questions[0]!;
    const copy = structuredClone(original);
    copy.id = "other";
    copy.choices[0]!.id = "other.a";
    copy.choices[1]!.id = "other.b";
    copy.correctChoiceId = "other.a";
    copy.categoryIds = ["ignored"];
    expect(questionFingerprint(copy)).toBe(questionFingerprint(original));
    for (const changed of [
      { ...copy, prompt: copy.prompt.toLowerCase() },
      { ...copy, prompt: ` ${copy.prompt}` },
      { ...copy, choices: [...copy.choices].reverse() },
      { ...copy, correctChoiceId: "other.b" },
      { ...copy, explanation: "" },
      { ...copy, explanation: "Why" },
    ]) expect(questionFingerprint(changed)).not.toBe(questionFingerprint(original));
  });

  it("blocks ambiguous saved duplicates without selecting one", () => {
    const existing = base();
    existing.questions.push({ ...structuredClone(existing.questions[0]!), id: "second.question" });
    issue(existing, incoming(), "ambiguous-duplicate");
  });

  it("keeps incoming repeated questions rather than silently selecting a winner", () => {
    const added = incoming();
    added.questions[0]!.prompt = "New question";
    added.questions.push({ ...structuredClone(added.questions[0]!), id: "another.new.question" });
    const result = merge(base(), added);
    expect(result.questions).toHaveLength(3);
    expect(result.questions.slice(1).map((question) => question.id)).toEqual(["incoming.question", "another.new.question"]);
  });

  it("blocks source, category, question, and choice collisions", () => {
    const existing = base();
    const source = incoming(); source.sources[0]!.id = existing.sources[0]!.id;
    source.questions[0]!.provenance = [{ sourceId: source.sources[0]!.id }];
    issue(existing, source, "source-id-collision");
    const category = incoming();
    existing.categories = [{ id: "old.category", label: "Old" }];
    category.categories = [{ id: "old.category", label: "New" }];
    category.questions[0]!.categoryIds = ["old.category"];
    issue(existing, category, "category-id-collision");
    const question = incoming(); question.questions[0]!.prompt = "New";
    question.questions[0]!.id = existing.questions[0]!.id;
    issue(existing, question, "question-id-collision");
    const choice = incoming(); choice.questions[0]!.prompt = "New";
    choice.questions[0]!.choices[0]!.id = existing.questions[0]!.choices[0]!.id;
    choice.questions[0]!.correctChoiceId = choice.questions[0]!.choices[0]!.id;
    issue(existing, choice, "choice-id-collision");
  });

  it("blocks unsafe revision increment and invalid input", () => {
    const existing = base(); existing.revision = Number.MAX_SAFE_INTEGER;
    issue(existing, incoming(), "revision-overflow");
    expect(analyzeStudySetMerge({ ...base(), questions: [] }, incoming())).toEqual({ success: false, error: "invalid-existing" });
    expect(analyzeStudySetMerge(base(), { ...incoming(), questions: [] })).toEqual({ success: false, error: "invalid-incoming" });
  });
});
