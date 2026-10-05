import { PortableIdSchema, StudySetSchema, type PortableId } from "@openstudy/schema";
import { eligibleQuestions } from "./learn.js";
import { FlashcardRatingSchema, type FlashcardRating, type FlashcardReview } from "./flashcard-progress.js";

export type FlashcardResult = { readonly questionId: PortableId; readonly rating: FlashcardRating };
export type FlashcardSession = {
  readonly studySetId: PortableId;
  readonly questionIds: readonly PortableId[];
  readonly currentIndex: number;
  readonly revealed: boolean;
  readonly results: readonly FlashcardResult[];
  readonly completed: boolean;
};
export type FlashcardFailure = { success: false; error: "invalid-study-set" | "invalid-category" |
  "invalid-count" | "invalid-session" | "invalid-rating" | "not-revealed" | "already-revealed" | "completed" };
type Outcome<T> = { success: true; value: T } | FlashcardFailure;
const ok = <T>(value: T): Outcome<T> => ({ success: true, value });
const fail = (error: FlashcardFailure["error"]): FlashcardFailure => ({ success: false, error });

export function createFlashcardSession(input: unknown, config: { categoryId: PortableId | null; count: number }): Outcome<FlashcardSession> {
  const parsed = StudySetSchema.safeParse(input);
  if (!parsed.success) return fail("invalid-study-set");
  const set = parsed.data;
  if (config.categoryId !== null && !set.categories.some((category) => category.id === config.categoryId)) return fail("invalid-category");
  const eligible = eligibleQuestions(set, config.categoryId);
  if (!Number.isSafeInteger(config.count) || config.count < 1 || config.count > eligible.length) return fail("invalid-count");
  return ok({ studySetId: set.id, questionIds: eligible.slice(0, config.count).map((question) => question.id),
    currentIndex: 0, revealed: false, results: [], completed: false });
}

function validSession(session: FlashcardSession): boolean {
  return PortableIdSchema.safeParse(session.studySetId).success && session.questionIds.length > 0 &&
    session.questionIds.every((id) => PortableIdSchema.safeParse(id).success) &&
    new Set(session.questionIds).size === session.questionIds.length &&
    Number.isSafeInteger(session.currentIndex) && session.currentIndex >= 0 && session.currentIndex <= session.questionIds.length &&
    typeof session.revealed === "boolean" && session.completed === (session.currentIndex === session.questionIds.length) &&
    (!session.completed || !session.revealed) && session.results.length === session.currentIndex &&
    session.results.every((result, index) => result.questionId === session.questionIds[index] && FlashcardRatingSchema.safeParse(result.rating).success);
}

export function revealFlashcard(session: FlashcardSession): Outcome<FlashcardSession> {
  if (!validSession(session)) return fail("invalid-session");
  if (session.completed) return fail("completed");
  if (session.revealed) return fail("already-revealed");
  return ok({ ...session, revealed: true });
}

export function rateFlashcard(session: FlashcardSession, rating: FlashcardRating): Outcome<{ session: FlashcardSession; review: FlashcardReview }> {
  if (!validSession(session)) return fail("invalid-session");
  if (session.completed) return fail("completed");
  if (!session.revealed) return fail("not-revealed");
  if (!FlashcardRatingSchema.safeParse(rating).success) return fail("invalid-rating");
  const questionId = session.questionIds[session.currentIndex]!;
  const currentIndex = session.currentIndex + 1;
  return ok({ session: { ...session, currentIndex, revealed: false,
    results: [...session.results, { questionId, rating }], completed: currentIndex === session.questionIds.length },
  review: { studySetId: session.studySetId, questionId, rating } });
}

export function summarizeFlashcardSession(session: FlashcardSession): { reviewed: number; again: number; knowIt: number } {
  return { reviewed: session.results.length, again: session.results.filter((result) => result.rating === "again").length,
    knowIt: session.results.filter((result) => result.rating === "know-it").length };
}
