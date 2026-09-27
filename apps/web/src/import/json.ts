import { inspectMappingCandidate, structuredRecordsAdapter, type ImportInspection, type MappingCandidate, type SourceValue } from "@openstudy/import-core";
import { fail } from "./errors.js";
import type { IngestionLimits } from "./limits.js";

export interface InspectedSource {
  readonly candidate: MappingCandidate;
  readonly inspection: ImportInspection;
}

/** Shared across all JSON entries in an archive, bounding retained parsed data. */
export interface JsonBudget { nodes: number }

/** Native parse once; guard the entire tree before the neutral inspector copies it. */
export function inspectJson(bytes: Uint8Array, filename: string, sourceKey: string, limits: IngestionLimits, entry?: string, budget: JsonBudget = { nodes: 0 }): InspectedSource {
  const context = entry === undefined ? {} : { entry };
  if (bytes.byteLength > limits.jsonBytes) fail("file-too-large", filename, { ...context, limit: limits.jsonBytes });
  let parsed: SourceValue;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SourceValue;
  } catch {
    fail("malformed-json", filename, context);
  }
  const work: { value: SourceValue; depth: number }[] = [{ value: parsed, depth: 0 }];
  while (work.length > 0) {
    const { value, depth } = work.pop()!;
    budget.nodes += 1;
    if (budget.nodes > limits.jsonNodes || depth > limits.jsonDepth) {
      fail("json-resource-limit", filename, { ...context, limit: depth > limits.jsonDepth ? limits.jsonDepth : limits.jsonNodes });
    }
    // JSON.parse accepts overflowed numeric literals (e.g. 1e400) as Infinity.
    if (typeof value === "number" && !Number.isFinite(value)) fail("malformed-json", filename, context);
    if (value !== null && typeof value === "object") {
      const children = Object.values(value) as SourceValue[];
      if (budget.nodes + work.length + children.length > limits.jsonNodes) {
        fail("json-resource-limit", filename, { ...context, limit: limits.jsonNodes });
      }
      for (const child of children) work.push({ value: child, depth: depth + 1 });
    }
  }
  const adapted = structuredRecordsAdapter.inspect({
    kind: "structured",
    source: { key: sourceKey, label: entry ?? filename, originalFilename: entry ?? filename, format: "json", mediaType: "application/json" },
    value: parsed,
  });
  if (!adapted.success) {
    fail(adapted.error.code === "no-record-collection" ? "no-record-collection" : "inspection-failure", filename, { ...context, inspection: adapted.error });
  }
  const inspected = inspectMappingCandidate(adapted.value);
  if (!inspected.success) fail("inspection-failure", filename, { ...context, inspection: inspected.error });
  return { candidate: adapted.value, inspection: inspected.value };
}
