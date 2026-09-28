import type { RecordCollection, SourceDescriptor, SourceValue } from "@openstudy/import-core";
import type { Question, StudySet } from "@openstudy/schema";

/** Object-key segments, not expressions or array indexes. Literal dots remain literal. */
export type FieldPath = readonly string[];
export type AnswerMode = "zero-based-index" | "one-based-index" | "choice-text";
export type MappingTarget = "prompt" | "choices" | "correctAnswer" | "category" | "explanation" | "externalId";

export interface MappingDefinition {
  readonly collectionKey: string;
  readonly promptPath: FieldPath;
  readonly choicesPath: FieldPath;
  readonly correctAnswer: { readonly path: FieldPath; readonly mode: AnswerMode };
  readonly categoryPath?: FieldPath;
  readonly explanationPath?: FieldPath;
  readonly externalIdPath?: FieldPath;
}

/** Supplied by the application once per selected collection, not by imported data. */
export interface MappingIdentity { readonly namespace: string }
export interface MappingInput {
  readonly source: SourceDescriptor;
  readonly collection: RecordCollection;
  readonly definition: MappingDefinition;
  readonly identity: MappingIdentity;
  readonly title: string;
  readonly description?: string;
}

export interface MappingIssue {
  /** Zero-based source position; null means a configuration/whole-candidate issue. */
  readonly recordIndex: number | null;
  readonly target: MappingTarget | "mapping" | "title" | "description" | "studySet";
  readonly code: string;
  readonly message: string;
}

export interface MappedValue {
  readonly path: FieldPath;
  readonly present: boolean;
  readonly value?: SourceValue;
}
export interface RecordPreview {
  readonly recordIndex: number;
  readonly values: Readonly<Partial<Record<MappingTarget, MappedValue>>>;
  readonly display: {
    readonly prompt?: string;
    readonly choices: readonly { readonly text: string; readonly correct: boolean }[];
    readonly category?: string;
    readonly explanation?: string;
  };
  readonly question?: Question;
  readonly issues: readonly MappingIssue[];
}
export interface MappingPreview {
  readonly records: readonly RecordPreview[];
  readonly issues: readonly MappingIssue[];
  readonly totalRecords: number;
}
interface ValidationSummary {
  readonly inspectedCount: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly issues: readonly MappingIssue[];
}
export type MappingResult =
  | (ValidationSummary & { readonly status: "ready"; readonly candidate: StudySet })
  | (ValidationSummary & { readonly status: "invalid" });

export const TARGET_LABELS: Readonly<Record<MappingIssue["target"], string>> = {
  prompt: "Question",
  choices: "Answers",
  correctAnswer: "Correct answer",
  category: "Topic / category",
  explanation: "Explanation",
  externalId: "Source record ID",
  mapping: "Mapping",
  title: "Study set title",
  description: "Description",
  studySet: "Study set",
};
