import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceRecord } from "@openstudy/import-core";
import { CURRENT_SCHEMA_VERSION, PortableIdSchema, StudySetSchema } from "@openstudy/schema";
import {
  discoverFields, fieldLabel, inspectRecord, previewMapping, readField, validateMapping,
  type MappingDefinition, type MappingInput, type MappingTarget,
} from "../src/index.js";

const definition: MappingDefinition = {
  collectionKey: "records:/questions",
  promptPath: ["q"], choicesPath: ["a"],
  correctAnswer: { path: ["answer"], mode: "zero-based-index" },
};
const record = { q: "Where?", a: ["Lisbon", "Paris", "London"], answer: 1 };
function input(records: readonly SourceRecord[] = [record], mapping = definition, extra: Partial<MappingInput> = {}): MappingInput {
  return {
    source: { key: "source:0", label: "questions.json", originalFilename: "questions.json" },
    collection: { key: definition.collectionKey, records },
    definition: mapping, identity: { namespace: "0123456789abcdef0123456789abcdef" }, title: "Geography",
    ...extra,
  };
}
function candidate(value: MappingInput) {
  const result = validateMapping(value);
  assert(result.status === "ready", JSON.stringify(result));
  return result.candidate;
}
function expectIssue(records: readonly SourceRecord[], target: MappingTarget, code?: string, mapping = definition) {
  const result = validateMapping(input(records, mapping));
  assert.equal(result.status, "invalid");
  assert(!("candidate" in result));
  assert(result.issues.some((entry) => entry.target === target && (!code || entry.code === code)), JSON.stringify(result));
  return result;
}

describe("explicit canonical transformation", () => {
  it("maps zero-based indexes and validates the canonical result", () => {
    const set = candidate(input());
    assert.equal(set.questions[0]!.choices[1]!.id, set.questions[0]!.correctChoiceId);
    assert.equal(set.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(set.revision, 1);
    assert(StudySetSchema.safeParse(set).success);
  });
  it("maps one-based indexes", () => {
    const set = candidate(input([{ ...record, answer: 2 }], {
      ...definition, correctAnswer: { path: ["answer"], mode: "one-based-index" },
    }));
    assert.equal(set.questions[0]!.correctChoiceId, set.questions[0]!.choices[1]!.id);
  });
  it("matches exact choice text", () => {
    const set = candidate(input([{ ...record, answer: "London" }], {
      ...definition, correctAnswer: { path: ["answer"], mode: "choice-text" },
    }));
    assert.equal(set.questions[0]!.correctChoiceId, set.questions[0]!.choices[2]!.id);
  });
  it("creates unique categories in first-occurrence order with exact labels", () => {
    const set = candidate(input([
      { ...record, topic: "Signals" }, { ...record, topic: "Signals" },
      { ...record, topic: "signals" }, { ...record, topic: " Signals " },
    ], { ...definition, categoryPath: ["topic"] }));
    assert.deepEqual(set.categories.map((entry) => entry.label), ["Signals", "signals", " Signals "]);
    assert.deepEqual(set.questions[0]!.categoryIds, set.questions[1]!.categoryIds);
    assert.notEqual(set.categories[0]!.id, "Signals");
  });
  it("maps explanation and external ID into provenance, never internal identity", () => {
    const set = candidate(input([{ ...record, why: "Because.", systemId: "record / 8" }], {
      ...definition, explanationPath: ["why"], externalIdPath: ["systemId"],
    }));
    const question = set.questions[0]!;
    assert.equal(question.explanation, "Because.");
    assert.equal(question.provenance?.[0]?.externalId, "record / 8");
    assert.notEqual(question.id, "record / 8");
    assert.equal(question.provenance?.[0]?.locator, "records:/questions/record:0");
    assert.equal(question.provenance?.[0]?.sourceId, set.sources[0]!.id);
  });
  it("accepts missing optional values and omits them", () => {
    const set = candidate(input([record], {
      ...definition, categoryPath: ["topic"], explanationPath: ["why"], externalIdPath: ["systemId"],
    }));
    assert.deepEqual(set.categories, []);
    assert(!("explanation" in set.questions[0]!));
    assert(!("categoryIds" in set.questions[0]!));
    assert(!("externalId" in set.questions[0]!.provenance![0]!));
  });
  it("generates portable, distinct IDs across entities and records", () => {
    const set = candidate(input([{ ...record, topic: "Topic" }, { ...record, topic: "Other" }], {
      ...definition, categoryPath: ["topic"],
    }));
    const ids = [set.id, ...set.sources.map((entry) => entry.id), ...set.categories.map((entry) => entry.id),
      ...set.questions.flatMap((question) => [question.id, ...question.choices.map((choice) => choice.id)])];
    assert(ids.every((value) => PortableIdSchema.safeParse(value).success));
    assert.equal(new Set(ids).size, ids.length);
    assert(ids.every((value) => !/^\d+$/.test(value)));
  });
  it("keeps identity independent of mutable text", () => {
    const first = candidate(input());
    const second = candidate(input([{ ...record, q: "A different question", a: ["X", "Y", "Z"] }]));
    assert.equal(first.id, second.id);
    assert.equal(first.questions[0]!.id, second.questions[0]!.id);
    assert.deepEqual(first.questions[0]!.choices.map((choice) => choice.id), second.questions[0]!.choices.map((choice) => choice.id));
  });
  it("uses different opaque identities for separate imports", () => {
    assert.notEqual(candidate(input()).id, candidate(input([record], definition, {
      identity: { namespace: "ffffffffffffffffffffffffffffffff" },
    })).id);
  });
  it("is deterministic with a serialized mapping and the same identity", () => {
    const serialized = JSON.parse(JSON.stringify(definition)) as MappingDefinition;
    assert.deepEqual(validateMapping(input()), validateMapping(input([record], serialized)));
    assert.deepEqual(previewMapping(input()), previewMapping(input([record], serialized)));
  });
  it("does not mutate source records, arrays, definition, or metadata", () => {
    const records = [Object.freeze({ ...record, a: Object.freeze([...record.a]), topic: "X" })];
    const mapping = Object.freeze({ ...definition, categoryPath: Object.freeze(["topic"]) });
    const value = input(Object.freeze(records), mapping);
    const before = JSON.stringify(value);
    candidate(value);
    assert.equal(JSON.stringify(value), before);
  });
  it("does not leak source field names into canonical fields", () => {
    const set = candidate(input([{ unusualPrompt: "Question?", unusualAnswers: ["A", "B"], unusualKey: 0 }], {
      ...definition, promptPath: ["unusualPrompt"], choicesPath: ["unusualAnswers"],
      correctAnswer: { path: ["unusualKey"], mode: "zero-based-index" },
    }));
    assert(!JSON.stringify(set).includes("unusual"));
  });
  it("preserves only the selected ZIP entry origin", () => {
    const set = candidate(input([record], definition, {
      source: { key: "source:4", label: "folder/questions.json", originalFilename: "folder/questions.json", format: "json" },
    }));
    assert.equal(set.sources.length, 1);
    assert.equal(set.sources[0]!.originalFilename, "folder/questions.json");
    assert(!JSON.stringify(set).includes("source:4"));
  });
  it("does not deduplicate repeated questions", () => {
    assert.equal(candidate(input([record, record])).questions.length, 2);
  });
});

describe("strict, contextual record issues", () => {
  for (const [label, q] of [["missing", undefined], ["blank", " "], ["number", 8], ["boolean", true], ["object", {}], ["array", []]] as const) {
    it("rejects a " + label + " prompt", () => {
      const { q: _q, ...remaining } = record;
      expectIssue([q === undefined ? remaining : { ...record, q }], "prompt");
    });
  }
  for (const [label, a] of [["object", {}], ["string", "A"], ["numeric array", [1, 2]], ["mixed array", ["A", {}]], ["blank answer", ["A", " "]]] as const) {
    it("rejects " + label + " answers without stringifying", () => { expectIssue([{ ...record, a }], "choices"); });
  }
  it("uses canonical minimum-choice validation", () => { expectIssue([{ ...record, a: ["A"], answer: 0 }], "choices", "too_small"); });
  for (const answer of [-1, 3, 9007199254740992, 0.5, "1", null]) {
    it("rejects invalid zero-based answer " + JSON.stringify(answer), () => { expectIssue([{ ...record, answer }], "correctAnswer"); });
  }
  it("rejects zero in one-based mode", () => { expectIssue([{ ...record, answer: 0 }], "correctAnswer", "answer-out-of-range", {
    ...definition, correctAnswer: { path: ["answer"], mode: "one-based-index" },
  }); });
  for (const answer of ["paris", " Paris ", "Berlin"]) {
    it("does not normalize or guess answer " + JSON.stringify(answer), () => { expectIssue([{ ...record, answer }], "correctAnswer", "answer-not-found", {
      ...definition, correctAnswer: { path: ["answer"], mode: "choice-text" },
    }); });
  }
  it("rejects duplicate exact correct text rather than selecting the first", () => { expectIssue([
    { ...record, a: ["Paris", "Paris", "London"], answer: "Paris" },
  ], "correctAnswer", "ambiguous-answer", { ...definition, correctAnswer: { path: ["answer"], mode: "choice-text" } }); });
  it("allows duplicate labels with unambiguous index interpretation", () => {
    assert.equal(candidate(input([{ ...record, a: ["A", "A"], answer: 1 }])).questions.length, 1);
  });
  for (const [target, mapping] of [
    ["category", { categoryPath: ["value"] }], ["explanation", { explanationPath: ["value"] }],
    ["externalId", { externalIdPath: ["value"] }],
  ] as const) {
    for (const value of [null, "", 42]) {
      it("rejects present invalid " + target + " " + JSON.stringify(value),
        () => { expectIssue([{ ...record, value }], target, undefined, { ...definition, ...mapping }); });
    }
  }
  it("reports zero-based record context and never returns a partial candidate", () => {
    const result = expectIssue([record, { ...record, q: {} }, record], "prompt");
    assert.equal(result.inspectedCount, 3);
    assert.equal(result.validCount, 2);
    assert.equal(result.invalidCount, 1);
    assert.equal(result.issues[0]!.recordIndex, 1);
  });
});

describe("preview, configuration, and final boundary", () => {
  it("previews only three attempted records and does not hide invalid ones", () => {
    const value = input([{ ...record, q: null }, record, record, { ...record, answer: 99 }]);
    const preview = previewMapping(value);
    assert.deepEqual(preview.records.map((entry) => entry.recordIndex), [0, 1, 2]);
    assert(preview.records[0]!.issues.length);
    assert.equal(preview.totalRecords, 4);
    const full = validateMapping(value);
    assert.equal(full.validCount, 2);
    assert.equal(full.invalidCount, 2);
  });
  it("inspects a later bad record with original values and a partial preview", () => {
    const inspected = inspectRecord(input([record, { ...record, answer: 99 }]), 1)!;
    assert.equal(inspected.values.correctAnswer?.value, 99);
    assert.equal(inspected.display.prompt, "Where?");
    assert.equal(inspected.display.choices.length, 3);
    assert.equal(inspected.question, undefined);
    assert.equal(inspectRecord(input(), -1), undefined);
    assert.equal(inspectRecord(input(), 4), undefined);
  });
  it("requires an explicit answer mode", () => {
    const invalid = { ...definition, correctAnswer: { path: ["answer"], mode: "" } } as unknown as MappingDefinition;
    const result = validateMapping(input([record], invalid));
    assert.equal(result.issues[0]!.code, "missing-answer-mode");
    assert.equal(result.inspectedCount, 0);
  });
  it("rejects a mismatched collection rather than applying another mapping", () => {
    assert.equal(validateMapping(input([record], { ...definition, collectionKey: "elsewhere" })).issues[0]!.code, "collection-mismatch");
  });
  it("rejects absent paths and untrusted identity context", () => {
    assert.equal(validateMapping(input([record], { ...definition, promptPath: [] })).issues[0]!.code, "invalid-path");
    assert.equal(validateMapping(input([record], definition, { identity: { namespace: "imported ID" } })).issues[0]!.code, "invalid-identity");
  });
  it("returns a structured whole-candidate error for a blank title", () => {
    const result = validateMapping(input([record], definition, { title: " " }));
    assert.equal(result.status, "invalid");
    assert.equal(result.validCount, 1);
    assert.equal(result.issues[0]!.target, "title");
    assert(!("candidate" in result));
  });
  it("validates optional description canonically", () => {
    assert.equal(candidate(input([record], definition, { description: "My description" })).description, "My description");
    assert.equal(validateMapping(input([record], definition, { description: "" })).issues[0]!.target, "description");
  });
  it("reports an empty collection without pretending it is ready", () => {
    const result = validateMapping(input([]));
    assert.equal(result.status, "invalid");
    assert.match(result.issues[0]!.message, /empty/);
  });
  it("surfaces invalid source metadata without throwing", () => {
    const result = validateMapping(input([record], definition, { source: { key: "s", label: "" } }));
    assert.equal(result.status, "invalid");
    assert.equal(result.issues[0]!.target, "studySet");
  });
  it("validates thousands of records with stable unique IDs", () => {
    const set = candidate(input(Array.from({ length: 10_000 }, () => record)));
    assert.equal(set.questions.length, 10_000);
    assert.equal(new Set(set.questions.map((entry) => entry.id)).size, 10_000);
  });
});

describe("bounded source paths and samples", () => {
  it("supports nested objects and distinguishes literal dots and slashes", () => {
    const value = { question: { text: "Nested?" }, "question.text": "Literal?", "a/b": ["A", "B"], answer: 0 };
    const set = candidate(input([value], {
      ...definition, promptPath: ["question", "text"], choicesPath: ["a/b"],
    }));
    assert.equal(set.questions[0]!.prompt, "Nested?");
    assert.equal(readField(value, ["question.text"]).value, "Literal?");
    assert.equal(fieldLabel(["question", "text"]), "question.text");
    assert.equal(fieldLabel(["question.text"]), '["question.text"]');
    assert.equal(fieldLabel(["a/b"]), '["a/b"]');
  });
  it("uses own properties, including prototype-like names, without invoking getters", () => {
    const value = JSON.parse('{"__proto__":{"q":"Own"},"constructor":"Own too"}') as SourceRecord;
    assert.equal(readField(value, ["__proto__", "q"]).value, "Own");
    assert.equal(readField(value, ["constructor"]).value, "Own too");
    assert.equal(readField({}, ["constructor"]).present, false);
    const object = Object.create({ q: "Inherited" }) as SourceRecord;
    Object.defineProperty(object, "accessor", { enumerable: true, get() { throw new Error("must not run"); } });
    assert.equal(readField(object, ["q"]).present, false);
    assert.equal(readField(object, ["accessor"]).present, false);
    assert.deepEqual(discoverFields({ key: "x", records: [object] }).fields, []);
  });
  it("does not interpret array elements as object paths", () => {
    assert.equal(readField(record, ["a", "0"]).present, false);
  });
  it("samples three present original values, preserving null and missing distinction", () => {
    const collection = { key: "x", records: [{ x: null }, {}, { x: "A" }, { x: ["B"] }, { x: "C" }] };
    const fields = discoverFields(collection);
    assert.deepEqual(fields.fields[0]!.samples.map((sample) => sample.recordIndex), [0, 2, 3]);
    assert.equal(fields.fields[0]!.samples[0]!.value, null);
    assert.equal(readField(collection.records[1]!, ["x"]).present, false);
  });
  it("caps selectable field discovery and reports the limitation", () => {
    const wide = Object.fromEntries(Array.from({ length: 300 }, (_, index) => ["field" + index, "value"]));
    const result = discoverFields({ key: "x", records: [wide] });
    assert.equal(result.fields.length, 200);
    assert.equal(result.truncated, true);
  });
});
