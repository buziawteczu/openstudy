export { CategorySchema, type Category } from "./category.js";
export { CURRENT_SCHEMA_VERSION } from "./constants.js";
export {
  ChoiceSchema,
  QuestionSchema,
  SingleChoiceQuestionSchema,
  type Choice,
  type Question,
  type SingleChoiceQuestion,
} from "./question.js";
export {
  NonBlankTextSchema,
  PORTABLE_ID_PATTERN,
  PortableIdSchema,
  type PortableId,
} from "./shared.js";
export {
  detectSchemaVersion,
  migrateStudySet,
  type CanonicalValidationIssue,
  type FinalCanonicalValidationError,
  type InvalidInputEnvelopeError,
  type MalformedSchemaVersionError,
  type MigrationStepFailureError,
  type MigrationTransition,
  type MissingSchemaVersionError,
  type MissingMigrationPathError,
  type SchemaVersionCompatibility,
  type SchemaVersionDetectionError,
  type SchemaVersionDetectionResult,
  type StudySetMigrationError,
  type StudySetMigrationResult,
  type UnsupportedFutureVersionError,
  type UnsupportedHistoricalVersionError,
} from "./migration.js";
export {
  SourceSchema,
  QuestionProvenanceSchema,
  type QuestionProvenance,
  type Source,
} from "./source.js";
export {
  StudySetRevisionSchema,
  StudySetSchema,
  type StudySet,
  type StudySetRevision,
} from "./study-set.js";
