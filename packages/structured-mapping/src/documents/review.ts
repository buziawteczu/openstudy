import { CURRENT_SCHEMA_VERSION, NonBlankTextSchema, QuestionSchema, StudySetSchema, type Category, type Question, type StudySet } from "@openstudy/schema";
import type { MappingIdentity } from "../contracts.js";
import { canonicalId, validIdentity } from "../identity.js";
import { MAX_REVIEW_CHOICES, REVIEW_REASON_LABELS, type DocumentQuestionCandidate, type DocumentQuestions } from "./contracts.js";

export interface ReviewSession {
  readonly document: DocumentQuestions;
  readonly candidates: readonly DocumentQuestionCandidate[];
  readonly current: number;
  readonly nextChoice: number;
  readonly ungroupedReviewed: boolean;
}
export type ReviewAction =
  | { readonly type: "navigate"; readonly index: number }
  | { readonly type: "text"; readonly field: "prompt" | "category" | "explanation"; readonly value: string }
  | { readonly type: "choice-text"; readonly choiceId: string; readonly value: string }
  | { readonly type: "add-choice" }
  | { readonly type: "remove-choice"; readonly choiceId: string }
  | { readonly type: "correct"; readonly choiceId: string }
  | { readonly type: "confirm"; readonly value: boolean }
  | { readonly type: "exclude"; readonly value: boolean }
  | { readonly type: "ungrouped-reviewed"; readonly value: boolean };
export function createReviewSession(document: DocumentQuestions): ReviewSession {
  return { document, candidates: document.candidates, current: 0, nextChoice: 0, ungroupedReviewed: document.ungrouped.length === 0 };
}
export function reviewReducer(state: ReviewSession, action: ReviewAction): ReviewSession {
  if (action.type === "navigate") return Number.isSafeInteger(action.index) && action.index >= 0 && action.index < state.candidates.length
    ? { ...state, current: action.index } : state;
  if (action.type === "ungrouped-reviewed") return { ...state, ungroupedReviewed: action.value };
  const current = state.candidates[state.current];
  if (!current) return state;
  let candidate = current;
  let nextChoice = state.nextChoice;
  switch (action.type) {
    case "text": candidate = { ...current, [action.field]: action.value, confirmed: false }; break;
    case "choice-text":
      if (!current.choices.some((choice) => choice.temporaryId === action.choiceId)) return state;
      candidate = { ...current, confirmed: false, choices: current.choices.map((choice) =>
        choice.temporaryId === action.choiceId ? { ...choice, text: action.value } : choice) }; break;
    case "add-choice":
      if (current.choices.length >= MAX_REVIEW_CHOICES) return state;
      candidate = { ...current, confirmed: false, choices: [...current.choices,
        { temporaryId: current.temporaryId + ":added:" + nextChoice++, text: "" }] }; break;
    case "remove-choice": {
      if (!current.choices.some((choice) => choice.temporaryId === action.choiceId)) return state;
      const { correctChoiceId, ...rest } = current;
      candidate = { ...rest, confirmed: false, choices: current.choices.filter((choice) => choice.temporaryId !== action.choiceId),
        ...(correctChoiceId !== undefined && correctChoiceId !== action.choiceId ? { correctChoiceId } : {}) }; break;
    }
    case "correct": {
      const { correctChoiceId: _previous, ...rest } = current;
      candidate = { ...rest, confirmed: false,
        ...(current.choices.some((choice) => choice.temporaryId === action.choiceId) ? { correctChoiceId: action.choiceId } : {}) }; break;
    }
    case "confirm": candidate = { ...current, confirmed: action.value }; break;
    case "exclude": candidate = { ...current, excluded: action.value }; break;
  }
  return { ...state, nextChoice, candidates: state.candidates.map((entry, index) => index === state.current ? candidate : entry) };
}
export interface ReviewIssue {
  readonly target: "prompt" | "choices" | "correct" | "category" | "explanation" | "review";
  readonly message: string;
}
export type CandidateState = "ready" | "needs-review" | "incomplete" | "ignored";
export function inspectCandidate(candidate: DocumentQuestionCandidate): { status: CandidateState; issues: readonly ReviewIssue[] } {
  if (candidate.excluded) return { status: "ignored", issues: [] };
  const issues: ReviewIssue[] = [];
  if (!NonBlankTextSchema.safeParse(candidate.prompt).success) issues.push({ target: "prompt", message: "Question text must not be blank." });
  if (candidate.choices.length < 2) issues.push({ target: "choices", message: "At least two answers are required." });
  if (candidate.choices.length > MAX_REVIEW_CHOICES) issues.push({ target: "choices", message: "Keep at most 20 answers. Extra source answers remain available for comparison." });
  if (candidate.choices.some((choice) => !NonBlankTextSchema.safeParse(choice.text).success)) issues.push({ target: "choices", message: "Every answer needs non-blank text." });
  if (new Set(candidate.choices.map((choice) => choice.temporaryId)).size !== candidate.choices.length) issues.push({ target: "choices", message: "Answer identities must be unique." });
  for (const target of ["category", "explanation"] as const) if (candidate[target] !== "" && !NonBlankTextSchema.safeParse(candidate[target]).success) {
    issues.push({ target, message: (target === "category" ? "Category" : "Explanation") + " must contain text or be cleared." });
  }
  const incomplete = issues.length > 0;
  if (!candidate.choices.some((choice) => choice.temporaryId === candidate.correctChoiceId)) issues.push({ target: "correct", message: "Correct answer wasn't found. Choose one answer." });
  if (!candidate.confirmed) {
    issues.push(...candidate.reviewReasons.map((reason) => ({ target: "review" as const, message: REVIEW_REASON_LABELS[reason] })));
    issues.push({ target: "review", message: "Review the wording, answers and source, then confirm this question." });
  }
  return { status: incomplete ? "incomplete" : issues.length ? "needs-review" : "ready", issues };
}
export function reviewCounts(session: ReviewSession) {
  const excluded = session.candidates.filter((candidate) => candidate.excluded).length;
  const unresolved = session.candidates.filter((candidate) => !candidate.excluded && inspectCandidate(candidate).status !== "ready").length;
  return { total: session.candidates.length, reviewed: session.candidates.filter((candidate) => candidate.confirmed || candidate.excluded).length,
    included: session.candidates.length - excluded, excluded, unresolved };
}
export type DocumentReviewResult =
  | { readonly status: "ready"; readonly candidate: StudySet; readonly issues: readonly [] }
  | { readonly status: "invalid"; readonly issues: readonly string[] };

/** Final boundary only. Never expose partial canonical data, or allocate identity during grouping/editing. */
export function finalizeDocumentReview(session: ReviewSession, identity: MappingIdentity, title: string): DocumentReviewResult {
  const counts = reviewCounts(session);
  const issues: string[] = [];
  if (counts.unresolved) issues.push(counts.unresolved + " included questions still need attention.");
  if (!session.ungroupedReviewed) issues.push("Review the ungrouped source content and acknowledge that it will not become questions.");
  if (!counts.included) issues.push("Include at least one complete question.");
  if (!validIdentity(identity)) issues.push("Secure import identity is unavailable. Try a current browser.");
  if (!NonBlankTextSchema.safeParse(title).success) issues.push("Study set title must not be blank.");
  if (new Set(session.candidates.map((candidate) => candidate.temporaryId)).size !== session.candidates.length) issues.push("Question review identities must be unique.");
  if (issues.length) return { status: "invalid", issues };
  const categories = new Map<string, Category>();
  const questions: Question[] = [];
  const sourceId = canonicalId(identity, "source");
  session.candidates.forEach((candidate, index) => {
    if (candidate.excluded) return;
    let category: Category | undefined;
    if (candidate.category !== "") {
      category = categories.get(candidate.category);
      if (!category) { category = { id: canonicalId(identity, "category:" + index), label: candidate.category }; categories.set(candidate.category, category); }
    }
    const choices = candidate.choices.map((choice, choiceIndex) => ({ id: canonicalId(identity, "q:" + index + ":c:" + choiceIndex), text: choice.text }));
    const correctIndex = candidate.choices.findIndex((choice) => choice.temporaryId === candidate.correctChoiceId);
    const parsed = QuestionSchema.safeParse({
      id: canonicalId(identity, "q:" + index), type: "single-choice", prompt: candidate.prompt, choices,
      correctChoiceId: choices[correctIndex]?.id,
      ...(candidate.explanation === "" ? {} : { explanation: candidate.explanation }),
      ...(category ? { categoryIds: [category.id] } : {}),
      provenance: candidate.sourceBlockRefs.map((ref) => ({ sourceId, locator: ref.locator })),
    });
    if (parsed.success) questions.push(parsed.data);
    else issues.push("Question " + (index + 1) + " could not be validated. Check its fields and source references.");
  });
  if (issues.length) return { status: "invalid", issues };
  const source = session.document.sourceDocument.source;
  const parsed = StudySetSchema.safeParse({
    schemaVersion: CURRENT_SCHEMA_VERSION, id: canonicalId(identity, "set"), revision: 1, title,
    sources: [{ id: sourceId, label: source.label ?? source.originalFilename ?? source.key,
      ...(source.originalFilename === undefined ? {} : { originalFilename: source.originalFilename }) }],
    categories: [...categories.values()], questions,
  });
  return parsed.success ? { status: "ready", candidate: parsed.data, issues: [] }
    : { status: "invalid", issues: ["The complete study set could not be validated. Check the title and source details."] };
}
