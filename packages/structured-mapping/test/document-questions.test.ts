import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDocument, type DocumentBlock, type ExtractedDocument, type PageTextBlock, type TextBlock } from "@openstudy/import-core";
import { PortableIdSchema, StudySetSchema } from "@openstudy/schema";
import {
  createReviewSession, extractDocumentQuestions, finalizeDocumentReview, inspectCandidate, reviewCounts, reviewReducer,
  type ReviewSession,
} from "../src/index.js";

let sequence = 0;
function p(text: string, kind: TextBlock["kind"] = "paragraph", options: Partial<TextBlock> = {}): TextBlock {
  const key = "block:" + sequence++;
  return { key, locator: key, kind, runs: [{ key: key + ":run", text }], ...options };
}
function page(number: number, lines: readonly string[]): PageTextBlock {
  return { kind: "page-text", key: "page:" + number, locator: "page:" + number, pageNumber: number, width: 612, height: 792,
    items: lines.map((text, index) => ({ key: "item:" + index, locator: "page:" + number + "/item:" + index, text,
      transform: [12, 0, 0, 12, 40, 750 - index * 25], width: 100, height: 12, direction: "ltr", hasLineBreak: true })) };
}
function extracted(blocks: readonly DocumentBlock[], format: "docx" | "pdf" = "docx"): ExtractedDocument {
  return { kind: "extracted-document", sourceDocument: { kind: "document-source", byteLength: 100, format,
    source: { key: "source:0", originalFilename: "exam." + format } }, blocks, hasEmbeddedMedia: false, warnings: [] };
}
const group = (blocks: readonly DocumentBlock[], format: "docx" | "pdf" = "docx") =>
  extractDocumentQuestions(normalizeDocument(extracted(blocks, format)));
const basic = () => group([p("1. Original prompt?"), p("A. First"), p("B) Second"), p("Correct answer: B")]);
const identity = { namespace: "0123456789abcdef0123456789abcdef" };
function complete(session: ReviewSession): ReviewSession {
  let result = session;
  for (let index = 0; index < result.candidates.length; index++) {
    result = reviewReducer(result, { type: "navigate", index });
    if (!result.candidates[index]!.correctChoiceId) result = reviewReducer(result, { type: "correct", choiceId: result.candidates[index]!.choices[0]!.temporaryId });
    result = reviewReducer(result, { type: "confirm", value: true });
  }
  return result;
}
test("DOCX numbered prompts, labeled alternatives and explicit marker retain exact wording", () => {
  const result = basic();
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0]!;
  assert.equal(candidate.prompt, "Original prompt?");
  assert.deepEqual(candidate.choices.map((choice) => choice.text), ["First", "Second"]);
  assert.equal(candidate.correctChoiceId, candidate.choices[1]!.temporaryId);
  assert.equal(candidate.sourceNumber, "1");
  assert.ok(candidate.evidence.includes("explicit-answer-marker"));
  assert.equal(candidate.sourceBlockRefs.length, 4);
});
test("multiple questions preserve source order, never sort by source number", () => {
  const result = group([p("7. First prompt"), p("A. a"), p("B. b"), p("2. Second prompt"), p("A. c"), p("B. d")]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.sourceNumber), ["7", "2"]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.prompt), ["First prompt", "Second prompt"]);
});
test("Question heading followed by paragraph and contiguous unlabeled list", () => {
  const result = group([p("Question 12", "heading"), p("Which signal?"),
    p("Green", "list-item", { list: { key: "list:1", level: 0 } }),
    p("Red", "list-item", { list: { key: "list:1", level: 0 } }), p("Answer: B")]);
  assert.equal(result.candidates[0]!.prompt, "Which signal?");
  assert.deepEqual(result.candidates[0]!.choices.map((choice) => choice.text), ["Green", "Red"]);
  assert.equal(result.candidates[0]!.correctChoiceId, undefined, "unresolved automatic list labels are not invented");
});
test("plain prompt followed by actual list is supported without question-mark semantics", () => {
  const result = group([p("Select an item"), p("x", "list-item"), p("y", "list-item")]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.choices.length, 2);
});
test("numeric alternatives are recognized only within actual list metadata", () => {
  const result = group([p("Question 1"), p("Prompt"), p("1. x", "list-item"), p("2. y", "list-item"), p("Answer: 2")]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.correctChoiceId, result.candidates[0]!.choices[1]!.temporaryId);
});
test("section heading is an editable, review-required suggestion", () => {
  const result = group([p("Safety", "heading"), p("1. Prompt"), p("A. x"), p("B. y")]);
  assert.equal(result.candidates[0]!.category, "Safety");
  assert.ok(result.candidates[0]!.reviewReasons.includes("category-suggestion"));
});
test("punctuation alone and arbitrary paragraphs do not create questions", () => {
  const result = group([p("Why?"), p("A normal paragraph"), p("Another paragraph")]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.ungrouped.length, 3);
});
test("orphan labeled choices are not promoted to prompts", () => {
  const result = group([p("A. x"), p("B. y")]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.ungrouped.length, 2);
});
test("ambiguous continuation stays in source context rather than becoming an answer", () => {
  const result = group([p("1. Prompt"), p("Additional text"), p("A. x"), p("B. y")]);
  assert.ok(result.candidates[0]!.reviewReasons.includes("ambiguous-boundary"));
  assert.equal(result.candidates[0]!.choices.length, 2);
});
test("bold choices preserve formatting evidence but never infer correctness", () => {
  const result = group([p("1. Prompt"), p("A. x", "paragraph", { runs: [{ key: "bold", text: "A. x", bold: true }] }), p("B. y")]);
  assert.ok(result.candidates[0]!.evidence.includes("formatting-present"));
  assert.equal(result.candidates[0]!.correctChoiceId, undefined);
});
test("tracked changes require source comparison", () => {
  const result = group([p("1. Prompt", "paragraph", { runs: [{ key: "revision", text: "1. Prompt", revision: "deleted" }] }), p("A. x"), p("B. y")]);
  assert.ok(result.candidates[0]!.reviewReasons.includes("source-revisions"));
});
test("a single choice is represented as incomplete", () => {
  assert.equal(inspectCandidate(group([p("1. Prompt"), p("A. x")]).candidates[0]!).status, "incomplete");
});
test("a missing answer is explicitly unresolved", () => {
  const candidate = group([p("1. Prompt"), p("A. x"), p("B. y")]).candidates[0]!;
  assert.ok(inspectCandidate(candidate).issues.some((issue) => issue.target === "correct"));
});
test("duplicate choice labels never resolve to the first match", () => {
  const candidate = group([p("1. Prompt"), p("A. x"), p("A. y"), p("Answer: A")]).candidates[0]!;
  assert.equal(candidate.correctChoiceId, undefined);
  assert.ok(candidate.reviewReasons.includes("ambiguous-choices"));
});
test("multiple markers never guess a correct answer, even when they agree", () => {
  const candidate = group([p("1. Prompt"), p("A. x"), p("B. y"), p("Answer: A"), p("Correct answer: A")]).candidates[0]!;
  assert.equal(candidate.correctChoiceId, undefined);
  assert.ok(candidate.reviewReasons.includes("multiple-answer-markers"));
});
test("explicit explanation is preserved without paraphrasing", () => {
  const candidate = group([p("1. Prompt"), p("A. x"), p("B. y"), p("Explanation:  Exact wording ") ]).candidates[0]!;
  assert.equal(candidate.explanation, "Exact wording ");
});
test("answer key associates by number, not order", () => {
  const firstKey = p("1. B");
  const result = group([p("2. Prompt2"), p("A. x"), p("B. y"), p("1. Prompt1"), p("A. a"), p("B. b"),
    p("Answer key", "heading"), firstKey, p("2. A")]);
  assert.equal(result.candidates[0]!.correctChoiceId, result.candidates[0]!.choices[0]!.temporaryId);
  assert.equal(result.candidates[1]!.correctChoiceId, result.candidates[1]!.choices[1]!.temporaryId);
  assert.ok(result.candidates[0]!.evidence.includes("explicit-answer-key-match"));
  assert.ok(result.candidates[1]!.sourceBlockRefs.some((ref) => ref.locator === firstKey.locator));
});
for (const entries of [["1. A", "1. B"], ["9. A"], ["malformed entry"]] as const) test("ambiguous/unmatched answer key: " + entries.join(", "), () => {
  const result = group([p("1. Prompt"), p("A. x"), p("B. y"), p("Answer key"), ...entries.map((entry) => p(entry))]);
  assert.equal(result.candidates[0]!.correctChoiceId, undefined);
  assert.ok(result.ungrouped.length > 0);
});
test("duplicate question numbers prevent unique answer-key pairing", () => {
  const result = group([p("1. Prompt"), p("A. x"), p("B. y"), p("1. Other"), p("A. a"), p("B. b"), p("Answer key"), p("1. A")]);
  assert.ok(result.candidates.every((candidate) => candidate.reviewReasons.includes("duplicate-question-number") && candidate.correctChoiceId === undefined));
});
function table(rows: readonly (readonly string[])[]): DocumentBlock {
  const key = "table:" + sequence++;
  return { kind: "table", key, locator: key, rows: rows.map((texts, row) => ({
    key: key + ":row:" + row, locator: key + "/row:" + row,
    cells: texts.map((text, cell) => ({ key: key + ":cell:" + row + ":" + cell, locator: key + "/row:" + row + "/cell:" + cell, columnSpan: 1, blocks: [p(text)] })),
  })) };
}
test("explicit question table supports one row per candidate", () => {
  const result = group([table([["Question", "A", "B", "Correct"], ["1. Prompt", "x", "y", "B"], ["2. Other", "a", "b", "A"]])]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0]!.correctChoiceId, result.candidates[0]!.choices[1]!.temporaryId);
  assert.ok(result.candidates[0]!.evidence.includes("explicit-question-table"));
});
test("explicit answer-key table matches question number", () => {
  const result = group([p("3. Prompt"), p("A. x"), p("B. y"), p("Answer key"),
    table([["Question", "Answer"], ["3", "B"]])]);
  assert.equal(result.candidates[0]!.correctChoiceId, result.candidates[0]!.choices[1]!.temporaryId);
});
test("unsupported tables remain ungrouped, never interpreted by arbitrary headers", () => {
  const result = group([table([["Code", "Meaning"], ["R", "Stop"]])]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.ungrouped[0]!.reason, "unsupported-table");
});
test("merged/irregular tables stay ungrouped", () => {
  const value = table([["Question", "A", "B", "Correct"], ["Prompt", "x"]]);
  assert.equal(group([value]).ungrouped[0]!.reason, "unsupported-table");
});
test("PDF numbered questions spanning pages preserve page/item provenance", () => {
  const result = group([page(1, ["1. Prompt", "A. x"]), page(2, ["B. y", "Answer: B", "2. Other", "A. a", "B. b"])], "pdf");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual([...new Set(result.candidates[0]!.sourceBlockRefs.map((ref) => ref.page))], [1, 2]);
  assert.ok(result.candidates[0]!.sourceBlockRefs.every((ref) => ref.locator.startsWith("page:")));
});
test("PDF answer key is deterministic by number across pages", () => {
  const result = group([page(1, ["1. Prompt", "A. x", "B. y"]), page(2, ["Answer key", "1. B"])], "pdf");
  assert.equal(result.candidates[0]!.correctChoiceId, result.candidates[0]!.choices[1]!.temporaryId);
});
test("PDF weak reading order always requires explicit human review", () => {
  const result = group([page(1, ["1. Prompt", "A. x", "B. y", "Answer: A"])], "pdf");
  assert.ok(result.candidates[0]!.reviewReasons.includes("pdf-reading-order"));
  assert.notEqual(inspectCandidate(result.candidates[0]!).status, "ready");
});
test("PDF baseline changes form lines without EOL and never reorder by coordinates", () => {
  const value = page(1, ["2. Prompt", "A. x", "B. y"]);
  const result = group([{ ...value, items: value.items.map((item, index) => ({ ...item, hasLineBreak: false,
    transform: [12, 0, 0, 12, 40, index * 25] })) }], "pdf");
  assert.equal(result.candidates[0]!.prompt, "Prompt");
  assert.deepEqual(result.candidates[0]!.choices.map((choice) => choice.text), ["x", "y"]);
});
test("PDF same-baseline items concatenate exact source text without invented spaces", () => {
  const value = page(1, ["1. ", "Prompt"]);
  const result = group([{ ...value, items: value.items.map((item) => ({ ...item, hasLineBreak: false, transform: [12, 0, 0, 12, 40, 750] })) }], "pdf");
  assert.equal(result.candidates[0]!.prompt, "Prompt");
  assert.match(result.candidates[0]!.sourceBlockRefs[0]!.locator, /through/);
});
for (const format of ["docx", "pdf"] as const) test(format + " grouping is deterministic and does not mutate the source", () => {
  const original = extracted(format === "docx" ? [p("1. Prompt"), p("A. x"), p("B. y")]
    : [page(1, ["1. Prompt", "A. x", "B. y"])], format);
  const snapshot = JSON.stringify(original);
  const normalized = normalizeDocument(original);
  assert.deepEqual(extractDocumentQuestions(normalized), extractDocumentQuestions(normalized));
  assert.equal(JSON.stringify(original), snapshot);
});
test("review prompt edits retain temporary identity and leave original candidate unchanged", () => {
  const session = createReviewSession(basic());
  const next = reviewReducer(session, { type: "text", field: "prompt", value: "Edited prompt" });
  assert.equal(next.candidates[0]!.temporaryId, session.candidates[0]!.temporaryId);
  assert.equal(session.candidates[0]!.prompt, "Original prompt?");
});
for (const field of ["category", "explanation"] as const) test("review can edit " + field, () => {
  const next = reviewReducer(createReviewSession(basic()), { type: "text", field, value: "User supplied text" });
  assert.equal(next.candidates[0]![field], "User supplied text");
});
test("review choice text edit retains temporary identity", () => {
  const session = createReviewSession(basic());
  const id = session.candidates[0]!.choices[0]!.temporaryId;
  const next = reviewReducer(session, { type: "choice-text", choiceId: id, value: "Edited" });
  assert.equal(next.candidates[0]!.choices[0]!.text, "Edited");
  assert.equal(next.candidates[0]!.choices[0]!.temporaryId, id);
});
test("add/remove choices never reuse temporary identities", () => {
  let session = reviewReducer(createReviewSession(basic()), { type: "add-choice" });
  const first = session.candidates[0]!.choices.at(-1)!.temporaryId;
  session = reviewReducer(session, { type: "remove-choice", choiceId: first });
  session = reviewReducer(session, { type: "add-choice" });
  assert.notEqual(session.candidates[0]!.choices.at(-1)!.temporaryId, first);
});
test("removing selected correct answer clears it", () => {
  const session = createReviewSession(basic());
  const next = reviewReducer(session, { type: "remove-choice", choiceId: session.candidates[0]!.correctChoiceId! });
  assert.equal(next.candidates[0]!.correctChoiceId, undefined);
  assert.equal(inspectCandidate(next.candidates[0]!).status, "incomplete");
});
test("select/change correct answer uses temporary choice identity", () => {
  const session = createReviewSession(basic());
  const next = reviewReducer(session, { type: "correct", choiceId: session.candidates[0]!.choices[0]!.temporaryId });
  assert.equal(next.candidates[0]!.correctChoiceId, next.candidates[0]!.choices[0]!.temporaryId);
});
test("editing a confirmed candidate invalidates confirmation", () => {
  const session = complete(createReviewSession(basic()));
  const next = reviewReducer(session, { type: "text", field: "prompt", value: "Correction" });
  assert.equal(next.candidates[0]!.confirmed, false);
  assert.equal(inspectCandidate(next.candidates[0]!).status, "needs-review");
});
test("unresolved included candidates block final readiness without partial candidate", () => {
  const result = finalizeDocumentReview(createReviewSession(basic()), identity, "Exam");
  assert.equal(result.status, "invalid");
  assert.equal("candidate" in result, false);
});
test("excluded unresolved candidate does not block ready included questions", () => {
  let session = createReviewSession(group([p("1. Prompt"), p("A. x"), p("B. y"), p("Answer: A"), p("2. Incomplete")]));
  session = reviewReducer(session, { type: "confirm", value: true });
  session = reviewReducer(session, { type: "navigate", index: 1 });
  session = reviewReducer(session, { type: "exclude", value: true });
  const result = finalizeDocumentReview(session, identity, "Exam");
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.equal(result.candidate.questions.length, 1);
  assert.deepEqual(reviewCounts(session), { total: 2, reviewed: 2, included: 1, excluded: 1, unresolved: 0 });
  session = reviewReducer(session, { type: "exclude", value: false });
  assert.equal(reviewCounts(session).unresolved, 1);
});
test("all excluded/empty document is invalid rather than an empty ready StudySet", () => {
  const excluded = reviewReducer(createReviewSession(basic()), { type: "exclude", value: true });
  assert.equal(finalizeDocumentReview(excluded, identity, "Exam").status, "invalid");
  assert.equal(finalizeDocumentReview(createReviewSession(group([])), identity, "Exam").status, "invalid");
});
test("ungrouped content requires an explicit acknowledgement", () => {
  let session = complete(createReviewSession(group([p("Introduction"), p("1. Prompt"), p("A. x"), p("B. y")])));
  assert.equal(finalizeDocumentReview(session, identity, "Exam").status, "invalid");
  session = reviewReducer(session, { type: "ungrouped-reviewed", value: true });
  assert.equal(finalizeDocumentReview(session, identity, "Exam").status, "ready");
});
test("category registry uses exact labels and first-occurrence IDs", () => {
  let session = complete(createReviewSession(group([p("1. Q1"), p("A. x"), p("B. y"), p("2. Q2"), p("A. x"), p("B. y"), p("3. Q3"), p("A. x"), p("B. y")])));
  for (const [index, value] of ["Safety", "Safety", " safety "].entries()) {
    session = reviewReducer(session, { type: "navigate", index });
    session = reviewReducer(session, { type: "text", field: "category", value });
    session = reviewReducer(session, { type: "confirm", value: true });
  }
  const result = finalizeDocumentReview(session, identity, "Exam");
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.candidate.categories.map((category) => category.label), ["Safety", " safety "]);
  assert.deepEqual(result.candidate.questions[0]!.categoryIds, result.candidate.questions[1]!.categoryIds);
});
for (const format of ["docx", "pdf"] as const) test(format + " final canonical IDs/schema/provenance/order/source fidelity", () => {
  const original = extracted(format === "docx" ? [p("2. Prompt2"), p("A. x"), p("B. y"), p("1. Prompt1"), p("A. a"), p("B. b")]
    : [page(1, ["2. Prompt2", "A. x", "B. y"]), page(2, ["1. Prompt1", "A. a", "B. b"])], format);
  const snapshot = JSON.stringify(original);
  const session = complete(createReviewSession(extractDocumentQuestions(normalizeDocument(original))));
  const result = finalizeDocumentReview(session, identity, "Exam");
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.ok(StudySetSchema.safeParse(result.candidate).success);
  assert.deepEqual(result.candidate.questions.map((question) => question.prompt), ["Prompt2", "Prompt1"]);
  for (const question of result.candidate.questions) {
    assert.ok(PortableIdSchema.safeParse(question.id).success);
    assert.ok(question.choices.every((choice) => PortableIdSchema.safeParse(choice.id).success));
    assert.ok(question.provenance!.every((ref) => ref.sourceId === result.candidate.sources[0]!.id));
  }
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(result.candidate.id, "os:" + identity.namespace + ":set");
});
for (const field of ["prompt", "category", "explanation"] as const) test("blank " + field + " is invalid (optional fields can instead be cleared)", () => {
  const session = complete(createReviewSession(basic()));
  const next = reviewReducer(reviewReducer(session, { type: "text", field, value: "  " }), { type: "confirm", value: true });
  assert.equal(finalizeDocumentReview(next, identity, "Exam").status, "invalid");
});
test("invalid/empty metadata and identity are structured failures", () => {
  const session = complete(createReviewSession(basic()));
  assert.equal(finalizeDocumentReview(session, identity, " ").status, "invalid");
  assert.equal(finalizeDocumentReview(session, { namespace: "invalid" }, "Exam").status, "invalid");
});
test("choice additions stop at 20 and source alternatives are not truncated during extraction", () => {
  let session = createReviewSession(basic());
  for (let i = 0; i < 30; i++) session = reviewReducer(session, { type: "add-choice" });
  assert.equal(session.candidates[0]!.choices.length, 20);
  const candidate = group([p("1. Q"), ...Array.from({ length: 21 }, (_, i) => p(String.fromCharCode(65 + i) + ". value"))]).candidates[0]!;
  assert.equal(candidate.choices.length, 21);
  assert.equal(inspectCandidate(candidate).status, "incomplete");
});
test("invalid navigation/actions leave review state intact", () => {
  const session = createReviewSession(basic());
  assert.equal(reviewReducer(session, { type: "navigate", index: -1 }), session);
  assert.equal(reviewReducer(session, { type: "navigate", index: 100 }), session);
  assert.equal(reviewReducer(session, { type: "remove-choice", choiceId: "missing" }), session);
});
test("source overlap is surfaced instead of deduplicating candidates", () => {
  const prompt = p("1. Prompt");
  const result = group([prompt, p("A. x"), p("B. y"), prompt, p("A. a"), p("B. b")]);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((candidate) => candidate.reviewReasons.includes("source-overlap")));
});
test("skipped or nonsequential labels require explicit answer-group review", () => {
  const result = group([p("1. Prompt"), p("A. x"), p("C. y"), p("Answer: C")]);
  assert.ok(result.candidates[0]!.reviewReasons.includes("ambiguous-choices"));
});
test("tracked changes in answer-marker paragraphs remain review evidence", () => {
  const result = group([p("1. Prompt"), p("A. x"), p("B. y"),
    p("Answer: B", "paragraph", { runs: [{ key: "marker-revision", text: "Answer: B", revision: "deleted" }] })]);
  assert.ok(result.candidates[0]!.reviewReasons.includes("source-revisions"));
});
test("heading without a prompt never consumes answer markers or key headings as wording", () => {
  const result = group([p("Question 1", "heading"), p("Answer: A"), p("A. x"), p("B. y")]);
  assert.equal(result.candidates[0]!.prompt, "");
  assert.equal(inspectCandidate(result.candidates[0]!).status, "incomplete");
});
test("extraction omissions are retained as readable review reasons", () => {
  const value = normalizeDocument(extracted([p("1. Prompt"), p("A. x"), p("B. y")]));
  const result = extractDocumentQuestions({ ...value, warnings: ["omitted-docx-parts"] });
  assert.ok(result.candidates[0]!.reviewReasons.includes("unsupported-content"));
});
