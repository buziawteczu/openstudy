import { CURRENT_SCHEMA_VERSION } from "./constants.js";
import {
  createMigrationRegistry,
  runRegisteredMigrations,
  type MigrationStepFailureError,
  type MigrationTransition,
  type MissingMigrationPathError,
} from "./migration-registry.js";
import { STUDY_SET_MIGRATION_STEPS } from "./migration-steps.js";
import { StudySetSchema, type StudySet } from "./study-set.js";

export type {
  MigrationStepFailureError,
  MigrationTransition,
  MissingMigrationPathError,
} from "./migration-registry.js";

const SCHEMA_VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

const migrationRegistry = createMigrationRegistry(STUDY_SET_MIGRATION_STEPS);
const supportedHistoricalVersions = new Set(migrationRegistry.sourceVersions);

export type SchemaVersionCompatibility = "current" | "supported-historical";

export interface InvalidInputEnvelopeError {
  readonly code: "invalid-input-envelope";
  readonly message: string;
}

export interface MissingSchemaVersionError {
  readonly code: "missing-schema-version";
  readonly message: string;
}

export interface MalformedSchemaVersionError {
  readonly code: "malformed-schema-version";
  readonly message: string;
  readonly declaredValue: unknown;
}

export interface UnsupportedHistoricalVersionError {
  readonly code: "unsupported-historical-version";
  readonly message: string;
  readonly declaredVersion: string;
  readonly currentVersion: typeof CURRENT_SCHEMA_VERSION;
}

export interface UnsupportedFutureVersionError {
  readonly code: "unsupported-future-version";
  readonly message: string;
  readonly declaredVersion: string;
  readonly currentVersion: typeof CURRENT_SCHEMA_VERSION;
}

export type SchemaVersionDetectionError =
  | InvalidInputEnvelopeError
  | MissingSchemaVersionError
  | MalformedSchemaVersionError
  | UnsupportedHistoricalVersionError
  | UnsupportedFutureVersionError;

export type SchemaVersionDetectionResult =
  | {
      readonly success: true;
      readonly version: string;
      readonly compatibility: SchemaVersionCompatibility;
    }
  | {
      readonly success: false;
      readonly error: SchemaVersionDetectionError;
    };

export interface CanonicalValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

export interface FinalCanonicalValidationError {
  readonly code: "final-canonical-validation-failure";
  readonly message: string;
  readonly issues: readonly CanonicalValidationIssue[];
}

export type StudySetMigrationError =
  | SchemaVersionDetectionError
  | MissingMigrationPathError
  | MigrationStepFailureError
  | FinalCanonicalValidationError;

export type StudySetMigrationResult =
  | {
      readonly success: true;
      readonly studySet: StudySet;
      readonly sourceVersion: string;
      readonly targetVersion: typeof CURRENT_SCHEMA_VERSION;
      readonly migrationsApplied: readonly MigrationTransition[];
    }
  | {
      readonly success: false;
      readonly error: StudySetMigrationError;
    };

function parseSchemaVersion(
  value: string,
): readonly [major: bigint, minor: bigint, patch: bigint] | undefined {
  const match = SCHEMA_VERSION_PATTERN.exec(value);

  if (match === null) {
    return undefined;
  }

  return [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)];
}

function compareSchemaVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseSchemaVersion(left)!;
  const rightParts = parseSchemaVersion(right)!;

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index]! < rightParts[index]!) {
      return -1;
    }

    if (leftParts[index]! > rightParts[index]!) {
      return 1;
    }
  }

  return 0;
}

/** Inspects only the top-level envelope and declared schemaVersion. */
export function detectSchemaVersion(input: unknown): SchemaVersionDetectionResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      success: false,
      error: {
        code: "invalid-input-envelope",
        message: "A canonical StudySet must be a top-level object",
      },
    };
  }

  if (!Object.prototype.hasOwnProperty.call(input, "schemaVersion")) {
    return {
      success: false,
      error: {
        code: "missing-schema-version",
        message: "The top-level schemaVersion field is required",
      },
    };
  }

  const declaredValue = (input as Record<string, unknown>).schemaVersion;

  if (
    typeof declaredValue !== "string" ||
    parseSchemaVersion(declaredValue) === undefined
  ) {
    return {
      success: false,
      error: {
        code: "malformed-schema-version",
        message: "schemaVersion must use strict major.minor.patch syntax",
        declaredValue,
      },
    };
  }

  if (declaredValue === CURRENT_SCHEMA_VERSION) {
    return {
      success: true,
      version: declaredValue,
      compatibility: "current",
    };
  }

  const comparison = compareSchemaVersions(
    declaredValue,
    CURRENT_SCHEMA_VERSION,
  );

  if (comparison > 0) {
    return {
      success: false,
      error: {
        code: "unsupported-future-version",
        message: `Schema version '${declaredValue}' is newer than supported version '${CURRENT_SCHEMA_VERSION}'`,
        declaredVersion: declaredValue,
        currentVersion: CURRENT_SCHEMA_VERSION,
      },
    };
  }

  if (supportedHistoricalVersions.has(declaredValue)) {
    return {
      success: true,
      version: declaredValue,
      compatibility: "supported-historical",
    };
  }

  return {
    success: false,
    error: {
      code: "unsupported-historical-version",
      message: `Schema version '${declaredValue}' has no supported deterministic migration path`,
      declaredVersion: declaredValue,
      currentVersion: CURRENT_SCHEMA_VERSION,
    },
  };
}

/** Migrates recognized canonical data and validates only the final current form. */
export function migrateStudySet(input: unknown): StudySetMigrationResult {
  const detection = detectSchemaVersion(input);

  if (!detection.success) {
    return detection;
  }

  const migration = runRegisteredMigrations(
    input,
    detection.version,
    CURRENT_SCHEMA_VERSION,
    migrationRegistry,
  );

  if (!migration.success) {
    return migration;
  }

  const validation = StudySetSchema.safeParse(migration.value);

  if (!validation.success) {
    return {
      success: false,
      error: {
        code: "final-canonical-validation-failure",
        message: "Migrated data does not satisfy the current StudySet schema",
        issues: validation.error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: [...issue.path],
        })),
      },
    };
  }

  return {
    success: true,
    studySet: validation.data,
    sourceVersion: detection.version,
    targetVersion: CURRENT_SCHEMA_VERSION,
    migrationsApplied: migration.migrationsApplied,
  };
}
