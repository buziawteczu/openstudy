import { StudySetSchema, type Question, type StudySet } from "@openstudy/schema";
import type { CheckedAnswer } from "./progress.js";

export type LearnResult = { readonly questionId: string; readonly firstAttemptCorrect: boolean };
export type LearnSession = {
  readonly studySetId: string;
  readonly questionIds: readonly string[];
  readonly currentIndex: number;
  readonly selectedChoiceId: string | null;
  readonly attemptsOnCurrent: number;
  readonly resolved: boolean;
  readonly feedback: "none" | "wrong" | "correct";
  readonly results: readonly LearnResult[];
  readonly completed: boolean;
};
export type LearnFailure = { success: false; error: "invalid-study-set" | "invalid-category" | "invalid-count" |
  "invalid-choice" | "no-selection" | "not-resolved" | "already-resolved" | "completed" | "invalid-session" };
type LearnSuccess<T> = { success: true; value: T };
type LearnOutcome<T> = LearnSuccess<T> | LearnFailure;
const ok = <T>(value: T): LearnSuccess<T> => ({ success: true, value });
const fail = (error: LearnFailure["error"]): LearnFailure => ({ success: false, error });

export function eligibleQuestions(studySet: StudySet, categoryId: string | null): Question[] {
  return studySet.questions.filter((question) => categoryId === null || question.categoryIds?.includes(categoryId));
}

export function createLearnSession(input: unknown, config: { categoryId: string | null; count: number }): LearnOutcome<LearnSession> {
  const parsed = StudySetSchema.safeParse(input);
  if (!parsed.success) return fail("invalid-study-set");
  const studySet = parsed.data;
  if (config.categoryId !== null && !studySet.categories.some((category) => category.id === config.categoryId)) return fail("invalid-category");
  const eligible = eligibleQuestions(studySet, config.categoryId);
  if (!Number.isSafeInteger(config.count) || config.count < 1 || config.count > eligible.length) return fail("invalid-count");
  return ok({
    studySetId: studySet.id, questionIds: eligible.slice(0, config.count).map((question) => question.id),
    currentIndex: 0, selectedChoiceId: null, attemptsOnCurrent: 0,
    resolved: false, feedback: "none", results: [], completed: false,
  });
}

function currentQuestion(session: LearnSession, studySet: StudySet): Question | undefined {
  if (session.studySetId !== studySet.id || session.completed) return undefined;
  const id = session.questionIds[session.currentIndex];
  return studySet.questions.find((question) => question.id === id);
}

export function selectAnswer(session: LearnSession, studySet: StudySet, choiceId: string): LearnOutcome<LearnSession> {
  if (session.completed) return fail("completed");
  if (session.resolved) return fail("already-resolved");
  const question = currentQuestion(session, studySet);
  if (!question) return fail("invalid-session");
  if (!question.choices.some((choice) => choice.id === choiceId)) return fail("invalid-choice");
  return ok({ ...session, selectedChoiceId: choiceId, feedback: "none" });
}

export function clearAnswer(session: LearnSession): LearnOutcome<LearnSession> {
  if (session.completed) return fail("completed");
  if (session.resolved) return fail("already-resolved");
  return ok({ ...session, selectedChoiceId: null, feedback: "none" });
}

export function checkAnswer(session: LearnSession, studySet: StudySet): LearnOutcome<{ session: LearnSession; checked: CheckedAnswer }> {
  if (session.completed) return fail("completed");
  if (session.resolved) return fail("already-resolved");
  const question = currentQuestion(session, studySet);
  if (!question) return fail("invalid-session");
  if (!session.selectedChoiceId) return fail("no-selection");
  if (!question.choices.some((choice) => choice.id === session.selectedChoiceId)) return fail("invalid-choice");
  if (!Number.isSafeInteger(session.attemptsOnCurrent + 1)) return fail("invalid-session");
  const correct = question.correctChoiceId === session.selectedChoiceId;
  const firstAttempt = session.attemptsOnCurrent === 0;
  return ok({
    session: {
      ...session, attemptsOnCurrent: session.attemptsOnCurrent + 1,
      resolved: correct, feedback: correct ? "correct" : "wrong",
      results: correct ? [...session.results, { questionId: question.id, firstAttemptCorrect: firstAttempt }] : session.results,
    },
    checked: { studySetId: studySet.id, questionId: question.id, firstAttempt, correct },
  });
}

export function continueLearnSession(session: LearnSession): LearnOutcome<LearnSession> {
  if (session.completed) return fail("completed");
  if (!session.resolved) return fail("not-resolved");
  if (session.currentIndex + 1 >= session.questionIds.length) return ok({ ...session, completed: true });
  return ok({ ...session, currentIndex: session.currentIndex + 1, selectedChoiceId: null,
    attemptsOnCurrent: 0, resolved: false, feedback: "none" });
}
