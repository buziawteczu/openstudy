import * as z from "zod";

import { NonBlankTextSchema, PortableIdSchema } from "./shared.js";
import { QuestionProvenanceSchema } from "./source.js";

export const ChoiceSchema = z.strictObject({
  id: PortableIdSchema,
  text: NonBlankTextSchema,
});

const QuestionBaseShape = {
  id: PortableIdSchema,
  prompt: NonBlankTextSchema,
  explanation: NonBlankTextSchema.optional(),
  categoryIds: z.array(PortableIdSchema).optional(),
  provenance: z.array(QuestionProvenanceSchema).min(1).optional(),
} as const;

export const SingleChoiceQuestionSchema = z
  .strictObject({
    ...QuestionBaseShape,
    type: z.literal("single-choice"),
    choices: z.array(ChoiceSchema).min(2),
    correctChoiceId: PortableIdSchema,
  })
  .superRefine((question, context) => {
    const choiceIds = new Set<string>();

    question.choices.forEach((choice, index) => {
      if (choiceIds.has(choice.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate choice ID '${choice.id}'`,
          path: ["choices", index, "id"],
        });
      }

      choiceIds.add(choice.id);
    });

    if (!choiceIds.has(question.correctChoiceId)) {
      context.addIssue({
        code: "custom",
        message: "correctChoiceId must reference a choice in this question",
        path: ["correctChoiceId"],
      });
    }

    const categoryIds = new Set<string>();
    question.categoryIds?.forEach((categoryId, index) => {
      if (categoryIds.has(categoryId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate category ID '${categoryId}' on question`,
          path: ["categoryIds", index],
        });
      }

      categoryIds.add(categoryId);
    });
  });

/**
 * V1 intentionally contains one member. Add future question types here only
 * when their canonical data and study behavior are designed together.
 */
export const QuestionSchema = z.discriminatedUnion("type", [
  SingleChoiceQuestionSchema,
]);

export type Choice = z.infer<typeof ChoiceSchema>;
export type SingleChoiceQuestion = z.infer<
  typeof SingleChoiceQuestionSchema
>;
export type Question = z.infer<typeof QuestionSchema>;

