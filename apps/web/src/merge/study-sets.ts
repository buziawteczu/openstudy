import { StudySetSchema, type Category, type Question, type QuestionProvenance, type StudySet } from "@openstudy/schema";

export type MergeIssueCode = "revision-overflow" | "ambiguous-duplicate" | "ambiguous-category" |
  "source-id-collision" | "category-id-collision" | "question-id-collision" | "choice-id-collision";
export type MergeIssue = { readonly code: MergeIssueCode; readonly message: string; readonly incomingIndex?: number };
export type MergeQuestion = { readonly incomingIndex: number; readonly incomingId: string; readonly prompt: string };
export type ExactDuplicate = MergeQuestion & { readonly existingId: string };
export type MergePlan = {
  readonly existingId: string;
  readonly existingRevision: number;
  readonly incomingQuestionCount: number;
  readonly newQuestions: readonly MergeQuestion[];
  readonly exactDuplicates: readonly ExactDuplicate[];
  readonly newSources: readonly { id: string; label: string }[];
  readonly newCategories: readonly { id: string; label: string }[];
  readonly issues: readonly MergeIssue[];
};
export type MergeAnalysis = { success: true; plan: MergePlan } |
  { success: false; error: "invalid-existing" | "invalid-incoming" };
export type MergeApplication = { success: true; studySet: StudySet; plan: MergePlan } |
  { success: false; error: "invalid-existing" | "invalid-incoming" | "blocked" | "invalid-result" };

/** Exact canonical content, independent of identity, provenance and categories. */
export function questionFingerprint(question: Question): string {
  const correctPosition = question.choices.findIndex((choice) => choice.id === question.correctChoiceId);
  return JSON.stringify([
    question.type, question.prompt, question.choices.map((choice) => choice.text), correctPosition,
    Object.prototype.hasOwnProperty.call(question, "explanation"), question.explanation ?? null,
  ]);
}

function provenanceKey(value: QuestionProvenance): string {
  return JSON.stringify([
    value.sourceId,
    Object.prototype.hasOwnProperty.call(value, "externalId"), value.externalId ?? null,
    Object.prototype.hasOwnProperty.call(value, "locator"), value.locator ?? null,
  ]);
}

function union<T>(existing: readonly T[], incoming: readonly T[], key: (item: T) => string): T[] {
  const result = [...existing];
  const seen = new Set(existing.map(key));
  for (const item of incoming) {
    const id = key(item);
    if (!seen.has(id)) { result.push(item); seen.add(id); }
  }
  return result;
}

/** Pure analysis for a bounded UI preview; no IDs are generated or rewritten. */
export function analyzeStudySetMerge(existingInput: unknown, incomingInput: unknown): MergeAnalysis {
  const existingParsed = StudySetSchema.safeParse(existingInput);
  if (!existingParsed.success) return { success: false, error: "invalid-existing" };
  const incomingParsed = StudySetSchema.safeParse(incomingInput);
  if (!incomingParsed.success) return { success: false, error: "invalid-incoming" };
  const existing = existingParsed.data;
  const incoming = incomingParsed.data;
  const issues: MergeIssue[] = [];
  if (!Number.isSafeInteger(existing.revision + 1)) {
    issues.push({ code: "revision-overflow", message: "This study set cannot safely advance to another revision." });
  }

  const byContent = new Map<string, Question[]>();
  for (const question of existing.questions) {
    const key = questionFingerprint(question);
    const matches = byContent.get(key) ?? [];
    matches.push(question);
    byContent.set(key, matches);
  }
  const newQuestions: MergeQuestion[] = [];
  const exactDuplicates: ExactDuplicate[] = [];
  incoming.questions.forEach((question, incomingIndex) => {
    const matches = byContent.get(questionFingerprint(question)) ?? [];
    const item = { incomingIndex, incomingId: question.id, prompt: question.prompt };
    if (matches.length > 1) {
      issues.push({ code: "ambiguous-duplicate", incomingIndex,
        message: "This question matches more than one question already in the study set." });
    } else if (matches.length === 1) exactDuplicates.push({ ...item, existingId: matches[0]!.id });
    else newQuestions.push(item);
  });

  const referencedSourceIds = new Set(incoming.questions.flatMap((question) =>
    (question.provenance ?? []).map((entry) => entry.sourceId)));
  const newSources = incoming.sources.filter((source) => referencedSourceIds.has(source.id))
    .map(({ id, label }) => ({ id, label }));
  const existingSourceIds = new Set(existing.sources.map((source) => source.id));
  for (const source of newSources) if (existingSourceIds.has(source.id)) {
    issues.push({ code: "source-id-collision", message: "A new source ID conflicts with a saved source." });
  }

  const existingCategoriesByLabel = new Map<string, Category[]>();
  for (const category of existing.categories) {
    const matches = existingCategoriesByLabel.get(category.label) ?? [];
    matches.push(category);
    existingCategoriesByLabel.set(category.label, matches);
  }
  const incomingCategoriesById = new Map(incoming.categories.map((category) => [category.id, category]));
  const existingCategoryIds = new Set(existing.categories.map((category) => category.id));
  const seenLabels = new Set<string>();
  const newCategories: { id: string; label: string }[] = [];
  for (const question of incoming.questions) for (const categoryId of question.categoryIds ?? []) {
    const category = incomingCategoriesById.get(categoryId)!;
    if (seenLabels.has(category.label)) continue;
    seenLabels.add(category.label);
    const matches = existingCategoriesByLabel.get(category.label) ?? [];
    if (matches.length > 1) {
      issues.push({ code: "ambiguous-category", message: "A category label matches more than one saved category." });
    } else if (matches.length === 0) {
      newCategories.push({ id: category.id, label: category.label });
      if (existingCategoryIds.has(category.id)) {
        issues.push({ code: "category-id-collision", message: "A new category ID conflicts with a saved category." });
      }
    }
  }

  const existingQuestionIds = new Set(existing.questions.map((question) => question.id));
  const existingChoiceIds = new Set(existing.questions.flatMap((question) => question.choices.map((choice) => choice.id)));
  for (const item of newQuestions) {
    const question = incoming.questions[item.incomingIndex]!;
    if (existingQuestionIds.has(question.id)) {
      issues.push({ code: "question-id-collision", incomingIndex: item.incomingIndex,
        message: "A new question ID conflicts with a saved question." });
    }
    for (const choice of question.choices) {
      if (existingChoiceIds.has(choice.id)) {
        issues.push({ code: "choice-id-collision", incomingIndex: item.incomingIndex,
          message: "A new answer ID conflicts with a saved answer." });
      }
    }
  }
  return { success: true, plan: {
    existingId: existing.id, existingRevision: existing.revision,
    incomingQuestionCount: incoming.questions.length, newQuestions, exactDuplicates,
    newSources, newCategories, issues,
  } };
}

/** Re-analyzes before applying so a stale or edited preview is never trusted. */
export function applyStudySetMerge(existingInput: unknown, incomingInput: unknown): MergeApplication {
  const analysis = analyzeStudySetMerge(existingInput, incomingInput);
  if (!analysis.success) return analysis;
  const plan = analysis.plan;
  if (plan.issues.length) return { success: false, error: "blocked" };
  // Zod returns detached canonical values; neither caller-owned input is mutated.
  const existing = StudySetSchema.parse(existingInput);
  const incoming = StudySetSchema.parse(incomingInput);
  const categoryByLabel = new Map(existing.categories.map((category) => [category.label, category]));
  const incomingCategoryById = new Map(incoming.categories.map((category) => [category.id, category]));
  const categories = [...existing.categories];
  const categoryMap = new Map<string, string>();
  for (const question of incoming.questions) for (const id of question.categoryIds ?? []) {
    if (categoryMap.has(id)) continue;
    const sourceCategory = incomingCategoryById.get(id)!;
    let category = categoryByLabel.get(sourceCategory.label);
    if (!category) {
      category = sourceCategory;
      categoryByLabel.set(category.label, category);
      categories.push(category);
    }
    categoryMap.set(id, category.id);
  }
  const remapCategories = (question: Question) => question.categoryIds?.map((id) => categoryMap.get(id)!);
  const questions = [...existing.questions];
  const existingQuestionIndex = new Map(questions.map((question, index) => [question.id, index]));
  for (const duplicate of plan.exactDuplicates) {
    const index = existingQuestionIndex.get(duplicate.existingId)!;
    const current = questions[index]!;
    const added = incoming.questions[duplicate.incomingIndex]!;
    const provenance = union(current.provenance ?? [], added.provenance ?? [], provenanceKey);
    const categoryIds = union(current.categoryIds ?? [], remapCategories(added) ?? [], (id) => id);
    questions[index] = {
      ...current,
      ...(provenance.length || current.provenance ? { provenance } : {}),
      ...(categoryIds.length || current.categoryIds ? { categoryIds } : {}),
    };
  }
  for (const item of plan.newQuestions) {
    const question = incoming.questions[item.incomingIndex]!;
    questions.push({ ...question, ...(question.categoryIds ? { categoryIds: remapCategories(question) } : {}) });
  }
  const sourceIds = new Set(plan.newSources.map((source) => source.id));
  const result = StudySetSchema.safeParse({
    ...existing, revision: existing.revision + 1,
    sources: [...existing.sources, ...incoming.sources.filter((source) => sourceIds.has(source.id))],
    categories, questions,
  });
  return result.success ? { success: true, studySet: result.data, plan }
    : { success: false, error: "invalid-result" };
}
