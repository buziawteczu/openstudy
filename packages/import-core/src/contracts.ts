/** Finite numbers, dense arrays, and plain data objects only at runtime. */
export type SourceValue =
  | string
  | number
  | boolean
  | null
  | readonly SourceValue[]
  | SourceRecord;

/** Field names are opaque source data, not canonical question concepts. */
export interface SourceRecord {
  readonly [field: string]: SourceValue;
}

/** Metadata stays upstream; key is an import-local token, not a canonical ID. */
export interface SourceDescriptor {
  readonly key: string;
  readonly label?: string;
  readonly originalFilename?: string;
  readonly mediaType?: string;
  readonly format?: string;
}

/** Already extracted structured data: never file bytes or a raw document. */
export interface NormalizedStructuredSource {
  readonly kind: "structured";
  readonly source: SourceDescriptor;
  readonly value: SourceValue;
}

export interface RecordCollection {
  /** Unique within this candidate, stable only for the same normalized input. */
  readonly key: string;
  readonly label?: string;
  /** Record positions are local locators, never canonical question identity. */
  readonly records: readonly SourceRecord[];
}

/** Ready for a later mapping decision; not a canonical StudySet candidate. */
export interface MappingCandidate {
  readonly source: SourceDescriptor;
  readonly adapterId: string;
  readonly collections: readonly RecordCollection[];
}

export type SourceValueType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

export interface FieldSample {
  readonly recordIndex: number;
  readonly value: SourceValue;
}

export interface FieldInspection {
  readonly name: string;
  readonly presentCount: number;
  readonly types: readonly SourceValueType[];
  /** First three present values in record order, without coercion or deduplication. */
  readonly samples: readonly FieldSample[];
}

export interface CollectionInspection {
  readonly key: string;
  readonly label?: string;
  readonly recordCount: number;
  readonly fields: readonly FieldInspection[];
}

export interface ImportInspection {
  readonly source: SourceDescriptor;
  readonly adapterId: string;
  readonly collections: readonly CollectionInspection[];
}

/** Machine-readable locations in the neutral candidate, not canonical paths. */
export type ImportPath = readonly (string | number)[];

export type ImportFailure =
  | { readonly code: "unsupported-source"; readonly adapterId: string }
  | { readonly code: "no-record-collection"; readonly sourceKey: string }
  | {
      readonly code: "invalid-normalized-data";
      readonly path: ImportPath;
      readonly reason:
        | "invalid-shape"
        | "invalid-metadata"
        | "duplicate-collection-key"
        | "non-serializable-value";
    };

export type ImportResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: ImportFailure };

/**
 * Recognition and projection of already-normalized structured input.
 * Implementations must be pure, deterministic, and never mutate the input.
 * Expected unsupported/malformed normalized inputs return typed failures;
 * unexpected programmer errors may throw. No I/O or canonical mapping here.
 */
export interface StructuredSourceAdapter {
  readonly id: string;
  readonly inspect: (
    source: NormalizedStructuredSource,
  ) => ImportResult<MappingCandidate>;
}
