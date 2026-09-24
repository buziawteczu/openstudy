import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import { createStudySetJsonSchema } from "../scripts/json-schema.js";
import { StudySetSchema } from "../src/index.js";

function readJson(relativePath: string): unknown {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

describe("generated StudySet JSON Schema", () => {
  it("matches the committed deterministic artifact", () => {
    assert.deepEqual(
      readJson("../study-set.schema.json"),
      createStudySetJsonSchema(),
    );
  });

  it("validates all representative examples", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(createStudySetJsonSchema());

    for (const filename of [
      "minimal-study-set.json",
      "categorized-study-set.json",
      "multi-source-study-set.json",
    ]) {
      const example = readJson(`../examples/${filename}`);
      assert.equal(validate(example), true, JSON.stringify(validate.errors));
    }
  });

  it("rejects unknown serialized fields", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(createStudySetJsonSchema());
    const example = readJson("../examples/minimal-study-set.json") as Record<
      string,
      unknown
    >;

    assert.equal(validate({ ...example, unexpected: true }), false);
  });

  it("leaves cross-record reference integrity to canonical Zod validation", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(createStudySetJsonSchema());
    const example = structuredClone(
      readJson("../examples/minimal-study-set.json"),
    ) as {
      questions: Array<Record<string, unknown>>;
    };
    example.questions[0]!.provenance = [
      { sourceId: "source.missing", locator: "record:1" },
    ];

    assert.equal(validate(example), true);
    assert.equal(StudySetSchema.safeParse(example).success, false);
  });
});
