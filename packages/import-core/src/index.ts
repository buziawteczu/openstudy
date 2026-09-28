export { inspectMappingCandidate } from "./inspection.js";
export { structuredRecordsAdapter } from "./structured-records.js";
export { normalizeDocument, summarizeDocument } from "./documents.js";
export type {
  SourceDocument, ExtractedDocument, NormalizedDocument, DocumentBlock,
  DocumentRun, TextBlock, TableBlock, TableCell, PageTextBlock,
  UnsupportedBlock, DocumentWarning, DocumentSummary,
} from "./documents.js";
export type {
  CollectionInspection,
  FieldInspection,
  FieldSample,
  ImportFailure,
  ImportInspection,
  ImportPath,
  ImportResult,
  MappingCandidate,
  NormalizedStructuredSource,
  RecordCollection,
  SourceDescriptor,
  SourceRecord,
  SourceValue,
  SourceValueType,
  StructuredSourceAdapter,
} from "./contracts.js";
