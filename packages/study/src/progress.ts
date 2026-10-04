import { PortableIdSchema } from "@openstudy/schema";
import * as z from "zod";

/** Durable per-question Learn state, independent of canonical StudySet content. */
export const UserProgressSchema = z.strictObject({
  studySetId: PortableIdSchema,
  questionId: PortableIdSchema,
  attempts: z.number().int().positive().safe(),
  firstAttemptCorrect: z.boolean(),
  eventualCorrect: z.boolean(),
  needsReview: z.boolean(),
}).refine((value) => value.firstAttemptCorrect ? value.eventualCorrect && !value.needsReview : value.needsReview,
  "First-attempt and review results are inconsistent");

export type UserProgress = z.infer<typeof UserProgressSchema>;
export type CheckedAnswer = {
  studySetId: string; questionId: string; firstAttempt: boolean; correct: boolean;
};

/** Applies one checked answer. The caller persists the returned detached value. */
export function updateUserProgress(previous: UserProgress | undefined, checked: CheckedAnswer):
  { success: true; progress: UserProgress } | { success: false; error: "invalid-attempt" | "attempt-overflow" } {
  if (previous && (previous.studySetId !== checked.studySetId || previous.questionId !== checked.questionId))
    return { success: false, error: "invalid-attempt" };
  if (!checked.firstAttempt && !previous) return { success: false, error: "invalid-attempt" };
  const attempts = (previous?.attempts ?? 0) + 1;
  if (!Number.isSafeInteger(attempts)) return { success: false, error: "attempt-overflow" };
  const candidate = {
    studySetId: checked.studySetId, questionId: checked.questionId, attempts,
    firstAttemptCorrect: checked.firstAttempt ? checked.correct : previous!.firstAttemptCorrect,
    eventualCorrect: checked.firstAttempt ? checked.correct : previous!.eventualCorrect || checked.correct,
    needsReview: checked.firstAttempt ? !checked.correct : previous!.needsReview,
  };
  const parsed = UserProgressSchema.safeParse(candidate);
  return parsed.success ? { success: true, progress: parsed.data } : { success: false, error: "invalid-attempt" };
}
