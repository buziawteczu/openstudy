export interface MigrationStep {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly migrate: (input: unknown) => unknown;
}

export interface MigrationTransition {
  readonly fromVersion: string;
  readonly toVersion: string;
}

export interface MissingMigrationPathError {
  readonly code: "missing-migration-path";
  readonly message: string;
  readonly sourceVersion: string;
  readonly targetVersion: string;
  readonly stoppedAtVersion: string;
}

export interface MigrationStepFailureError {
  readonly code: "migration-step-failure";
  readonly message: string;
  readonly fromVersion: string;
  readonly toVersion: string;
}

export type RegistryMigrationError =
  | MissingMigrationPathError
  | MigrationStepFailureError;

export type RegistryMigrationResult =
  | {
      readonly success: true;
      readonly value: unknown;
      readonly migrationsApplied: readonly MigrationTransition[];
    }
  | {
      readonly success: false;
      readonly error: RegistryMigrationError;
    };

export interface MigrationRegistry {
  readonly sourceVersions: readonly string[];
  readonly getStep: (fromVersion: string) => MigrationStep | undefined;
}

function assertVersionLabel(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/**
 * Creates a deliberately small registry with at most one outgoing edge per
 * version. That rule prevents ambiguous dispatch without a graph framework.
 */
export function createMigrationRegistry(
  steps: readonly MigrationStep[],
): MigrationRegistry {
  const stepsBySource = new Map<string, MigrationStep>();

  for (const step of steps) {
    assertVersionLabel(step.fromVersion, "fromVersion");
    assertVersionLabel(step.toVersion, "toVersion");

    if (step.fromVersion === step.toVersion) {
      throw new TypeError("A migration step must change the schema version");
    }

    if (typeof step.migrate !== "function") {
      throw new TypeError("migrate must be a function");
    }

    if (stepsBySource.has(step.fromVersion)) {
      throw new TypeError(
        `Migration source '${step.fromVersion}' already has a registered edge`,
      );
    }

    stepsBySource.set(step.fromVersion, Object.freeze({ ...step }));
  }

  const sourceVersions = Object.freeze([...stepsBySource.keys()]);

  return Object.freeze({
    sourceVersions,
    getStep: (fromVersion: string) => stepsBySource.get(fromVersion),
  });
}

function resolveMigrationPath(
  registry: MigrationRegistry,
  sourceVersion: string,
  targetVersion: string,
):
  | { readonly success: true; readonly steps: readonly MigrationStep[] }
  | { readonly success: false; readonly error: MissingMigrationPathError } {
  const steps: MigrationStep[] = [];
  const visitedVersions = new Set<string>();
  let currentVersion = sourceVersion;

  while (currentVersion !== targetVersion) {
    if (visitedVersions.has(currentVersion)) {
      throw new Error(
        `Migration registry contains a cycle at '${currentVersion}'`,
      );
    }

    visitedVersions.add(currentVersion);
    const step = registry.getStep(currentVersion);

    if (step === undefined) {
      return {
        success: false,
        error: {
          code: "missing-migration-path",
          message: `No migration path from '${sourceVersion}' to '${targetVersion}'; stopped at '${currentVersion}'`,
          sourceVersion,
          targetVersion,
          stoppedAtVersion: currentVersion,
        },
      };
    }

    steps.push(step);
    currentVersion = step.toVersion;
  }

  return { success: true, steps };
}

/** Validate production support claims without constraining synthetic registries. */
export function completeMigrationSources(
  registry: MigrationRegistry,
  targetVersion: string,
): readonly string[] {
  const sources: string[] = [];

  for (const sourceVersion of registry.sourceVersions) {
    if (sourceVersion === targetVersion) {
      throw new Error(
        `Migration registry must not define an outgoing step from current version '${targetVersion}'`,
      );
    }

    const path = resolveMigrationPath(registry, sourceVersion, targetVersion);
    if (!path.success) {
      throw new Error(`Incomplete migration registry: ${path.error.message}`);
    }

    sources.push(sourceVersion);
  }

  return Object.freeze(sources);
}

function declaredVersionOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>).schemaVersion;
  return typeof value === "string" ? value : undefined;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return "Migration step failed";
}

/** Internal execution primitive, exported from this module for focused tests. */
export function runRegisteredMigrations(
  input: unknown,
  sourceVersion: string,
  targetVersion: string,
  registry: MigrationRegistry,
): RegistryMigrationResult {
  const path = resolveMigrationPath(registry, sourceVersion, targetVersion);

  if (!path.success) {
    return path;
  }

  if (path.steps.length === 0) {
    return { success: true, value: input, migrationsApplied: [] };
  }

  let value: unknown;

  try {
    value = structuredClone(input);
  } catch (error) {
    const firstStep = path.steps[0]!;
    return {
      success: false,
      error: {
        code: "migration-step-failure",
        message: `Migration '${firstStep.fromVersion}' -> '${firstStep.toVersion}' could not clone its input: ${failureMessage(error)}`,
        fromVersion: firstStep.fromVersion,
        toVersion: firstStep.toVersion,
      },
    };
  }

  const migrationsApplied: MigrationTransition[] = [];

  for (const step of path.steps) {
    try {
      value = step.migrate(value);
    } catch (error) {
      return {
        success: false,
        error: {
          code: "migration-step-failure",
          message: `Migration '${step.fromVersion}' -> '${step.toVersion}' failed: ${failureMessage(error)}`,
          fromVersion: step.fromVersion,
          toVersion: step.toVersion,
        },
      };
    }

    if (declaredVersionOf(value) !== step.toVersion) {
      return {
        success: false,
        error: {
          code: "migration-step-failure",
          message: `Migration '${step.fromVersion}' -> '${step.toVersion}' did not declare its target schemaVersion`,
          fromVersion: step.fromVersion,
          toVersion: step.toVersion,
        },
      };
    }

    migrationsApplied.push({
      fromVersion: step.fromVersion,
      toVersion: step.toVersion,
    });
  }

  return { success: true, value, migrationsApplied };
}
