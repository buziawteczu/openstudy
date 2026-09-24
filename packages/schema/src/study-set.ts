import * as z from "zod";

import { CategorySchema } from "./category.js";
import { CURRENT_SCHEMA_VERSION } from "./constants.js";
import { QuestionSchema } from "./question.js";
import { NonBlankTextSchema, PortableIdSchema } from "./shared.js";
import { SourceSchema } from "./source.js";

export const StudySetRevisionSchema = z.int().min(1);

function reportDuplicateIds(
  values: ReadonlyArray<{ id: string }>,
  collectionPath: "categories" | "questions" | "sources",
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  const itemLabel = {
    categories: "category",
    questions: "question",
    sources: "source",
  }[collectionPath];

  values.forEach((value, index) => {
    if (ids.has(value.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ${itemLabel} ID '${value.id}'`,
        path: [collectionPath, index, "id"],
      });
    }

    ids.add(value.id);
  });
}

export const StudySetSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    id: PortableIdSchema,
    revision: StudySetRevisionSchema,
    title: NonBlankTextSchema,
    description: NonBlankTextSchema.optional(),
    sources: z.array(SourceSchema).min(1),
    categories: z.array(CategorySchema),
    questions: z.array(QuestionSchema).min(1),
  })
  .superRefine((studySet, context) => {
    reportDuplicateIds(studySet.sources, "sources", context);
    reportDuplicateIds(studySet.categories, "categories", context);
    reportDuplicateIds(studySet.questions, "questions", context);

    const sourceIds = new Set(studySet.sources.map((source) => source.id));
    const categoryIds = new Set(
      studySet.categories.map((category) => category.id),
    );

    studySet.questions.forEach((question, questionIndex) => {
      question.provenance?.forEach((provenance, provenanceIndex) => {
        if (!sourceIds.has(provenance.sourceId)) {
          context.addIssue({
            code: "custom",
            message: `Provenance references missing source '${provenance.sourceId}'`,
            path: [
              "questions",
              questionIndex,
              "provenance",
              provenanceIndex,
              "sourceId",
            ],
          });
        }
      });

      question.categoryIds?.forEach((categoryId, categoryIndex) => {
        if (!categoryIds.has(categoryId)) {
          context.addIssue({
            code: "custom",
            message: `Question references missing category '${categoryId}'`,
            path: [
              "questions",
              questionIndex,
              "categoryIds",
              categoryIndex,
            ],
          });
        }
      });
    });
  });

export type StudySetRevision = z.infer<typeof StudySetRevisionSchema>;
export type StudySet = z.infer<typeof StudySetSchema>;
