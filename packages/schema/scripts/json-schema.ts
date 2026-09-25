import * as z from "zod";

import {
  CURRENT_SCHEMA_VERSION,
  StudySetSchema,
} from "../src/index.js";

export function createStudySetJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(StudySetSchema, {
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: `urn:openstudy:schema:study-set:${CURRENT_SCHEMA_VERSION}`,
    title: "OpenStudy StudySet",
    description: `Canonical OpenStudy StudySet schema ${CURRENT_SCHEMA_VERSION}`,
  };
}
