import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectMappingCandidate, structuredRecordsAdapter, type SourceValue } from "../src/index.js";

function adapt(value: SourceValue) {
  return structuredRecordsAdapter.inspect({ kind: "structured", source: { key: "local-source" }, value });
}

test("projects a root record array without interpreting source fields", () => {
  const records = [{ questionText: "Opaque", answers: ["A", "B"], correctIndex: 1 }];
  const result = adapt(records);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.value.collections[0]!.records, records);
  assert.deepEqual(result.value.collections[0]!.records[0], records[0]);
  assert.equal(result.value.adapterId, "structured-records-v1");
});

test("discovers multiple arrays through nested containers in source order", () => {
  const result = adapt({ wrapper: { first: [{ a: 1 }], second: [{ b: 2 }, {}] } });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.value.collections.map((collection) => collection.key), ["records:/wrapper/first", "records:/wrapper/second"]);
    const inspection = inspectMappingCandidate(result.value);
    assert.equal(inspection.success, true);
    if (inspection.success) assert.deepEqual(inspection.value.collections.map((collection) => collection.recordCount), [1, 2]);
  }
});

test("does not expose record fields as additional collections", () => {
  const result = adapt([{ nested: [{ sourceField: true }], empty: [] }]);
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.value.collections.length, 1);
});

test("retains empty collections and empty records", () => {
  const result = adapt({ first: [], second: [{}] });
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(result.value.collections.map((collection) => collection.records.length), [0, 1]);
});

test("does not silently filter mixed or primitive arrays into records", () => {
  for (const value of [[{}, "not a record"], [1, 2], "text", null, { questionText: "single object" }] as SourceValue[]) {
    assert.deepEqual(adapt(value), { success: false, error: { code: "no-record-collection", sourceKey: "local-source" } });
  }
});

test("escapes collection paths unambiguously and preserves prototype-like fields", () => {
  const data = JSON.parse('{"a/b":{"~c":[{"__proto__":{"safe":true}}]}}') as SourceValue;
  const result = adapt(data);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.value.collections[0]!.key, "records:/a~1b/~0c");
    assert.equal(Object.hasOwn(result.value.collections[0]!.records[0]!, "__proto__"), true);
  }
});

test("is deterministic and leaves frozen input unchanged", () => {
  const value = Object.freeze({ rows: Object.freeze([Object.freeze({ arbitrary: "field" })]) });
  const before = JSON.stringify(value);
  assert.deepEqual(adapt(value), adapt(value));
  assert.equal(JSON.stringify(value), before);
});
