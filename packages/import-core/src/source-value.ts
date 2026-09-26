import type {
  ImportFailure,
  ImportPath,
  ImportResult,
  SourceRecord,
  SourceValue,
} from "./contracts.js";

export function isSourceRecord(value: SourceValue): value is SourceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalid(
  path: ImportPath,
  reason: Extract<ImportFailure, { code: "invalid-normalized-data" }>["reason"],
): ImportResult<never> {
  return {
    success: false,
    error: { code: "invalid-normalized-data", path, reason },
  };
}

type CopyWork =
  | {
      readonly input: unknown;
      readonly path: ImportPath;
      readonly write: (value: SourceValue) => void;
    }
  | { readonly leave: object };

/**
 * Validate a neutral data tree while taking a detached snapshot.
 * Iterative traversal avoids a call-stack dependency on source nesting.
 * Accessor properties are rejected without invoking them. Shared subtrees
 * are copied independently; ancestor cycles are rejected.
 */
export function copySourceValue(input: unknown): ImportResult<SourceValue> {
  let snapshot: SourceValue = null;
  const active = new Set<object>();
  const work: CopyWork[] = [{
    input,
    path: [],
    write: (value) => { snapshot = value; },
  }];

  while (work.length > 0) {
    const item = work.pop()!;
    if ("leave" in item) {
      active.delete(item.leave);
      continue;
    }

    const { input: value, path, write } = item;
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      write(value);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      write(value);
      continue;
    }
    if (typeof value !== "object" || value === null || active.has(value)) {
      return invalid(path, "non-serializable-value");
    }

    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) {
      return invalid(path, "non-serializable-value");
    }

    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) {
      return invalid(path, "non-serializable-value");
    }

    const dataKeys = array
      ? Array.from({ length: value.length }, (_, index) => String(index))
      : keys;
    const copy: Record<string, SourceValue> | SourceValue[] = array ? [] : {};
    write(copy);
    active.add(value);
    work.push({ leave: value });

    for (let index = dataKeys.length - 1; index >= 0; index -= 1) {
      const key = dataKeys[index]!;
      if (typeof key !== "string") {
        return invalid(path, "non-serializable-value");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const childPath = [...path, array ? Number(key) : key];
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        return invalid(childPath, "non-serializable-value");
      }

      work.push({
        input: descriptor.value,
        path: childPath,
        write: (child) => {
          // defineProperty preserves "__proto__" as data without changing prototypes.
          Object.defineProperty(copy, key, {
            value: child,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        },
      });
    }
  }

  return { success: true, value: snapshot };
}
