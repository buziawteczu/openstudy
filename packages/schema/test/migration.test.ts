import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CURRENT_SCHEMA_VERSION,
  StudySetSchema,
  detectSchemaVersion,
  migrateStudySet,
  type SchemaVersionDetectionError,
  type StudySet,
  type StudySetMigrationError,
  type StudySetMigrationResult,
} from "../src/index.js";
import {
  completeMigrationSources,
  createMigrationRegistry,
  runRegisteredMigrations,
} from "../src/migration-registry.js";

const fixtureNames = ["minimal.json", "categorized.json", "multi-source.json"];

function readFixture(filename: string): unknown {
  const path = fileURLToPath(
    new URL(`./fixtures/1.0.0/${filename}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function successfulMigration(result: StudySetMigrationResult): StudySet {
  if (!result.success) {
    assert.fail(`Expected migration success, received ${result.error.code}`);
  }

  return result.studySet;
}

function migrationError(input: unknown): StudySetMigrationError {
  const result = migrateStudySet(input);

  if (result.success) {
    assert.fail("Expected migration failure");
  }

  return result.error;
}

function detectionError(input: unknown): SchemaVersionDetectionError {
  const result = detectSchemaVersion(input);

  if (result.success) {
    assert.fail("Expected version detection failure");
  }

  return result.error;
}

function asRecord(input: unknown): Record<string, unknown> {
  assert.equal(typeof input, "object");
  assert.notEqual(input, null);
  assert.equal(Array.isArray(input), false);
  return input as Record<string, unknown>;
}

describe("schema version detection", () => {
  it("recognizes 1.0.0 as the current version without parsing the full StudySet", () => {
    assert.deepEqual(detectSchemaVersion({ schemaVersion: "1.0.0" }), {
      success: true,
      version: "1.0.0",
      compatibility: "current",
    });
  });

  it("rejects invalid top-level envelopes", () => {
    for (const input of [null, [], "1.0.0", 1, true]) {
      assert.equal(detectionError(input).code, "invalid-input-envelope");
    }
  });

  it("distinguishes a missing schemaVersion", () => {
    assert.equal(detectionError({}).code, "missing-schema-version");
  });

  it("rejects empty and malformed schema version strings", () => {
    for (const schemaVersion of [
      "",
      "latest",
      "1",
      "1.0",
      "v1.0.0",
      "01.0.0",
    ]) {
      assert.equal(
        detectionError({ schemaVersion }).code,
        "malformed-schema-version",
      );
    }
  });

  it("rejects a numeric schemaVersion as malformed", () => {
    assert.equal(
      detectionError({ schemaVersion: 1 }).code,
      "malformed-schema-version",
    );
  });

  it("rejects unsupported future patch, minor, and major versions", () => {
    for (const schemaVersion of ["1.0.1", "1.1.0", "2.0.0", "9.0.0"]) {
      assert.equal(
        detectionError({ schemaVersion }).code,
        "unsupported-future-version",
      );
    }
  });

  it("rejects an unregistered historical version", () => {
    assert.equal(
      detectionError({ schemaVersion: "0.9.0" }).code,
      "unsupported-historical-version",
    );
  });

  it("classifies very large numeric components without BigInt conversion", () => {
    const largeComponent = "9".repeat(10_000);

    assert.equal(
      detectionError({ schemaVersion: `0.${largeComponent}.0` }).code,
      "unsupported-historical-version",
    );
    assert.equal(
      detectionError({ schemaVersion: `1.0.${largeComponent}` }).code,
      "unsupported-future-version",
    );
  });
});

describe("migrateStudySet", () => {
  it("validates current 1.0.0 data with zero migrations", () => {
    const input = readFixture("minimal.json");
    const result = migrateStudySet(input);

    if (!result.success) {
      assert.fail(`Expected success, received ${result.error.code}`);
    }

    assert.equal(result.sourceVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(result.targetVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(result.migrationsApplied, []);
    assert.deepEqual(result.studySet, input);
    assert.notStrictEqual(result.studySet, input);
  });

  it("retains strict unknown-field rejection during final validation", () => {
    const input = asRecord(readFixture("minimal.json"));
    const error = migrationError({ ...input, unexpected: true });

    assert.equal(error.code, "final-canonical-validation-failure");
  });

  it("returns final canonical validation failures structurally", () => {
    const input = asRecord(readFixture("minimal.json"));
    const error = migrationError({ ...input, title: "   " });

    assert.equal(error.code, "final-canonical-validation-failure");
    if (error.code === "final-canonical-validation-failure") {
      assert.ok(error.issues.some((issue) => issue.path[0] === "title"));
    }
  });

  it("does not mutate caller-owned input", () => {
    const input = readFixture("multi-source.json");
    const snapshot = structuredClone(input);

    successfulMigration(migrateStudySet(input));

    assert.deepEqual(input, snapshot);
  });

  it("preserves every canonical identity and the content revision", () => {
    const input = StudySetSchema.parse(readFixture("multi-source.json"));
    const output = successfulMigration(migrateStudySet(input));

    assert.equal(output.id, input.id);
    assert.equal(output.revision, input.revision);
    assert.deepEqual(
      output.sources.map((source) => source.id),
      input.sources.map((source) => source.id),
    );
    assert.deepEqual(
      output.categories.map((category) => category.id),
      input.categories.map((category) => category.id),
    );
    assert.deepEqual(
      output.questions.map((question) => question.id),
      input.questions.map((question) => question.id),
    );
    assert.deepEqual(
      output.questions.map((question) =>
        question.choices.map((choice) => choice.id),
      ),
      input.questions.map((question) =>
        question.choices.map((choice) => choice.id),
      ),
    );
  });

  it("is deterministic across repeated executions", () => {
    const input = readFixture("categorized.json");

    assert.deepEqual(migrateStudySet(input), migrateStudySet(input));
  });

  it("validates every 1.0.0 compatibility fixture", () => {
    for (const fixtureName of fixtureNames) {
      const result = migrateStudySet(readFixture(fixtureName));
      assert.equal(
        result.success,
        true,
        `${fixtureName} must migrate and validate`,
      );
    }
  });
});

describe("test-only migration registry harness", () => {
  it("advertises only sources with a complete path to current", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
        migrate: () => assert.fail("Registry validation must not execute steps"),
      },
      {
        fromVersion: "0.10.0",
        toVersion: CURRENT_SCHEMA_VERSION,
        migrate: () => assert.fail("Registry validation must not execute steps"),
      },
    ]);

    assert.deepEqual(completeMigrationSources(registry, CURRENT_SCHEMA_VERSION), [
      "0.9.0",
      "0.10.0",
    ]);
  });

  it("rejects incomplete production support before advertising a source", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
        migrate: () => assert.fail("Registry validation must not execute steps"),
      },
    ]);

    assert.throws(
      () => completeMigrationSources(registry, CURRENT_SCHEMA_VERSION),
      /Incomplete migration registry: No migration path from '0.9.0' to '1.0.0'; stopped at '0.10.0'/,
    );
  });

  it("rejects a cyclic production support path", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
        migrate: () => assert.fail("Registry validation must not execute steps"),
      },
      {
        fromVersion: "0.10.0",
        toVersion: "0.9.0",
        migrate: () => assert.fail("Registry validation must not execute steps"),
      },
    ]);

    assert.throws(
      () => completeMigrationSources(registry, CURRENT_SCHEMA_VERSION),
      /Migration registry contains a cycle at '0.9.0'/,
    );
  });

  it("runs an explicit synthetic migration chain in order", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "test-v1",
        toVersion: "test-v2",
        migrate: (input) => ({
          ...asRecord(input),
          schemaVersion: "test-v2",
          firstStep: true,
        }),
      },
      {
        fromVersion: "test-v2",
        toVersion: "test-v3",
        migrate: (input) => ({
          ...asRecord(input),
          schemaVersion: "test-v3",
          secondStep: true,
        }),
      },
    ]);
    const input = { schemaVersion: "test-v1", value: 42 };
    const snapshot = structuredClone(input);
    const result = runRegisteredMigrations(
      input,
      "test-v1",
      "test-v3",
      registry,
    );

    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.migrationsApplied, [
        { fromVersion: "test-v1", toVersion: "test-v2" },
        { fromVersion: "test-v2", toVersion: "test-v3" },
      ]);
      assert.deepEqual(result.value, {
        schemaVersion: "test-v3",
        value: 42,
        firstStep: true,
        secondStep: true,
      });
    }
    assert.deepEqual(input, snapshot);
  });

  it("returns a typed missing migration path", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "test-v1",
        toVersion: "test-v2",
        migrate: (input) => ({
          ...asRecord(input),
          schemaVersion: "test-v2",
        }),
      },
    ]);
    const result = runRegisteredMigrations(
      { schemaVersion: "test-v1" },
      "test-v1",
      "test-v3",
      registry,
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "missing-migration-path");
    }
  });

  it("returns a typed migration step failure", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "test-v1",
        toVersion: "test-v2",
        migrate: () => {
          throw new Error("synthetic failure");
        },
      },
    ]);
    const result = runRegisteredMigrations(
      { schemaVersion: "test-v1" },
      "test-v1",
      "test-v2",
      registry,
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "migration-step-failure");
      if (result.error.code === "migration-step-failure") {
        assert.equal(result.error.fromVersion, "test-v1");
        assert.equal(result.error.toVersion, "test-v2");
        assert.match(result.error.message, /synthetic failure/);
      }
    }
  });

  it("retains a string thrown by a failing migration step", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "test-v1",
        toVersion: "test-v2",
        migrate: () => {
          throw "synthetic string failure";
        },
      },
    ]);
    const result = runRegisteredMigrations(
      { schemaVersion: "test-v1" },
      "test-v1",
      "test-v2",
      registry,
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "migration-step-failure");
      assert.match(result.error.message, /synthetic string failure/);
    }
  });

  it("terminates a cyclic registry as a programmer error", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "test-v1",
        toVersion: "test-v2",
        migrate: () => {
          assert.fail("Cycle detection must happen before step execution");
        },
      },
      {
        fromVersion: "test-v2",
        toVersion: "test-v1",
        migrate: () => {
          assert.fail("Cycle detection must happen before step execution");
        },
      },
    ]);

    assert.throws(
      () =>
        runRegisteredMigrations(
          { schemaVersion: "test-v1" },
          "test-v1",
          "test-v3",
          registry,
        ),
      /Migration registry contains a cycle at 'test-v1'/,
    );
  });

  it("rejects a step that does not declare its target version", () => {
    const registry = createMigrationRegistry([
      {
        fromVersion: "test-v1",
        toVersion: "test-v2",
        migrate: (input) => input,
      },
    ]);
    const result = runRegisteredMigrations(
      { schemaVersion: "test-v1" },
      "test-v1",
      "test-v2",
      registry,
    );

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, "migration-step-failure");
    }
  });

  it("rejects invalid migration registrations", () => {
    assert.throws(
      () =>
        createMigrationRegistry([
          { fromVersion: "", toVersion: "test-v2", migrate: (input) => input },
        ]),
      /fromVersion/,
    );
    assert.throws(
      () =>
        createMigrationRegistry([
          {
            fromVersion: "test-v1",
            toVersion: "test-v1",
            migrate: (input) => input,
          },
        ]),
      /must change/,
    );
  });

  it("prevents duplicate and ambiguous outgoing migration edges", () => {
    assert.throws(
      () =>
        createMigrationRegistry([
          {
            fromVersion: "test-v1",
            toVersion: "test-v2",
            migrate: (input) => input,
          },
          {
            fromVersion: "test-v1",
            toVersion: "test-v3",
            migrate: (input) => input,
          },
        ]),
      /already has a registered edge/,
    );
  });
});
