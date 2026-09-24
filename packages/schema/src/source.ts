import * as z from "zod";

import { NonBlankTextSchema, PortableIdSchema } from "./shared.js";

export const SourceSchema = z.strictObject({
  id: PortableIdSchema,
  label: NonBlankTextSchema,
  originalFilename: NonBlankTextSchema.optional(),
  externalId: NonBlankTextSchema.optional(),
});

export const QuestionProvenanceSchema = z.strictObject({
  sourceId: PortableIdSchema,
  externalId: NonBlankTextSchema.optional(),
  locator: NonBlankTextSchema.optional(),
});

export type Source = z.infer<typeof SourceSchema>;
export type QuestionProvenance = z.infer<typeof QuestionProvenanceSchema>;
