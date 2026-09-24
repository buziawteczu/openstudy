import * as z from "zod";

/**
 * Portable opaque IDs are deliberately not tied to UUID, ULID, or another
 * generator. They are stable stored identifiers, never content hashes.
 */
export const PORTABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const PortableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    PORTABLE_ID_PATTERN,
    "ID must start with an ASCII letter or digit and contain only letters, digits, '.', '_', ':', or '-'",
  );

export const NonBlankTextSchema = z
  .string()
  .min(1)
  .regex(/\S/, "Text must contain at least one non-whitespace character");

export type PortableId = z.infer<typeof PortableIdSchema>;

