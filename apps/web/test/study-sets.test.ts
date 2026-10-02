import fixture from "../../../packages/schema/test/fixtures/1.0.0/minimal.json";
import { StudySetSchema } from "@openstudy/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_VERSION, createStudySetStorage } from "../src/storage/study-sets.js";

let name: string;
let storage: ReturnType<typeof createStudySetStorage>;
const studySet = () => StudySetSchema.parse(structuredClone(fixture));
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function writeRaw(db: IDBDatabase, value: unknown, id = fixture.id): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("studySets", "readwrite");
    tx.objectStore("studySets").put({ ...(value as object), id });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

beforeEach(() => {
  name = `openstudy-test-${crypto.randomUUID()}`;
  storage = createStudySetStorage(name);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await storage.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe("local StudySet storage", () => {
  it("replaces content and summary together at the expected revision", async () => {
    const original = studySet();
    const next = studySet();
    next.revision = 2;
    next.questions.push({ ...structuredClone(next.questions[0]!), id: "another.question" });
    expect((await storage.saveStudySet(original)).success).toBe(true);
    const result = await storage.replaceStudySet({ expectedId: original.id, expectedRevision: 1, nextStudySet: next });
    expect(result).toEqual({ success: true, value: {
      id: original.id, title: original.title, revision: 2, questionCount: 2, categoryCount: 0, sourceCount: 1,
    } });
    expect(await storage.getStudySet(original.id)).toEqual({ success: true, value: next });
    expect(await storage.listStudySets()).toEqual({ success: true, value: [result.success ? result.value : undefined] });
  });

  it("rejects stale revisions and preserves the current content and summary", async () => {
    const original = studySet();
    expect((await storage.saveStudySet(original)).success).toBe(true);
    const next = studySet(); next.revision = 2;
    expect((await storage.replaceStudySet({ expectedId: original.id, expectedRevision: 1, nextStudySet: next })).success).toBe(true);
    const other = structuredClone(next); other.title = "Stale change";
    expect(await storage.replaceStudySet({ expectedId: original.id, expectedRevision: 1, nextStudySet: other }))
      .toEqual({ success: false, error: "revision-conflict" });
    expect(await storage.getStudySet(original.id)).toEqual({ success: true, value: next });
    const list = await storage.listStudySets();
    expect(list.success && list.value[0]!.revision).toBe(2);
  });

  it("rejects invalid identity and revisions before writing", async () => {
    const original = studySet();
    expect((await storage.saveStudySet(original)).success).toBe(true);
    const next = studySet(); next.revision = 2;
    expect(await storage.replaceStudySet({ expectedId: "other", expectedRevision: 1, nextStudySet: next }))
      .toEqual({ success: false, error: "identity-mismatch" });
    expect(await storage.replaceStudySet({ expectedId: original.id, expectedRevision: 2, nextStudySet: next }))
      .toEqual({ success: false, error: "validation-failed" });
    expect(await storage.replaceStudySet({ expectedId: original.id, expectedRevision: 1, nextStudySet: { ...next, questions: [] } }))
      .toEqual({ success: false, error: "validation-failed" });
    expect(await storage.getStudySet(original.id)).toEqual({ success: true, value: original });
  });

  it("rolls back both stores when replacement summary writing fails", async () => {
    const original = studySet();
    expect((await storage.saveStudySet(original)).success).toBe(true);
    const next = studySet(); next.revision = 2;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "libraryEntries") throw new Error("simulated write failure");
      return put.call(this, value, key);
    });
    expect(await storage.replaceStudySet({ expectedId: original.id, expectedRevision: 1, nextStudySet: next }))
      .toEqual({ success: false, error: "write-failed" });
    vi.restoreAllMocks();
    expect(await storage.getStudySet(original.id)).toEqual({ success: true, value: original });
    const list = await storage.listStudySets();
    expect(list.success && list.value[0]!.revision).toBe(1);
  });

  it("does not replace missing or incompatible stored data", async () => {
    const next = studySet(); next.revision = 2;
    expect(await storage.replaceStudySet({ expectedId: next.id, expectedRevision: 1, nextStudySet: next }))
      .toEqual({ success: false, error: "not-found" });
    expect((await storage.saveStudySet(studySet())).success).toBe(true);
    const db = await openDatabase();
    await writeRaw(db, { ...studySet(), schemaVersion: "2.0.0" });
    expect(await storage.replaceStudySet({ expectedId: next.id, expectedRevision: 1, nextStudySet: next }))
      .toEqual({ success: false, error: "incompatible-study-set" });
    db.close();
  });
  it("saves, lists and reopens canonical content with provenance", async () => {
    const input = studySet();
    input.questions[0]!.provenance = [{ sourceId: input.sources[0]!.id, locator: "record:1" }];
    const before = structuredClone(input);
    expect(await storage.saveStudySet(input)).toEqual({ success: true, value: {
      id: input.id, title: input.title, revision: 1, questionCount: 1, categoryCount: 0, sourceCount: 1,
    } });
    expect(input).toEqual(before);
    expect(await storage.getStudySet(input.id)).toEqual({ success: true, value: before });
    expect((await storage.listStudySets()).success).toBe(true);
  });

  it("keeps duplicate titles, orders deterministically, and replaces the same ID", async () => {
    const first = studySet();
    const second = { ...studySet(), id: "os:second" };
    expect((await storage.saveStudySet(first)).success).toBe(true);
    expect((await storage.saveStudySet(second)).success).toBe(true);
    first.title = "Updated";
    expect((await storage.saveStudySet(first)).success).toBe(true);
    const list = await storage.listStudySets();
    expect(list.success && list.value.map(({ id, title }) => [id, title])).toEqual([
      [second.id, second.title], [first.id, first.title],
    ]);
  });

  it("rejects incomplete content before writing and deletes both stores", async () => {
    const invalid = { ...studySet(), questions: [] };
    expect(await storage.saveStudySet(invalid)).toEqual({ success: false, error: "validation-failed" });
    expect(await storage.listStudySets()).toEqual({ success: true, value: [] });
    expect((await storage.saveStudySet(studySet())).success).toBe(true);
    expect(await storage.deleteStudySet(fixture.id)).toEqual({ success: true, value: undefined });
    expect(await storage.getStudySet(fixture.id)).toEqual({ success: false, error: "not-found" });
    expect(await storage.listStudySets()).toEqual({ success: true, value: [] });
  });

  it("uses the migration and final validation boundary without writing back", async () => {
    expect((await storage.saveStudySet(studySet())).success).toBe(true);
    const db = await openDatabase();
    expect(db.version).toBe(DATABASE_VERSION);
    const writes = vi.spyOn(IDBObjectStore.prototype, "put");
    expect((await storage.getStudySet(fixture.id)).success).toBe(true);
    const { schemaVersion: _omitted, ...missingVersion } = studySet();
    for (const value of [
      { ...studySet(), schemaVersion: "2.0.0" },
      missingVersion,
      { ...studySet(), questions: [] },
    ]) {
      await writeRaw(db, value);
      expect(await storage.getStudySet(fixture.id)).toEqual({ success: false, error: "incompatible-study-set" });
    }
    expect(writes).toHaveBeenCalledTimes(3); // Only the explicit raw test writes.
    db.close();
  });

  it("round-trips a large StudySet without loading questions for summaries", async () => {
    const large = studySet();
    large.questions = Array.from({ length: 1000 }, (_, index) => ({ ...studySet().questions[0]!, id: `os:q:${index}` }));
    expect((await storage.saveStudySet(large)).success).toBe(true);
    const listed = await storage.listStudySets();
    expect(listed.success && listed.value[0]!.questionCount).toBe(1000);
    expect((await storage.getStudySet(large.id)).success).toBe(true);
  });

  it("aborts both writes if the summary write throws", async () => {
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "libraryEntries") throw new Error("simulated write failure");
      return original.call(this, value, key);
    });
    expect(await storage.saveStudySet(studySet())).toEqual({ success: false, error: "write-failed" });
    vi.restoreAllMocks();
    expect(await storage.listStudySets()).toEqual({ success: true, value: [] });
    expect(await storage.getStudySet(fixture.id)).toEqual({ success: false, error: "not-found" });
  });
  it("aborts both deletions if the summary delete throws", async () => {
    expect((await storage.saveStudySet(studySet())).success).toBe(true);
    const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === "libraryEntries") throw new Error("simulated delete failure");
      return original.call(this, key);
    });
    expect(await storage.deleteStudySet(fixture.id)).toEqual({ success: false, error: "delete-failed" });
    vi.restoreAllMocks();
    expect((await storage.getStudySet(fixture.id)).success).toBe(true);
    const listed = await storage.listStudySets();
    expect(listed.success && listed.value).toHaveLength(1);
  });
  it("returns a controlled error when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      expect(await storage.saveStudySet(studySet())).toEqual({ success: false, error: "storage-unavailable" });
      expect(await storage.listStudySets()).toEqual({ success: false, error: "storage-unavailable" });
    } finally { vi.unstubAllGlobals(); }
  });
});
