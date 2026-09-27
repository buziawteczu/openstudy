// @vitest-environment jsdom
import fixture from "./fixtures/source-records.json?raw";
import { describe, expect, it, vi } from "vitest";
import { ingestFile } from "../src/import/ingest-file.js";
import { INGESTION_LIMITS } from "../src/import/limits.js";
import { patchEntrySize, zipFixture } from "./zip-fixture.js";
import { ZipReader, type Entry } from "@zip.js/zip.js/lib/zip-core-native.js";

const file = (text: string, name = "source.json") => new File([text], name);
const zipFile = async (entries: readonly (readonly [string, string | Uint8Array])[], compressed = false) => new File([await zipFixture(entries, compressed)], "source.zip");
const limits = (overrides: Partial<typeof INGESTION_LIMITS> | Record<string, number>) => ({ ...INGESTION_LIMITS, ...overrides });

async function expectCode(input: File, code: string, overrides: Record<string, number> = {}) {
  const result = await ingestFile(input, limits(overrides));
  expect(result).toMatchObject({ success: false, error: { code, filename: input.name } });
  return result;
}

describe("local JSON ingestion", () => {
  it("preserves fields and nested values in a root record array", async () => {
    const result = await ingestFile(file(fixture));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value).toMatchObject({ collectionCount: 1, recordCount: 2 });
    expect(result.value.sources[0]!.candidate.collections[0]!.records).toEqual(JSON.parse(fixture));
    expect(result.value.sources[0]!.inspection.collections[0]!.fields.map((field) => field.name)).toContain("correctIndex");
    expect(result.value.sources[0]!.candidate.collections[0]!.records[0]).not.toHaveProperty("prompt");
  });
  it("inspects multiple nested collections without question-name assumptions", async () => {
    const result = await ingestFile(file('{"outer":{"apples":[{"x":1}],"oranges":[{},{}]}}'));
    expect(result).toMatchObject({ success: true, value: { collectionCount: 2, recordCount: 3 } });
  });
  it("rejects malformed JSON", async () => { await expectCode(file("{"), "malformed-json"); });
  it("rejects invalid UTF-8", async () => { await expectCode(new File([new Uint8Array([0xff])], "bad.json"), "malformed-json"); });
  it("rejects non-finite parsed numbers", async () => { await expectCode(file('[{"x":1e400}]'), "malformed-json"); });
  it("rejects oversized input before reading", async () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    await expectCode(file(fixture), "file-too-large", { jsonBytes: 2 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("rejects unsupported extensions independently of MIME hints", async () => {
    await expectCode(new File([fixture], "file.csv", { type: "application/json" }), "unsupported-file-type");
  });
  it("accepts uppercase supported extensions", async () => {
    expect(await ingestFile(file(fixture, "source.JSON"))).toMatchObject({ success: true });
  });
  it("requires an actual supported extension", async () => {
    await expectCode(file(fixture, "json"), "unsupported-file-type");
  });
  it("accepts a UTF-8 BOM without changing Unicode source text", async () => {
    const result = await ingestFile(file('\uFEFF[{"text":"Zażółć 你好"}]'));
    expect(result).toMatchObject({ success: true, value: { sources: [{ candidate: { collections: [{ records: [{ text: "Zażółć 你好" }] }] } }] } });
  });
  it("returns no-record-collection rather than malformed JSON", async () => {
    await expectCode(file('[1,2]'), "no-record-collection");
  });
  it("bounds nesting before inspection", async () => {
    await expectCode(file('[{"nested":{"child":{"deep":true}}}]'), "json-resource-limit", { jsonDepth: 2 });
  });
  it("bounds node count before inspection", async () => {
    await expectCode(file('[{"many":[1,2,3,4,5]}]'), "json-resource-limit", { jsonNodes: 4 });
  });
  it("returns deterministic output without retaining caller-owned mutable data", async () => {
    const first = await ingestFile(file(fixture));
    const second = await ingestFile(file(fixture));
    expect(first).toEqual(second);
    if (first.success && second.success) expect(first.value.sources[0]!.candidate).not.toBe(second.value.sources[0]!.candidate);
  });
  it("supports harmless prototype-like field names", async () => {
    const result = await ingestFile(file('[{"__proto__":{"a":1},"constructor":"data"}]'));
    expect(result.success).toBe(true);
    if (result.success) expect(Object.hasOwn(result.value.sources[0]!.candidate.collections[0]!.records[0]!, "__proto__")).toBe(true);
  });
  it("represents empty collections honestly", async () => {
    expect(await ingestFile(file("[]"))).toMatchObject({ success: true, value: { collectionCount: 1, recordCount: 0 } });
  });
  it("does not treat schemaVersion as authority to create a StudySet", async () => {
    const result = await ingestFile(file('{"schemaVersion":"999.0.0","rows":[{"id":"external"}]}'));
    expect(result).toMatchObject({ success: true, value: { collectionCount: 1, recordCount: 1 } });
  });
  it("supports cancellation without turning it into an ingestion error", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(ingestFile(file(fixture), undefined, controller.signal)).rejects.toBeDefined();
  });
});

describe("bounded ZIP ingestion", () => {
  it("accepts one JSON entry with source identity", async () => {
    const result = await ingestFile(await zipFile([["folder/source.json", fixture]], true));
    expect(result).toMatchObject({ success: true, value: { collectionCount: 1, recordCount: 2 } });
    if (result.success) expect(result.value.sources[0]!.candidate.source.originalFilename).toBe("folder/source.json");
  });
  it("accepts multiple JSON entries, ignores directories and harmless non-JSON", async () => {
    const input = await zipFile([["folder/", ""], ["folder/a.json", fixture], ["b.JSON", '[{"other":true}]'], ["readme.txt", "Hello"]]);
    expect(await ingestFile(input)).toMatchObject({ success: true, value: { collectionCount: 2, recordCount: 3, sources: [{ candidate: { source: { key: "source:0" } } }, { candidate: { source: { key: "source:1" } } }] } });
  });
  it("fails on no JSON entries", async () => { await expectCode(await zipFile([["notes.txt", "Hi"]]), "no-json-files"); });
  it("fails on empty archives", async () => { await expectCode(await zipFile([]), "no-json-files"); });
  it("fails on corrupt ZIP bytes", async () => { await expectCode(file("not a ZIP", "broken.zip"), "corrupt-zip"); });
  it("rejects compressed raw input before reading", async () => { await expectCode(await zipFile([["a.json", fixture]]), "file-too-large", { zipBytes: 1 }); });
  it("counts all entries including empty directories", async () => {
    await expectCode(await zipFile([["a/", ""], ["a.json", "[]"], ["b/", ""]]), "too-many-archive-entries", { archiveEntries: 2 });
  });
  it("bounds declared total output including ignored non-JSON", async () => {
    await expectCode(await zipFile([["a.json", "[]"], ["ignored.txt", "123456789"]]), "extracted-size-limit", { extractedBytes: 10 });
  });
  it("bounds individual JSON entries", async () => { await expectCode(await zipFile([["a.json", fixture]]), "file-too-large", { jsonBytes: 5 }); });
  it("rejects nested archives even alongside usable JSON", async () => {
    await expectCode(await zipFile([["a.json", fixture], ["nested.zip", await zipFixture([])]]), "nested-archive-unsupported");
  });
  it("detects ZIP magic in renamed non-JSON entries", async () => {
    await expectCode(await zipFile([["a.json", fixture], ["renamed.txt", await zipFixture([])]]), "nested-archive-unsupported");
  });
  it("rejects duplicate normalized names", async () => {
    await expectCode(await zipFile([["a.json", "[]"], ["./a.json", "[]"]]), "duplicate-archive-entry");
  });
  it("normalizes backslashes and harmless dot segments", async () => {
    const result = await ingestFile(await zipFile([["folder\\./a.json", fixture]]));
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.sources[0]!.candidate.source.originalFilename).toBe("folder/a.json");
  });
  it.each(["../a.json", "../../a.json", "/absolute/a.json", "C:\\folder\\a.json", "\\\\server\\a.json", "a\u0000.json"])("rejects unsafe path %s", async (path) => {
    await expectCode(await zipFile([[path, fixture]]), "unsafe-archive-path");
  });
  it("rejects expansion beyond the configurable ratio", async () => {
    await expectCode(await zipFile([["a.json", '[{"text":"' + "x".repeat(4096) + '"}]']], true), "compression-ratio-limit", { compressionRatio: 2 });
  });
  it("rejects underreported extracted metadata before retaining its output", async () => {
    const bytes = patchEntrySize(await zipFixture([["a.json", fixture]], true), 1);
    await expectCode(new File([bytes], "lying.zip"), "corrupt-zip", { extractedBytes: 8 });
  });
  it("rejects underreported individual metadata before retaining its output", async () => {
    const bytes = patchEntrySize(await zipFixture([["a.json", fixture]], true), 1);
    await expectCode(new File([bytes], "lying.zip"), "corrupt-zip", { jsonBytes: 8 });
  });
  it.each([
    ["extracted-size-limit", { extractedBytes: 8 }],
    ["file-too-large", { jsonBytes: 8 }],
    ["compression-ratio-limit", { compressionRatio: 2 }],
  ] as const)("the bounded sink independently enforces %s on unexpected output", async (code, overrides) => {
    const entry = {
      filename: "a.json", directory: false, encrypted: false, symlink: false,
      diskNumberStart: 0, compressionMethod: 0, compressedSize: 1, uncompressedSize: 1,
      getData: async (sink: WritableStream<Uint8Array>) => {
        const writer = sink.getWriter();
        try { await writer.write(new Uint8Array(16)); } finally { writer.releaseLock(); }
      },
    } as unknown as Entry;
    const spy = vi.spyOn(ZipReader.prototype, "getEntriesGenerator").mockImplementation(async function* () {
      yield entry;
      return true;
    });
    try { await expectCode(new File([new Uint8Array(1)], "unexpected.zip"), code, overrides); }
    finally { spy.mockRestore(); }
  });
  it("reports unavailable native decompression without uploading or fetching a fallback", async () => {
    const input = await zipFile([["a.json", fixture]], true);
    vi.stubGlobal("DecompressionStream", undefined);
    try { await expectCode(input, "unsupported-browser"); }
    finally { vi.unstubAllGlobals(); }
  });
  const sinkFailureCases = [
    { code: "nested-archive-unsupported", overrides: {}, chunk: new Uint8Array([0x50, 0x4b, 5, 6]) },
    { code: "extracted-size-limit", overrides: { extractedBytes: 8 }, chunk: new Uint8Array(16) },
    { code: "file-too-large", overrides: { jsonBytes: 8 }, chunk: new Uint8Array(16) },
    { code: "compression-ratio-limit", overrides: { compressionRatio: 2 }, chunk: new Uint8Array(16) },
  ] satisfies { code: string; overrides: Record<string, number>; chunk: Uint8Array }[];
  it.each(sinkFailureCases.flatMap((scenario) => [
    { ...scenario, cleanup: "replaces" },
    { ...scenario, cleanup: "swallows" },
  ]))("preserves $code when reader cleanup $cleanup the sink error", async ({ code, overrides, chunk, cleanup }) => {
    const entry = {
      filename: "a.json", directory: false, encrypted: false, symlink: false,
      diskNumberStart: 0, compressionMethod: 0, compressedSize: 1, uncompressedSize: 1,
      getData: async (sink: WritableStream<Uint8Array>) => {
        const writer = sink.getWriter();
        try {
          try { await writer.write(chunk); }
          catch {
            // Model runtimes/readers that obscure the original policy rejection.
            if (cleanup === "replaces") throw new TypeError("Invalid state: WritableStream is closed");
          }
        } finally { writer.releaseLock(); }
      },
    } as unknown as Entry;
    const spy = vi.spyOn(ZipReader.prototype, "getEntriesGenerator").mockImplementation(async function* () {
      yield entry;
      return true;
    });
    try {
      const result = await expectCode(new File([new Uint8Array(1)], "cleanup.zip"), code, overrides);
      expect(result).toMatchObject({ error: { entry: "a.json" } });
    } finally { spy.mockRestore(); }
  });
  it("rejects encrypted metadata before extracting", async () => {
    const bytes = await zipFixture([["a.json", fixture]]);
    const view = new DataView(bytes.buffer);
    view.setUint16(6, view.getUint16(6, true) | 1, true);
    for (let index = 0; index < bytes.length - 46; index += 1) {
      if (view.getUint32(index, true) === 0x02014b50) { view.setUint16(index + 8, view.getUint16(index + 8, true) | 1, true); break; }
    }
    await expectCode(new File([bytes], "encrypted.zip"), "unsupported-archive-entry");
  });
  it("checks CRC even for ignored content", async () => {
    const bytes = await zipFixture([["notes.txt", "ordinary text"]]);
    const copy = new Uint8Array(bytes);
    const view = new DataView(copy.buffer);
    copy[30 + view.getUint16(26, true) + view.getUint16(28, true)]! ^= 1;
    await expectCode(new File([copy], "bad-crc.zip"), "corrupt-zip");
  });
  it("reports the entry for malformed JSON and never returns partial success", async () => {
    const result = await expectCode(await zipFile([["a.json", fixture], ["bad.json", "{"]]), "malformed-json");
    expect(result).toMatchObject({ error: { entry: "bad.json" } });
  });
  it("applies one parsed-node budget across all JSON entries", async () => {
    await expectCode(await zipFile([["a.json", '[{"x":1}]'], ["b.json", '[{"x":2}]']]), "json-resource-limit", { jsonNodes: 5 });
  });
  it("is deterministic for a multi-entry ZIP", async () => {
    const input = await zipFile([["a.json", fixture], ["b.json", "[]"]]);
    expect(await ingestFile(input)).toEqual(await ingestFile(input));
  });
  it("accepts valid unsorted central-directory entries without changing their order", async () => {
    const bytes = await zipFixture([["a.json", '[{"a":1}]'], ["b.json", '[{"b":2}]']]);
    const view = new DataView(bytes.buffer);
    const directory = view.getUint32(bytes.length - 22 + 16, true);
    const firstLength = 46 + view.getUint16(directory + 28, true) + view.getUint16(directory + 30, true) + view.getUint16(directory + 32, true);
    const secondStart = directory + firstLength;
    const secondLength = 46 + view.getUint16(secondStart + 28, true) + view.getUint16(secondStart + 30, true) + view.getUint16(secondStart + 32, true);
    const first = bytes.slice(directory, secondStart);
    const second = bytes.slice(secondStart, secondStart + secondLength);
    bytes.set(second, directory);
    bytes.set(first, directory + secondLength);
    const result = await ingestFile(new File([bytes], "unsorted.zip"));
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.sources.map((source) => source.candidate.source.originalFilename)).toEqual(["b.json", "a.json"]);
  });
});
