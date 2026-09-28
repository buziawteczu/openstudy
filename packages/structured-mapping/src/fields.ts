import type { RecordCollection, SourceRecord, SourceValue } from "@openstudy/import-core";
import type { FieldPath, MappedValue } from "./contracts.js";

export const MAX_DISCOVERED_FIELDS = 200;
export const MAX_PATH_DEPTH = 100;
export interface MappingField {
  readonly path: FieldPath;
  readonly samples: readonly { readonly recordIndex: number; readonly value: SourceValue }[];
}
export interface MappingFields {
  readonly fields: readonly MappingField[];
  /** Discovery is bounded; explicit paths can still be supplied through the core API. */
  readonly truncated: boolean;
}

export function readField(record: SourceRecord, path: FieldPath): MappedValue {
  let value: SourceValue = record;
  for (const segment of path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { path, present: false };
    const property = Object.getOwnPropertyDescriptor(value, segment);
    // Never traverse inherited properties or invoke accessors.
    if (!property || !("value" in property)) return { path, present: false };
    value = property.value as SourceValue;
  }
  return { path, present: true, value };
}

/** One bounded discovery pass per collection; never inspect inside choice arrays. */
export function discoverFields(collection: RecordCollection): MappingFields {
  const fields = new Map<string, { path: FieldPath; samples: { recordIndex: number; value: SourceValue }[] }>();
  let truncated = false;
  for (const [recordIndex, record] of collection.records.entries()) {
    const work: { object: SourceRecord; prefix: FieldPath }[] = [{ object: record, prefix: [] }];
    while (work.length) {
      const { object, prefix } = work.pop()!;
      for (const key of Object.keys(object)) {
        const property = Object.getOwnPropertyDescriptor(object, key);
        if (!property || !("value" in property)) continue;
        const value = property.value as SourceValue;
        const path = [...prefix, key];
        const serialized = JSON.stringify(path);
        let field = fields.get(serialized);
        if (!field) {
          if (fields.size >= MAX_DISCOVERED_FIELDS || path.length > MAX_PATH_DEPTH) { truncated = true; continue; }
          field = { path, samples: [] };
          fields.set(serialized, field);
        }
        if (field.samples.length < 3) field.samples.push({ recordIndex, value });
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          work.push({ object: value as SourceRecord, prefix: path });
        }
      }
    }
  }
  return {
    fields: [...fields.values()].sort((a, b) => {
      const left = JSON.stringify(a.path), right = JSON.stringify(b.path);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    truncated,
  };
}

/** JSON-quoted bracket notation keeps unusual source keys unambiguous. */
export function fieldLabel(path: FieldPath): string {
  return path.map((segment, index) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
    ? (index ? "." : "") + segment
    : "[" + JSON.stringify(segment) + "]").join("");
}
