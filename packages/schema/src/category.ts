import * as z from "zod";

import { NonBlankTextSchema, PortableIdSchema } from "./shared.js";

/** A deliberately flat topic/category registry for filtering and import fidelity. */
export const CategorySchema = z.strictObject({
  id: PortableIdSchema,
  label: NonBlankTextSchema,
});

export type Category = z.infer<typeof CategorySchema>;

