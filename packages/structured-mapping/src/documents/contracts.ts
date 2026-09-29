import type { SourceDocument } from "@openstudy/import-core";

export interface SourceBlockRef {
  readonly blockKey: string;
  readonly locator: string;
  readonly page?: number;
}
export type Evidence = "explicit-question-number" | "contiguous-choice-list" | "labeled-choices"
  | "explicit-question-table" | "explicit-answer-marker" | "explicit-answer-key-match" | "formatting-present";
export type ReviewReason = "ambiguous-boundary" | "ambiguous-choices" | "multiple-answer-markers"
  | "unmatched-answer-key" | "duplicate-question-number" | "pdf-reading-order"
  | "category-suggestion" | "source-overlap" | "source-revisions" | "unsupported-content";
export interface CandidateChoice {
  readonly temporaryId: string;
  readonly text: string;
  readonly label?: string;
}
/** A review draft, not a canonical Question. Original text remains upstream. */
export interface DocumentQuestionCandidate {
  readonly temporaryId: string;
  readonly sourceBlockRefs: readonly SourceBlockRef[];
  readonly sourceNumber?: string;
  readonly prompt: string;
  readonly choices: readonly CandidateChoice[];
  readonly correctChoiceId?: string;
  readonly category: string;
  readonly explanation: string;
  readonly evidence: readonly Evidence[];
  readonly reviewReasons: readonly ReviewReason[];
  readonly confirmed: boolean;
  readonly excluded: boolean;
}
export interface UngroupedContent {
  readonly ref: SourceBlockRef;
  readonly text: string;
  readonly reason: "unrecognized-structure" | "unsupported-table" | "unmatched-answer-key";
}
export interface DocumentQuestions {
  readonly sourceDocument: SourceDocument;
  readonly candidates: readonly DocumentQuestionCandidate[];
  readonly ungrouped: readonly UngroupedContent[];
}
export const MAX_REVIEW_CHOICES = 20;
export const REVIEW_REASON_LABELS: Readonly<Record<ReviewReason, string>> = {
  "ambiguous-boundary": "Question boundary is unclear. Compare the source and correct the grouping.",
  "ambiguous-choices": "Answer labels or list grouping are unclear. Check every answer.",
  "multiple-answer-markers": "More than one answer marker was found. Choose the correct answer yourself.",
  "unmatched-answer-key": "An answer-key reference could not be matched uniquely. Check the source key.",
  "duplicate-question-number": "This question number appears more than once. Check the source numbering.",
  "pdf-reading-order": "PDF text order may differ from the page. Check the prompt and answer order against the original file.",
  "category-suggestion": "The section heading is a category suggestion. Keep, edit or clear it.",
  "source-overlap": "This source text contributes to more than one candidate. Check the boundaries.",
  "source-revisions": "The source contains tracked changes. Check the wording against the original file.",
  "unsupported-content": "Some source content was not extracted. Compare with the original file.",
};
export const EVIDENCE_LABELS: Readonly<Record<Evidence, string>> = {
  "explicit-question-number": "Question number found",
  "contiguous-choice-list": "Consecutive list answers",
  "labeled-choices": "Labeled answers",
  "explicit-question-table": "Explicit question table",
  "explicit-answer-marker": "Explicit answer marker",
  "explicit-answer-key-match": "Answer key matched by question number",
  "formatting-present": "Source formatting retained (not proof of correctness)",
};
