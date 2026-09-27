import type { RecordCollection, SourceValue, StructuredSourceAdapter } from "./contracts.js";
import { isSourceRecord } from "./source-value.js";

const ADAPTER_ID = "structured-records-v1";

/** JSON-pointer tokens are temporary locators, not canonical IDs. */
function token(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Project already-normalized data, without field interpretation or copying.
 * Object-only arrays (including empty arrays) are collections. Search container
 * objects/arrays, but stop at a collection so nested record fields stay data.
 * Mixed arrays are not filtered into collections: no rows are silently dropped.
 * The upstream normalization boundary owns validation and resource budgets.
 */
export const structuredRecordsAdapter: StructuredSourceAdapter = {
  id: ADAPTER_ID,
  inspect(input) {
    const collections: RecordCollection[] = [];
    const work: { value: SourceValue; path: string }[] = [{ value: input.value, path: "" }];
    while (work.length > 0) {
      const { value, path } = work.pop()!;
      if (Array.isArray(value) && value.every(isSourceRecord)) {
        collections.push({ key: `records:${path}`, label: path || "Root records", records: value });
        continue;
      }
      if (value === null || typeof value !== "object") continue;
      const entries = Object.entries(value);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index]!;
        work.push({ value: child as SourceValue, path: `${path}/${token(key)}` });
      }
    }
    if (collections.length === 0) {
      return { success: false, error: { code: "no-record-collection", sourceKey: input.source.key } };
    }
    return { success: true, value: { source: input.source, adapterId: ADAPTER_ID, collections } };
  },
};
