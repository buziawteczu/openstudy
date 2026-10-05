import { PortableIdSchema, StudySetSchema, type PortableId, type StudySet } from "@openstudy/schema";
import * as z from "zod";
import { eligibleQuestions } from "./learn.js";

export type TestAnswer = { readonly questionId: PortableId; readonly selectedChoiceId: PortableId | null };
/** Temporary selections only; correctness and canonical content do not belong here. */
export type TestSession = {
  readonly studySetId: PortableId;
  readonly questionIds: readonly PortableId[];
  readonly currentIndex: number;
  readonly answers: readonly TestAnswer[];
  readonly submitted: boolean;
};
export type TestQuestionResult = TestAnswer & { readonly correct: boolean };
export type TestResult = { readonly studySetId: PortableId; readonly questions: readonly TestQuestionResult[] };
export type TestSummary = { total: number; correct: number; incorrect: number; unanswered: number; percentage: number };
export type TestFailure = { success: false; error: "invalid-study-set" | "invalid-category" | "invalid-count" |
  "invalid-shuffle" | "invalid-random-source" | "invalid-session" | "invalid-choice" | "out-of-bounds" |
  "submitted" | "unanswered-questions" };
type Outcome<T> = { success: true; value: T } | TestFailure;
const ok = <T>(value: T): Outcome<T> => ({ success: true, value });
const fail = (error: TestFailure["error"]): TestFailure => ({ success: false, error });

const sessionSchema = z.strictObject({
  studySetId: PortableIdSchema,
  questionIds: z.array(PortableIdSchema).min(1),
  currentIndex: z.number().int().nonnegative().safe(),
  answers: z.array(z.strictObject({ questionId: PortableIdSchema, selectedChoiceId: PortableIdSchema.nullable() })),
  submitted: z.boolean(),
}).refine((value) => new Set(value.questionIds).size === value.questionIds.length &&
  value.currentIndex < value.questionIds.length && value.answers.length === value.questionIds.length &&
  value.answers.every((answer, index) => answer.questionId === value.questionIds[index]));

function activeError(session: TestSession): TestFailure | undefined {
  if (!sessionSchema.safeParse(session).success) return fail("invalid-session");
  if (session.submitted) return fail("submitted");
  return undefined;
}

export function createTestSession(input: unknown,
  config: { categoryId: PortableId | null; count: number; shuffle: boolean }, random: () => number): Outcome<TestSession> {
  const parsed = StudySetSchema.safeParse(input);
  if (!parsed.success) return fail("invalid-study-set");
  const set = parsed.data;
  if (config.categoryId !== null && !set.categories.some((category) => category.id === config.categoryId)) return fail("invalid-category");
  const eligible = eligibleQuestions(set, config.categoryId);
  if (!Number.isSafeInteger(config.count) || config.count < 1 || config.count > eligible.length) return fail("invalid-count");
  if (typeof config.shuffle !== "boolean") return fail("invalid-shuffle");
  const ids = eligible.map((question) => question.id);
  if (config.shuffle) {
    if (typeof random !== "function") return fail("invalid-random-source");
    try {
      for (let index = ids.length - 1; index > 0; index--) {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) return fail("invalid-random-source");
        const other = Math.floor(value * (index + 1));
        [ids[index], ids[other]] = [ids[other]!, ids[index]!];
      }
    } catch { return fail("invalid-random-source"); }
  }
  const questionIds = ids.slice(0, config.count);
  return ok({ studySetId: set.id, questionIds, currentIndex: 0,
    answers: questionIds.map((questionId) => ({ questionId, selectedChoiceId: null })), submitted: false });
}

export function selectTestAnswer(session: TestSession, studySet: StudySet, choiceId: PortableId): Outcome<TestSession> {
  const error = activeError(session);
  if (error) return error;
  if (session.studySetId !== studySet.id) return fail("invalid-session");
  const questionId = session.questionIds[session.currentIndex]!;
  const question = studySet.questions.find((item) => item.id === questionId);
  if (!question) return fail("invalid-session");
  if (!question.choices.some((choice) => choice.id === choiceId)) return fail("invalid-choice");
  return ok({ ...session, answers: session.answers.map((answer) => answer.questionId === questionId ?
    { questionId, selectedChoiceId: choiceId } : answer) });
}

export function clearTestAnswer(session: TestSession): Outcome<TestSession> {
  const error = activeError(session);
  if (error) return error;
  const questionId = session.questionIds[session.currentIndex]!;
  return ok({ ...session, answers: session.answers.map((answer) => answer.questionId === questionId ?
    { questionId, selectedChoiceId: null } : answer) });
}

export function goToTestQuestion(session: TestSession, index: number): Outcome<TestSession> {
  const error = activeError(session);
  if (error) return error;
  if (!Number.isSafeInteger(index) || index < 0 || index >= session.questionIds.length) return fail("out-of-bounds");
  return ok({ ...session, currentIndex: index });
}
export function nextTestQuestion(session: TestSession): Outcome<TestSession> {
  return goToTestQuestion(session, session.currentIndex + 1);
}
export function previousTestQuestion(session: TestSession): Outcome<TestSession> {
  return goToTestQuestion(session, session.currentIndex - 1);
}

/** This is the only Test transition that evaluates correctness. It never produces progress events. */
export function submitTest(session: TestSession, input: StudySet,
  options: { allowUnanswered: boolean } = { allowUnanswered: false }): Outcome<{ session: TestSession; result: TestResult }> {
  const error = activeError(session);
  if (error) return error;
  const parsed = StudySetSchema.safeParse(input);
  if (!parsed.success) return fail("invalid-study-set");
  if (parsed.data.id !== session.studySetId) return fail("invalid-session");
  if (options.allowUnanswered !== true && session.answers.some((answer) => answer.selectedChoiceId === null)) return fail("unanswered-questions");
  const canonicalQuestions = new Map(parsed.data.questions.map((question) => [question.id, question]));
  const questions: TestQuestionResult[] = [];
  for (const answer of session.answers) {
    const question = canonicalQuestions.get(answer.questionId);
    if (!question) return fail("invalid-session");
    if (answer.selectedChoiceId !== null && !question.choices.some((choice) => choice.id === answer.selectedChoiceId)) return fail("invalid-choice");
    questions.push({ ...answer, correct: answer.selectedChoiceId !== null && answer.selectedChoiceId === question.correctChoiceId });
  }
  return ok({ session: { ...session, submitted: true }, result: { studySetId: session.studySetId, questions } });
}

export function summarizeTest(result: TestResult): TestSummary {
  const total = result.questions.length;
  const correct = result.questions.filter((question) => question.correct).length;
  const unanswered = result.questions.filter((question) => question.selectedChoiceId === null).length;
  return { total, correct, incorrect: total - correct - unanswered, unanswered,
    percentage: total === 0 ? 0 : Math.round(correct / total * 100) };
}
export function testMistakes(result: TestResult): readonly TestQuestionResult[] {
  return result.questions.filter((question) => !question.correct);
}
