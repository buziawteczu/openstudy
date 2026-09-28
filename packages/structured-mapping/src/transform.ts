import type { SourceValue } from "@openstudy/import-core";
import {
  CURRENT_SCHEMA_VERSION, NonBlankTextSchema, QuestionSchema, StudySetSchema,
  type Category, type Question,
} from "@openstudy/schema";
import {
  TARGET_LABELS, type FieldPath, type MappedValue, type MappingInput, type MappingIssue,
  type MappingPreview, type MappingResult, type MappingTarget, type RecordPreview,
} from "./contracts.js";
import { MAX_PATH_DEPTH, readField } from "./fields.js";

type SchemaProblem = { readonly code: string; readonly path: readonly PropertyKey[] };
type Registry = Map<string, Category>;
const id = (input: MappingInput, suffix: string) => "os:" + input.identity.namespace + ":" + suffix;
const pathValid = (path: unknown): path is FieldPath => Array.isArray(path)
  && path.length > 0 && path.length <= MAX_PATH_DEPTH && path.every((part) => typeof part === "string");
const issue = (recordIndex: number | null, target: MappingIssue["target"], code: string, message: string): MappingIssue =>
  ({ recordIndex, target, code, message });

function configurationIssues(input: MappingInput): MappingIssue[] {
  const definition = input.definition;
  if (!definition || definition.collectionKey !== input.collection.key) {
    return [issue(null, "mapping", "collection-mismatch", "Choose the collection this mapping belongs to.")];
  }
  if (!input.identity || !/^[a-f0-9]{32}$/.test(input.identity.namespace)) {
    return [issue(null, "mapping", "invalid-identity", "A new import identity is required. Choose the collection again.")];
  }
  const paths = [definition.promptPath, definition.choicesPath, definition.correctAnswer?.path];
  const optional = [definition.categoryPath, definition.explanationPath, definition.externalIdPath];
  if (paths.some((path) => !pathValid(path)) || optional.some((path) => path !== undefined && !pathValid(path))) {
    return [issue(null, "mapping", "invalid-path", "Select a source field for each required mapping.")];
  }
  if (!["zero-based-index", "one-based-index", "choice-text"].includes(definition.correctAnswer.mode)) {
    return [issue(null, "correctAnswer", "missing-answer-mode", "Choose how to interpret the correct answer.")];
  }
  return [];
}

function textProblem(value: SourceValue | undefined): string {
  if (value === undefined) return "The selected field is missing from this record.";
  if (typeof value === "string") return "Text must not be blank.";
  const found = value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "object" ? "an object" : typeof value;
  return "Expected text but found " + found + ".";
}

function schemaRecordIssue(problem: SchemaProblem, values: Partial<Record<MappingTarget, MappedValue>>, recordIndex: number): MappingIssue {
  const field = String(problem.path[0]);
  const target: MappingTarget = field === "provenance" ? "externalId" : field === "categoryIds" ? "category"
    : field === "correctChoiceId" ? "correctAnswer" : field === "choices" ? "choices"
    : field === "explanation" ? "explanation" : "prompt";
  let message: string;
  if (target === "choices") {
    const choices = values.choices?.value;
    message = !Array.isArray(choices) ? "Expected an array of answer strings."
      : problem.path.length === 1 && problem.code === "too_small" ? "At least two answers are required."
      : "Each answer must be non-blank text. Objects, numbers, and mixed answer arrays aren't supported.";
  } else if (target === "correctAnswer") {
    message = "The correct answer must identify an answer in this record.";
  } else {
    message = textProblem(values[target]?.value);
  }
  return issue(recordIndex, target, problem.code, message);
}

function transformRecord(input: MappingInput, recordIndex: number, categories: Registry): RecordPreview {
  const record = input.collection.records[recordIndex]!;
  const definition = input.definition;
  const paths: Partial<Record<MappingTarget, FieldPath>> = {
    prompt: definition.promptPath, choices: definition.choicesPath, correctAnswer: definition.correctAnswer.path,
    ...(definition.categoryPath ? { category: definition.categoryPath } : {}),
    ...(definition.explanationPath ? { explanation: definition.explanationPath } : {}),
    ...(definition.externalIdPath ? { externalId: definition.externalIdPath } : {}),
  };
  const values: Partial<Record<MappingTarget, MappedValue>> = {};
  for (const target of Object.keys(paths) as MappingTarget[]) values[target] = readField(record, paths[target]!);
  const issues: MappingIssue[] = [];
  const rawChoices = values.choices?.value;
  const choiceId = (index: number) => id(input, "q:" + recordIndex + ":c:" + index);
  const choices = Array.isArray(rawChoices)
    ? rawChoices.map((text, index) => ({ id: choiceId(index), text })) : rawChoices;
  let correctIndex: number | undefined;
  const answer = values.correctAnswer?.value;
  const strings = Array.isArray(rawChoices) && rawChoices.every((value) => typeof value === "string");
  if (strings) {
    const mode = definition.correctAnswer.mode;
    if (mode === "choice-text") {
      if (typeof answer !== "string") {
        issues.push(issue(recordIndex, "correctAnswer", "answer-not-text", "Exact answer matching requires a text value."));
      } else {
        const matches: number[] = [];
        rawChoices.forEach((choice, index) => { if (choice === answer) matches.push(index); });
        if (matches.length === 1) correctIndex = matches[0]!;
        else issues.push(issue(recordIndex, "correctAnswer", matches.length ? "ambiguous-answer" : "answer-not-found",
          matches.length ? "This answer text occurs more than once. Exact matching is ambiguous."
            : "No answer matches this text exactly. Case and whitespace are significant."));
      }
    } else if (typeof answer !== "number" || !Number.isSafeInteger(answer)) {
      issues.push(issue(recordIndex, "correctAnswer", "answer-not-integer", "Expected a whole-number answer index; text numbers aren't converted."));
    } else {
      const index = answer - (mode === "one-based-index" ? 1 : 0);
      if (index < 0 || index >= rawChoices.length) {
        issues.push(issue(recordIndex, "correctAnswer", "answer-out-of-range",
          "Index " + answer + " is outside the " + rawChoices.length + " available answers (" + (mode === "one-based-index" ? "one-based" : "zero-based") + ")."));
      } else correctIndex = index;
    }
  }
  let category: Category | undefined;
  if (values.category?.present) {
    const label = NonBlankTextSchema.safeParse(values.category.value);
    if (!label.success) issues.push(issue(recordIndex, "category", "invalid-category", textProblem(values.category.value)));
    else {
      category = categories.get(label.data);
      if (!category) {
        category = { id: id(input, "category:" + recordIndex), label: label.data };
        categories.set(label.data, category);
      }
    }
  }
  const candidate = {
    id: id(input, "q:" + recordIndex), type: "single-choice", prompt: values.prompt?.value,
    choices, correctChoiceId: choiceId(correctIndex ?? 0),
    ...(values.explanation?.present ? { explanation: values.explanation.value } : {}),
    ...(category ? { categoryIds: [category.id] } : {}),
    provenance: [{
      sourceId: id(input, "source"), locator: input.collection.key + "/record:" + recordIndex,
      ...(values.externalId?.present ? { externalId: values.externalId.value } : {}),
    }],
  };
  const parsed = QuestionSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      if (problem.path[0] === "correctChoiceId" && (!strings || correctIndex === undefined)) continue;
      const mapped = schemaRecordIssue(problem, values, recordIndex);
      // One concise message per target, not duplicate schema checks/answer errors.
      if (!issues.some((entry) => entry.target === mapped.target && entry.message === mapped.message)) issues.push(mapped);
    }
  }
  const prompt = NonBlankTextSchema.safeParse(values.prompt?.value);
  const explanation = NonBlankTextSchema.safeParse(values.explanation?.value);
  return {
    recordIndex, values,
    display: {
      ...(prompt.success ? { prompt: prompt.data } : {}),
      choices: Array.isArray(rawChoices) ? rawChoices.flatMap((text, index) =>
        typeof text === "string" ? [{ text, correct: index === correctIndex }] : []) : [],
      ...(category ? { category: category.label } : {}),
      ...(explanation.success ? { explanation: explanation.data } : {}),
    },
    ...(parsed.success && issues.length === 0 ? { question: parsed.data } : {}),
    issues,
  };
}

/** Always bounded to the first three attempted records, including failures. */
export function previewMapping(input: MappingInput): MappingPreview {
  const issues = configurationIssues(input);
  const categories: Registry = new Map();
  const records = issues.length ? [] : input.collection.records.slice(0, 3)
    .map((_, index) => transformRecord(input, index, categories));
  return { records, issues, totalRecords: input.collection.records.length };
}

/** On-demand inspection; does not scan the dataset or expose a partial StudySet. */
export function inspectRecord(input: MappingInput, recordIndex: number): RecordPreview | undefined {
  if (configurationIssues(input).length || !Number.isSafeInteger(recordIndex)
    || recordIndex < 0 || recordIndex >= input.collection.records.length) return undefined;
  return transformRecord(input, recordIndex, new Map());
}

/** The only complete-candidate boundary. Never returns a candidate with dropped records. */
export function validateMapping(input: MappingInput): MappingResult {
  const issues = configurationIssues(input);
  if (issues.length) return { status: "invalid", inspectedCount: 0, validCount: 0, invalidCount: 0, issues };
  const categories: Registry = new Map();
  const questions: Question[] = [];
  let invalidCount = 0;
  input.collection.records.forEach((_, index) => {
    const result = transformRecord(input, index, categories);
    if (result.question) questions.push(result.question);
    else { invalidCount++; issues.push(...result.issues); }
  });
  const summary = { inspectedCount: input.collection.records.length, validCount: questions.length, invalidCount };
  if (invalidCount) return { status: "invalid", ...summary, issues };
  const source = input.source;
  const candidate = {
    schemaVersion: CURRENT_SCHEMA_VERSION, id: id(input, "set"), revision: 1, title: input.title,
    ...(input.description === undefined ? {} : { description: input.description }),
    sources: [{
      id: id(input, "source"), label: source.label ?? source.originalFilename ?? source.key,
      ...(source.originalFilename === undefined ? {} : { originalFilename: source.originalFilename }),
    }],
    categories: [...categories.values()], questions,
  };
  const parsed = StudySetSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      const target = problem.path[0] === "title" ? "title" : problem.path[0] === "description" ? "description" : "studySet";
      const message = target === "title" || target === "description"
        ? TARGET_LABELS[target] + " must be non-blank text."
        : problem.path[0] === "questions" && questions.length === 0
          ? "This collection is empty. Choose a collection with question records."
          : "The complete study set could not be validated. Check the source details or choose another file.";
      if (!issues.some((entry) => entry.target === target && entry.message === message)) {
        issues.push(issue(null, target, "canonical-" + problem.code, message));
      }
    }
    return { status: "invalid", ...summary, issues };
  }
  return { status: "ready", ...summary, issues: [], candidate: parsed.data };
}
