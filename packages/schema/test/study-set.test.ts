import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CURRENT_SCHEMA_VERSION,
  StudySetSchema,
  type StudySet,
} from "../src/index.js";

function readExample(filename: string): unknown {
  const path = fileURLToPath(new URL(`../examples/${filename}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function validStudySet(): StudySet {
  return StudySetSchema.parse(readExample("minimal-study-set.json"));
}

function expectInvalidAt(input: unknown, path: PropertyKey[]): void {
  const result = StudySetSchema.safeParse(input);

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) => JSON.stringify(issue.path) === JSON.stringify(path),
      ),
      `Expected an issue at ${JSON.stringify(path)}; received ${JSON.stringify(
        result.error.issues,
      )}`,
    );
  }
}

function expectInvalid(input: unknown): void {
  assert.equal(StudySetSchema.safeParse(input).success, false);
}

describe("StudySetSchema", () => {
  it("accepts the minimal StudySet example", () => {
    const input = readExample("minimal-study-set.json");
    const result = StudySetSchema.parse(input);

    assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(result, input, "validation must not transform canonical data");
  });

  it("accepts categorized and multi-source examples with multiple provenance entries", () => {
    assert.doesNotThrow(() =>
      StudySetSchema.parse(readExample("categorized-study-set.json")),
    );
    const multiSource = StudySetSchema.parse(
      readExample("multi-source-study-set.json"),
    );

    assert.equal(multiSource.questions[1]!.provenance?.length, 2);
  });

  it("rejects malformed and unsupported schema versions", () => {
    expectInvalidAt({ ...validStudySet(), schemaVersion: "v1" }, [
      "schemaVersion",
    ]);
    expectInvalidAt(
      { ...validStudySet(), schemaVersion: "1.1.0" },
      ["schemaVersion"],
    );
    expectInvalidAt(
      { ...validStudySet(), schemaVersion: "2.0.0" },
      ["schemaVersion"],
    );
  });

  it("rejects malformed revisions", () => {
    expectInvalidAt({ ...validStudySet(), revision: 0 }, ["revision"]);
    expectInvalidAt({ ...validStudySet(), revision: 1.5 }, ["revision"]);
    expectInvalidAt(
      { ...validStudySet(), revision: Number.MAX_SAFE_INTEGER + 1 },
      ["revision"],
    );
  });

  it("rejects IDs outside the portable ID contract", () => {
    expectInvalidAt({ ...validStudySet(), id: "study set/with spaces" }, [
      "id",
    ]);
    expectInvalidAt({ ...validStudySet(), id: "" }, ["id"]);
  });

  it("rejects empty source and question collections", () => {
    expectInvalidAt({ ...validStudySet(), sources: [] }, ["sources"]);
    expectInvalidAt({ ...validStudySet(), questions: [] }, ["questions"]);
  });

  it("rejects duplicate question IDs", () => {
    const studySet = structuredClone(validStudySet());
    studySet.questions.push(structuredClone(studySet.questions[0]!));

    expectInvalidAt(studySet, ["questions", 1, "id"]);
  });

  it("rejects duplicate source IDs", () => {
    const studySet = structuredClone(validStudySet());
    studySet.sources.push(structuredClone(studySet.sources[0]!));

    expectInvalidAt(studySet, ["sources", 1, "id"]);
  });

  it("rejects duplicate choice IDs", () => {
    const studySet = structuredClone(validStudySet());
    studySet.questions[0]!.choices[1]!.id =
      studySet.questions[0]!.choices[0]!.id;

    expectInvalidAt(studySet, ["questions", 0, "choices", 1, "id"]);
  });

  it("rejects questions with fewer than two choices", () => {
    const studySet = structuredClone(validStudySet());
    studySet.questions[0]!.choices = [studySet.questions[0]!.choices[0]!];

    expectInvalidAt(studySet, ["questions", 0, "choices"]);
  });

  it("rejects a correct choice reference that does not exist", () => {
    const studySet = structuredClone(validStudySet());
    studySet.questions[0]!.correctChoiceId = "choice.missing";

    expectInvalidAt(studySet, ["questions", 0, "correctChoiceId"]);
  });

  it("rejects an empty question prompt", () => {
    const studySet = structuredClone(validStudySet());
    studySet.questions[0]!.prompt = "   ";

    expectInvalidAt(studySet, ["questions", 0, "prompt"]);
  });

  it("rejects empty or whitespace-only required text", () => {
    expectInvalidAt({ ...validStudySet(), title: " \t " }, ["title"]);

    const sourceLabel = structuredClone(validStudySet());
    sourceLabel.sources[0]!.label = "   ";
    expectInvalidAt(sourceLabel, ["sources", 0, "label"]);

    const categoryLabel = StudySetSchema.parse(
      readExample("categorized-study-set.json"),
    );
    categoryLabel.categories[0]!.label = " \n ";
    expectInvalidAt(categoryLabel, ["categories", 0, "label"]);

    const studySet = structuredClone(validStudySet());
    studySet.questions[0]!.choices[0]!.text = " \n ";

    expectInvalidAt(studySet, ["questions", 0, "choices", 0, "text"]);
  });

  it("rejects provenance that references a missing source", () => {
    const studySet = structuredClone(validStudySet());
    studySet.questions[0]!.provenance = [
      { sourceId: "source.missing", locator: "record:1" },
    ];

    expectInvalidAt(studySet, [
      "questions",
      0,
      "provenance",
      0,
      "sourceId",
    ]);
  });

  it("rejects an unsupported question type", () => {
    const studySet = structuredClone(validStudySet()) as unknown as {
      questions: Array<Record<string, unknown>>;
    };
    studySet.questions[0]!.type = "multiple-choice";

    expectInvalidAt(studySet, ["questions", 0, "type"]);
  });

  it("rejects duplicate category IDs and missing category references", () => {
    const categorized = StudySetSchema.parse(
      readExample("categorized-study-set.json"),
    );
    const duplicate = structuredClone(categorized);
    duplicate.categories.push(structuredClone(duplicate.categories[0]!));
    expectInvalidAt(duplicate, ["categories", 2, "id"]);

    const missing = structuredClone(categorized);
    missing.questions[0]!.categoryIds = ["category.missing"];
    expectInvalidAt(missing, ["questions", 0, "categoryIds", 0]);

    const repeatedReference = structuredClone(categorized);
    repeatedReference.questions[0]!.categoryIds = [
      "category.cells",
      "category.cells",
    ];
    expectInvalidAt(repeatedReference, ["questions", 0, "categoryIds", 1]);
  });

  it("rejects unknown fields on every canonical object shape", () => {
    const minimal = validStudySet();
    const categorized = StudySetSchema.parse(
      readExample("categorized-study-set.json"),
    );

    const candidates: unknown[] = [
      { ...minimal, unexpected: true },
      {
        ...minimal,
        sources: [{ ...minimal.sources[0]!, kind: "file" }],
      },
      {
        ...minimal,
        questions: [{ ...minimal.questions[0]!, unexpected: true }],
      },
      {
        ...minimal,
        questions: [
          {
            ...minimal.questions[0]!,
            choices: [
              { ...minimal.questions[0]!.choices[0]!, unexpected: true },
              minimal.questions[0]!.choices[1]!,
            ],
          },
        ],
      },
      {
        ...categorized,
        categories: [{ ...categorized.categories[0]!, unexpected: true }],
      },
      {
        ...categorized,
        questions: [
          {
            ...categorized.questions[0]!,
            provenance: [
              {
                ...categorized.questions[0]!.provenance![0]!,
                unexpected: true,
              },
            ],
          },
        ],
      },
    ];

    for (const candidate of candidates) {
      expectInvalid(candidate);
    }
  });
});
