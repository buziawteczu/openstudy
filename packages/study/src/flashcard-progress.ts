import { PortableIdSchema } from "@openstudy/schema";
import * as z from "zod";

export const FlashcardRatingSchema = z.enum(["again", "know-it"]);
export type FlashcardRating = z.infer<typeof FlashcardRatingSchema>;
export const FlashcardReviewSchema = z.strictObject({
  studySetId: PortableIdSchema,
  questionId: PortableIdSchema,
  rating: FlashcardRatingSchema,
});
export type FlashcardReview = z.infer<typeof FlashcardReviewSchema>;

/** Durable recall ratings, independent of Learn attempts and canonical content. */
export const FlashcardProgressSchema = z.strictObject({
  studySetId: PortableIdSchema,
  questionId: PortableIdSchema,
  reviews: z.number().int().positive().safe(),
  againCount: z.number().int().nonnegative().safe(),
  knowItCount: z.number().int().nonnegative().safe(),
  lastRating: FlashcardRatingSchema,
}).refine((value) => value.reviews === value.againCount + value.knowItCount &&
  (value.lastRating === "again" ? value.againCount > 0 : value.knowItCount > 0),
"Review counters and last rating are inconsistent");
export type FlashcardProgress = z.infer<typeof FlashcardProgressSchema>;

export function updateFlashcardProgress(previous: FlashcardProgress | undefined, review: FlashcardReview):
  { success: true; progress: FlashcardProgress } |
  { success: false; error: "invalid-review" | "review-overflow" } {
  const event = FlashcardReviewSchema.safeParse(review);
  const prior = previous === undefined ? undefined : FlashcardProgressSchema.safeParse(previous);
  if (!event.success || (prior && !prior.success)) return { success: false, error: "invalid-review" };
  if (prior && (prior.data!.studySetId !== event.data.studySetId || prior.data!.questionId !== event.data.questionId))
    return { success: false, error: "invalid-review" };
  const reviews = (previous?.reviews ?? 0) + 1;
  if (!Number.isSafeInteger(reviews)) return { success: false, error: "review-overflow" };
  const progress = FlashcardProgressSchema.safeParse({
    studySetId: event.data.studySetId, questionId: event.data.questionId, reviews,
    againCount: (previous?.againCount ?? 0) + (event.data.rating === "again" ? 1 : 0),
    knowItCount: (previous?.knowItCount ?? 0) + (event.data.rating === "know-it" ? 1 : 0),
    lastRating: event.data.rating,
  });
  return progress.success ? { success: true, progress: progress.data } : { success: false, error: "invalid-review" };
}
