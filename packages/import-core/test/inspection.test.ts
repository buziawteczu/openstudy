import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inspectMappingCandidate,
  type ImportInspection,
  type ImportPath,
  type MappingCandidate,
  type NormalizedStructuredSource,
  type RecordCollection,
  type SourceRecord,
  type SourceValue,
  type StructuredSourceAdapter,
} from "../src/index.js";

function candidate(records: readonly SourceRecord[]): MappingCandidate {
  return {
    source: { key: "temporary source / 1", label: "Synthetic material" },
    adapterId: "synthetic/records",
    collections: [{ key: "root/rows", records }],
  };
}

function inspect(input: unknown): ImportInspection {
  const result = inspectMappingCandidate(input);
  assert.ok(result.success, result.success ? "" : JSON.stringify(result.error));
  return result.value;
}

function expectInvalidAt(
  input: unknown,
  path: ImportPath,
  reason = "non-serializable-value",
): void {
  assert.deepEqual(inspectMappingCandidate(input), {
    success: false,
    error: { code: "invalid-normalized-data", path, reason },
  });
}

function deepFreeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null && !Object.isFrozen(child)) deepFreeze(child);
  }
}

function isRecord(value: SourceValue): value is SourceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Test-only projection, not a production source adapter or JSON parser.
const SYNTHETIC_ADAPTER_ID = "synthetic/records";
const syntheticAdapter: StructuredSourceAdapter = {
  id: SYNTHETIC_ADAPTER_ID,
  inspect(source) {
    if (!Array.isArray(source.value) || !source.value.every(isRecord)) {
      return {
        success: false,
        error: { code: "unsupported-source", adapterId: SYNTHETIC_ADAPTER_ID },
      };
    }
    return {
      success: true,
      value: {
        source: source.source,
        adapterId: SYNTHETIC_ADAPTER_ID,
        collections: [{ key: "root/rows", records: source.value }],
      },
    };
  },
};

describe("neutral collection inspection", () => {
  it("inspects a simple structured collection", () => {
    const result = inspect(candidate([{ text: "One", score: 7 }, { text: "Two", score: 9 }]));
    assert.deepEqual(result.collections, [{
      key: "root/rows",
      recordCount: 2,
      fields: [
        { name: "score", presentCount: 2, types: ["number"], samples: [
          { recordIndex: 0, value: 7 }, { recordIndex: 1, value: 9 },
        ] },
        { name: "text", presentCount: 2, types: ["string"], samples: [
          { recordIndex: 0, value: "One" }, { recordIndex: 1, value: "Two" },
        ] },
      ],
    }]);
  });

  it("preserves multiple collections, their labels, and their order", () => {
    const input = { ...candidate([]), collections: [
      { key: "second", label: "Second", records: [{ b: false }] },
      { key: "first", label: "First", records: [{ a: 1 }, { a: 2 }] },
    ] } satisfies MappingCandidate;
    const result = inspect(input);
    assert.deepEqual(result.collections.map(({ key, label, recordCount }) => ({ key, label, recordCount })), [
      { key: "second", label: "Second", recordCount: 1 },
      { key: "first", label: "First", recordCount: 2 },
    ]);
  });

  it("keeps empty collections visible rather than inventing records", () => {
    assert.deepEqual(inspect(candidate([])).collections, [
      { key: "root/rows", recordCount: 0, fields: [] },
    ]);
  });

  it("distinguishes no collections from an empty collection", () => {
    assert.deepEqual(inspectMappingCandidate({ ...candidate([]), collections: [] }), {
      success: false,
      error: { code: "no-record-collection", sourceKey: "temporary source / 1" },
    });
  });

  it("accepts records with no fields", () => {
    assert.deepEqual(inspect(candidate([{}, {}])).collections, [
      { key: "root/rows", recordCount: 2, fields: [] },
    ]);
  });

  it("retains nested arrays, objects, scalars, and null without stringification", () => {
    const nested: SourceValue = {
      answers: ["A", { text: "B", correct: true }],
      context: { count: 3, missing: null, flags: [false, null] },
    };
    const result = inspect(candidate([{ nested }]));
    const field = result.collections[0]!.fields[0]!;
    assert.deepEqual(field.types, ["object"]);
    assert.deepEqual(field.samples, [{ recordIndex: 0, value: nested }]);
    assert.notEqual(field.samples[0]!.value, nested);
  });

  it("distinguishes missing fields from null and reports every observed type", () => {
    const records: SourceRecord[] = [
      { value: null }, {}, { value: false }, { value: 0 }, { value: "" },
      { value: [] }, { value: {} },
    ];
    const field = inspect(candidate(records)).collections[0]!.fields[0]!;
    assert.equal(field.presentCount, 6);
    assert.deepEqual(field.types, ["array", "boolean", "null", "number", "object", "string"]);
    assert.deepEqual(field.samples, [
      { recordIndex: 0, value: null },
      { recordIndex: 2, value: false },
      { recordIndex: 3, value: 0 },
    ]);
  });

  it("samples the first three present values without deduplicating or coercing", () => {
    const result = inspect(candidate([{ a: 1 }, { a: 1 }, { a: "1" }, { a: 2 }]));
    assert.deepEqual(result.collections[0]!.fields[0]!.samples, [
      { recordIndex: 0, value: 1 }, { recordIndex: 1, value: 1 }, { recordIndex: 2, value: "1" },
    ]);
  });

  it("orders field names by code units, not locale or first appearance", () => {
    const result = inspect(candidate([{ z: 1, "ä": 2, a: 3 }, { "10": 4, "2": 5 }]));
    assert.deepEqual(result.collections[0]!.fields.map((field) => field.name), ["10", "2", "a", "z", "ä"]);
  });

  it("produces deterministic fresh results", () => {
    const input = candidate([{ a: { nested: [1, 2] } }]);
    const first = inspect(input);
    const second = inspect(input);
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.notEqual(first.collections[0]!.fields[0]!.samples[0]!.value,
      second.collections[0]!.fields[0]!.samples[0]!.value);
  });

  it("does not mutate deeply frozen caller-owned data", () => {
    const input = candidate([{ nested: { items: ["A", "B"] } }]);
    const before = structuredClone(input);
    deepFreeze(input);
    assert.doesNotThrow(() => inspect(input));
    assert.deepEqual(input, before);
  });

  it("returns detached metadata and sample values", () => {
    const input = candidate([{ nested: { items: ["A", "B"] } }]);
    const result = inspect(input);
    const sample = result.collections[0]!.fields[0]!.samples[0]!.value as { items: string[] };
    sample.items.push("C");
    (input.source as { label: string }).label = "Changed";
    assert.deepEqual(input.collections[0]!.records[0]!.nested, { items: ["A", "B"] });
    assert.equal(result.source.label, "Synthetic material");
  });

  it("allows shared subtrees without mistaking them for cycles", () => {
    const shared = { a: [1, 2] };
    const result = inspect(candidate([{ first: shared, second: shared }]));
    const samples = result.collections[0]!.fields.map((field) => field.samples[0]!.value);
    assert.deepEqual(samples, [shared, shared]);
    assert.notEqual(samples[0], samples[1]);
  });

  it("handles nested structured values without recursive call-stack traversal", () => {
    let nested: SourceValue = "leaf";
    for (let index = 0; index < 2000; index += 1) nested = { child: nested };
    let value = inspect(candidate([{ nested }])).collections[0]!.fields[0]!.samples[0]!.value;
    for (let index = 0; index < 2000; index += 1) {
      assert.ok(isRecord(value));
      value = value.child!;
    }
    assert.equal(value, "leaf");
  });

  it("preserves null-prototype records", () => {
    const record: SourceRecord = Object.assign(Object.create(null) as SourceRecord, { text: "A" });
    assert.deepEqual(inspect(candidate([record])).collections[0]!.fields[0]!.samples, [
      { recordIndex: 0, value: "A" },
    ]);
  });

  it("keeps prototype-like field names as data without prototype mutation", () => {
    const nested = Object.fromEntries([["__proto__", { polluted: true }], ["constructor", "data"]]);
    const records = [Object.fromEntries([["__proto__", nested], ["constructor", "field"], ["", "empty"]])];
    const fields = inspect(candidate(records)).collections[0]!.fields;
    assert.deepEqual(fields.map((field) => field.name), ["", "__proto__", "constructor"]);
    const sample = fields[1]!.samples[0]!.value;
    assert.ok(isRecord(sample));
    assert.equal(Object.getPrototypeOf(sample), Object.prototype);
    assert.ok(Object.hasOwn(sample, "__proto__"));
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  });

  it("keeps source metadata upstream and adapter IDs out of record fields", () => {
    const input = {
      ...candidate([{ field: "A" }]),
      source: {
        key: "temporary/one",
        label: "Material",
        originalFilename: "material.custom",
        mediaType: "application/x-synthetic",
        format: "synthetic-format",
      },
    } satisfies MappingCandidate;
    const result = inspect(input);
    assert.deepEqual(result.source, input.source);
    assert.equal(result.adapterId, input.adapterId);
    assert.deepEqual(result.collections[0]!.fields.map((field) => field.name), ["field"]);
  });

  it("never transforms question-shaped source data into a StudySet", () => {
    const rawRecord = {
      questionText: "What should remain source data?",
      choices: ["One", "Two"],
      answerIndex: 1,
      chapter: "Safety",
    };
    const input = candidate([rawRecord]);
    const before = structuredClone(input);
    const result = inspect(input);
    assert.deepEqual(input, before);
    assert.deepEqual(result.collections[0]!.fields.map((field) => field.name),
      ["answerIndex", "chapter", "choices", "questionText"]);
    assert.deepEqual(result.collections[0]!.fields[2]!.samples[0]!.value, ["One", "Two"]);
    assert.equal("questions" in result, false);
    assert.equal("schemaVersion" in result, false);
    assert.equal("correctChoiceId" in rawRecord, false);
    assert.equal("id" in rawRecord, false);
  });

  it("keeps temporary keys and source record IDs distinct from canonical identity", () => {
    const input = candidate([{ id: "external / id", questionText: "A" }]);
    const result = inspect(input);
    assert.equal(result.source.key, "temporary source / 1");
    assert.equal(result.collections[0]!.key, "root/rows");
    assert.deepEqual(result.collections[0]!.fields[0]!.samples, [
      { recordIndex: 0, value: "external / id" },
    ]);
    assert.equal("id" in result.source, false);
    assert.equal("questionId" in result.collections[0]!, false);
  });
});

describe("structured adapter contract", () => {
  it("supports a synthetic adapter success followed by independent inspection", () => {
    const input: NormalizedStructuredSource = {
      kind: "structured",
      source: { key: "adapter-source" },
      value: [{ vendorField: "A" }],
    };
    const before = structuredClone(input);
    deepFreeze(input);
    const projected = syntheticAdapter.inspect(input);
    assert.ok(projected.success);
    const result = inspect(projected.value);
    assert.equal(result.adapterId, syntheticAdapter.id);
    assert.equal(result.collections[0]!.fields[0]!.name, "vendorField");
    assert.deepEqual(input, before);
    assert.deepEqual(syntheticAdapter.inspect(input), projected);
  });

  it("returns an expected unsupported-source failure instead of throwing", () => {
    const input: NormalizedStructuredSource = {
      kind: "structured", source: { key: "adapter-source" }, value: "not a record array",
    };
    assert.deepEqual(syntheticAdapter.inspect(input), {
      success: false, error: { code: "unsupported-source", adapterId: "synthetic/records" },
    });
  });
});

describe("invalid neutral candidates", () => {
  it("rejects unknown candidate shapes without detecting source collections", () => {
    expectInvalidAt([{ questionText: "A" }], [], "invalid-shape");
  });

  it("rejects blank source keys and non-string metadata", () => {
    expectInvalidAt({ ...candidate([]), source: { key: " " } }, ["source"], "invalid-metadata");
    expectInvalidAt({ ...candidate([]), source: { key: "one", format: 7 } }, ["source"], "invalid-metadata");
  });

  it("rejects blank adapter IDs", () => {
    expectInvalidAt({ ...candidate([]), adapterId: "" }, ["adapterId"], "invalid-metadata");
  });

  it("rejects missing collection arrays and invalid collections", () => {
    expectInvalidAt({ ...candidate([]), collections: {} }, ["collections"], "invalid-shape");
    expectInvalidAt({ ...candidate([]), collections: [null] }, ["collections", 0], "invalid-shape");
  });

  it("rejects invalid collection keys and labels", () => {
    expectInvalidAt({ ...candidate([]), collections: [{ key: "", records: [] }] },
      ["collections", 0, "key"], "invalid-metadata");
    expectInvalidAt({ ...candidate([]), collections: [{ key: "one", label: false, records: [] }] },
      ["collections", 0, "label"], "invalid-metadata");
  });

  it("rejects duplicate keys instead of merging collections", () => {
    const collection: RecordCollection = { key: "one", records: [] };
    expectInvalidAt({ ...candidate([]), collections: [collection, collection] },
      ["collections", 1, "key"], "duplicate-collection-key");
  });

  it("requires record arrays of field objects", () => {
    expectInvalidAt({ ...candidate([]), collections: [{ key: "one", records: {} }] },
      ["collections", 0, "records"], "invalid-shape");
    for (const record of [null, 1, "A", [], false]) {
      expectInvalidAt({ ...candidate([]), collections: [{ key: "one", records: [record] }] },
        ["collections", 0, "records", 0], "invalid-shape");
    }
  });

  it("rejects unexpected envelope metadata without interpreting it", () => {
    expectInvalidAt({ ...candidate([]), schemaVersion: "1.0.0" }, [], "invalid-shape");
    expectInvalidAt({ ...candidate([]), source: { key: "one", canonicalId: "source-1" } },
      ["source"], "invalid-metadata");
  });

  const unsupportedValues: readonly [string, unknown][] = [
    ["undefined", undefined],
    ["NaN", NaN],
    ["infinity", Infinity],
    ["negative infinity", -Infinity],
    ["a function", () => "A"],
    ["a symbol", Symbol("field")],
    ["a bigint", 1n],
    ["a Date", new Date(0)],
    ["a Map", new Map([["a", "b"]])],
    ["a custom class", new class { field = "A"; }()],
    ["a sparse array", Array(2)],
  ];
  for (const [label, value] of unsupportedValues) {
    it("rejects " + label + " as a source value", () => {
      expectInvalidAt({ ...candidate([]), collections: [{ key: "one", records: [{ field: value }] }] },
        ["collections", 0, "records", 0, "field"]);
    });
  }

  it("rejects ancestor cycles", () => {
    const record: { field?: unknown } = {};
    record.field = record;
    expectInvalidAt({ ...candidate([]), collections: [{ key: "one", records: [record] }] },
      ["collections", 0, "records", 0, "field"]);
  });

  it("rejects accessors without executing them", () => {
    let accessed = false;
    const record = Object.defineProperty({}, "field", {
      enumerable: true,
      get() { accessed = true; return "A"; },
    });
    expectInvalidAt(candidate([record]), ["collections", 0, "records", 0, "field"]);
    assert.equal(accessed, false);
  });

  it("rejects symbol and hidden properties that serialization would lose", () => {
    const symbolRecord = { [Symbol("hidden")]: "A" };
    expectInvalidAt(candidate([symbolRecord]), ["collections", 0, "records", 0]);
    const hiddenRecord = Object.defineProperty({}, "field", { value: "A" });
    expectInvalidAt(candidate([hiddenRecord]), ["collections", 0, "records", 0, "field"]);
  });

  it("rejects extra array properties instead of silently dropping them", () => {
    const array = Object.assign(["A"], { extra: "B" });
    expectInvalidAt(candidate([{ field: array }]), ["collections", 0, "records", 0, "field"]);
  });

  it("checks invalid values beyond the sample window", () => {
    const records = [{ field: 1 }, { field: 2 }, { field: 3 }, { field: NaN }];
    expectInvalidAt(candidate(records), ["collections", 0, "records", 3, "field"]);
  });
});

// Compile-time contracts, deliberately never called or run as mutation tests.
function staticContracts(source: NormalizedStructuredSource, input: MappingCandidate): void {
  // @ts-expect-error Normalized sources and mapping candidates are distinct stages.
  const candidateFromSource: MappingCandidate = source;
  // @ts-expect-error A candidate is not a normalized source document.
  const sourceFromCandidate: NormalizedStructuredSource = input;
  // @ts-expect-error Public input data is readonly.
  source.value = null;
  // @ts-expect-error Collection membership is readonly.
  input.collections.push({ key: "extra", records: [] });
  // @ts-expect-error Functions are not serializable source values.
  const badValue: SourceValue = () => "A";
  void candidateFromSource;
  void sourceFromCandidate;
  void badValue;
}
void staticContracts;
