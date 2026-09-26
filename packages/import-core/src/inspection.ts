import type {
  CollectionInspection,
  FieldInspection,
  FieldSample,
  ImportInspection,
  ImportResult,
  SourceDescriptor,
  SourceRecord,
  SourceValue,
  SourceValueType,
} from "./contracts.js";
import { copySourceValue, invalid, isSourceRecord } from "./source-value.js";

const SAMPLE_COUNT = 3;
const SOURCE_KEYS = ["key", "label", "originalFilename", "mediaType", "format"];
const COLLECTION_KEYS = ["key", "label", "records"];

function nonBlank(value: SourceValue | undefined): value is string {
  return typeof value === "string" && /\S/.test(value);
}

function onlyKeys(value: SourceRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function valueType(value: SourceValue): SourceValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value as "string" | "number" | "boolean";
}

function sourceDescriptor(value: SourceValue | undefined): SourceDescriptor | undefined {
  if (value === undefined || !isSourceRecord(value) || !onlyKeys(value, SOURCE_KEYS)) {
    return undefined;
  }
  if (!Object.hasOwn(value, "key") || !nonBlank(value.key)) return undefined;
  if (SOURCE_KEYS.slice(1).some((key) => Object.hasOwn(value, key) && !nonBlank(value[key]))) {
    return undefined;
  }
  return {
    key: value.key,
    ...(Object.hasOwn(value, "label") && typeof value.label === "string" ? { label: value.label } : {}),
    ...(Object.hasOwn(value, "originalFilename") && typeof value.originalFilename === "string"
      ? { originalFilename: value.originalFilename } : {}),
    ...(Object.hasOwn(value, "mediaType") && typeof value.mediaType === "string" ? { mediaType: value.mediaType } : {}),
    ...(Object.hasOwn(value, "format") && typeof value.format === "string" ? { format: value.format } : {}),
  };
}

/**
 * Inspect only an explicitly supplied neutral mapping candidate. This does not
 * detect arrays in arbitrary input, parse files, select a collection, or map fields.
 * Accept unknown at this runtime boundary so malformed JS/adapter output fails
 * explicitly. Successful metadata and samples are detached from caller data.
 */
export function inspectMappingCandidate(input: unknown): ImportResult<ImportInspection> {
  const snapshot = copySourceValue(input);
  if (!snapshot.success) return snapshot;

  const candidate = snapshot.value;
  if (!isSourceRecord(candidate) || !onlyKeys(candidate, ["source", "adapterId", "collections"])) {
    return invalid([], "invalid-shape");
  }
  const source = sourceDescriptor(Object.hasOwn(candidate, "source") ? candidate.source : undefined);
  if (source === undefined) return invalid(["source"], "invalid-metadata");
  if (!Object.hasOwn(candidate, "adapterId") || !nonBlank(candidate.adapterId)) {
    return invalid(["adapterId"], "invalid-metadata");
  }
  if (!Object.hasOwn(candidate, "collections") || !Array.isArray(candidate.collections)) {
    return invalid(["collections"], "invalid-shape");
  }
  if (candidate.collections.length === 0) {
    return { success: false, error: { code: "no-record-collection", sourceKey: source.key } };
  }

  const seen = new Set<string>();
  const collections: CollectionInspection[] = [];
  for (const [collectionIndex, collection] of candidate.collections.entries()) {
    const path = ["collections", collectionIndex];
    if (!isSourceRecord(collection) || !onlyKeys(collection, COLLECTION_KEYS)) {
      return invalid(path, "invalid-shape");
    }
    if (!Object.hasOwn(collection, "key") || !nonBlank(collection.key)) {
      return invalid([...path, "key"], "invalid-metadata");
    }
    if (Object.hasOwn(collection, "label") && !nonBlank(collection.label)) {
      return invalid([...path, "label"], "invalid-metadata");
    }
    if (seen.has(collection.key)) return invalid([...path, "key"], "duplicate-collection-key");
    seen.add(collection.key);
    if (!Object.hasOwn(collection, "records") || !Array.isArray(collection.records)) {
      return invalid([...path, "records"], "invalid-shape");
    }

    const fields = new Map<string, {
      presentCount: number;
      types: Set<SourceValueType>;
      samples: FieldSample[];
    }>();
    for (const [recordIndex, record] of collection.records.entries()) {
      if (!isSourceRecord(record)) return invalid([...path, "records", recordIndex], "invalid-shape");
      for (const name of Object.keys(record)) {
        const value = record[name]!;
        let field = fields.get(name);
        if (field === undefined) {
          field = { presentCount: 0, types: new Set(), samples: [] };
          fields.set(name, field);
        }
        field.presentCount += 1;
        field.types.add(valueType(value));
        if (field.samples.length < SAMPLE_COUNT) field.samples.push({ recordIndex, value });
      }
    }

    const inspectedFields: FieldInspection[] = [...fields.keys()].sort().map((name) => {
      const field = fields.get(name)!;
      return {
        name,
        presentCount: field.presentCount,
        types: [...field.types].sort(),
        samples: field.samples,
      };
    });
    collections.push({
      key: collection.key,
      ...(Object.hasOwn(collection, "label") && typeof collection.label === "string"
        ? { label: collection.label } : {}),
      recordCount: collection.records.length,
      fields: inspectedFields,
    });
  }

  return { success: true, value: { source, adapterId: candidate.adapterId, collections } };
}
