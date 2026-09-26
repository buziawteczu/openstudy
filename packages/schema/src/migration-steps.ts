import type { MigrationStep } from "./migration-registry.js";

/**
 * Production migrations are registered explicitly here. Schema 1.0.0 is the
 * first and only canonical version, so there are currently no migration steps.
 */
export const STUDY_SET_MIGRATION_STEPS: readonly MigrationStep[] =
  Object.freeze([]);
