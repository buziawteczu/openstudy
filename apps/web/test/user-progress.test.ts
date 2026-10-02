import fixture from "../../../packages/schema/test/fixtures/1.0.0/minimal.json";
import { StudySetSchema } from "@openstudy/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_VERSION, createStudySetStorage } from "../src/storage/study-sets.js";
import { createUserProgressStorage } from "../src/storage/user-progress.js";

let name: string;
let sets: ReturnType<typeof createStudySetStorage>;
let progress: ReturnType<typeof createUserProgressStorage>;
const studySet = () => StudySetSchema.parse(structuredClone(fixture));
const record = (studySetId = fixture.id, questionId = fixture.questions[0]!.id) => ({
  studySetId, questionId, attempts: 1, firstAttemptCorrect: false, eventualCorrect: false, needsReview: true,
});
const save = (next: unknown, expectedAttempts = 0) =>
  progress.saveQuestionProgress({ progress: next, expectedAttempts });
function openDatabase(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function createV1Fixture() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("studySets", { keyPath: "id" });
      request.result.createObjectStore("libraryEntries", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["studySets", "libraryEntries"], "readwrite");
      tx.objectStore("studySets").put(studySet());
      tx.objectStore("libraryEntries").put({ id: fixture.id, title: fixture.title, revision: 1,
        questionCount: 1, categoryCount: 0, sourceCount: 1 });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

beforeEach(() => {
  name = `openstudy-progress-${crypto.randomUUID()}`;
  sets = createStudySetStorage(name);
  progress = createUserProgressStorage(name);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await sets.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe("UserProgress storage", () => {
  it("upgrades a real layout v1 database without losing saved content or summaries", async () => {
    await createV1Fixture();
    expect(await sets.getStudySet(fixture.id)).toEqual({ success: true, value: studySet() });
    expect((await sets.listStudySets()).success).toBe(true);
    const db = await openDatabase();
    expect(db.version).toBe(DATABASE_VERSION);
    expect(db.objectStoreNames.contains("studySets")).toBe(true);
    expect(db.objectStoreNames.contains("libraryEntries")).toBe(true);
    expect(db.objectStoreNames.contains("userProgress")).toBe(true);
    expect(db.transaction("userProgress").objectStore("userProgress").indexNames.contains("studySetId")).toBe(true);
    expect(await progress.getStudySetProgress(fixture.id)).toEqual({ success: true, value: [] });
    db.close();
  });

  it("validates and persists multiple records by canonical composite identity across reopen", async () => {
    const set = studySet();
    set.questions.push({ ...structuredClone(set.questions[0]!), id: "question.second" });
    expect((await sets.saveStudySet(set)).success).toBe(true);
    const first = record();
    const second = record(set.id, "question.second");
    const before = structuredClone(first);
    expect(await save(first)).toEqual({ success: true, value: first });
    expect((await save(second)).success).toBe(true);
    expect(first).toEqual(before);
    expect(await progress.getStudySetProgress(set.id)).toEqual({ success: true, value: [second, first] });
    await progress.close();
    expect(await createUserProgressStorage(name).getStudySetProgress(set.id)).toEqual({ success: true, value: [second, first] });
  });

  it("accepts a first record and a sequential update, then rejects a stale snapshot", async () => {
    const set = studySet();
    expect((await sets.saveStudySet(set)).success).toBe(true);
    const first = record();
    const second = { ...first, attempts: 2, eventualCorrect: true };
    expect(await save(first, 0)).toEqual({ success: true, value: first });
    expect(await save(second, 1)).toEqual({ success: true, value: second });
    expect(await save({ ...second, eventualCorrect: false }, 1)).toEqual({ success: false, error: "progress-conflict" });
    expect(await progress.getStudySetProgress(set.id)).toEqual({ success: true, value: [second] });
    expect(await sets.getStudySet(set.id)).toEqual({ success: true, value: set });
  });

  it("prevents two storage callers with the same baseline from overwriting each other", async () => {
    const set = studySet();
    expect((await sets.saveStudySet(set)).success).toBe(true);
    expect((await save(record(), 0)).success).toBe(true);
    const firstWriter = createUserProgressStorage(name);
    const secondWriter = createUserProgressStorage(name);
    const first = { ...record(), attempts: 2, eventualCorrect: true };
    const stale = { ...record(), attempts: 2, eventualCorrect: false };
    const firstWrite = firstWriter.saveQuestionProgress({ progress: first, expectedAttempts: 1 });
    const staleWrite = secondWriter.saveQuestionProgress({ progress: stale, expectedAttempts: 1 });
    expect(await firstWrite).toEqual({ success: true, value: first });
    expect(await staleWrite).toEqual({ success: false, error: "progress-conflict" });
    expect(await progress.getStudySetProgress(set.id)).toEqual({ success: true, value: [first] });
    expect(await sets.getStudySet(set.id)).toEqual({ success: true, value: set });
  });

  it("rejects malformed progress, nonexistent sets and nonexistent questions", async () => {
    expect(await save({ ...record(), attempts: 0 })).toEqual({ success: false, error: "validation-failed" });
    expect(await save(record(), -1)).toEqual({ success: false, error: "validation-failed" });
    expect(await save({ ...record(), attempts: 2 }, 0)).toEqual({ success: false, error: "validation-failed" });
    expect(await save(record())).toEqual({ success: false, error: "not-found" });
    expect((await sets.saveStudySet(studySet())).success).toBe(true);
    expect(await save(record(fixture.id, "missing.question"))).toEqual({ success: false, error: "question-not-found" });
    expect(await progress.getStudySetProgress(fixture.id)).toEqual({ success: true, value: [] });
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("userProgress", "readwrite");
      tx.objectStore("userProgress").put({ ...record(), attempts: 0 });
      tx.oncomplete = () => resolve();
    });
    expect(await progress.getStudySetProgress(fixture.id)).toEqual({ success: false, error: "incompatible-progress" });
    expect(await save(record())).toEqual({ success: false, error: "incompatible-progress" });
    db.close();
  });

  it("validates the stored StudySet before writing and rolls back a failed progress write", async () => {
    const set = studySet();
    expect((await sets.saveStudySet(set)).success).toBe(true);
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("studySets", "readwrite");
      tx.objectStore("studySets").put({ id: set.id, schemaVersion: "2.0.0" });
      tx.oncomplete = () => resolve();
    });
    expect(await save(record())).toEqual({ success: false, error: "incompatible-study-set" });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("studySets", "readwrite");
      tx.objectStore("studySets").put(set);
      tx.oncomplete = () => resolve();
    });
    db.close();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "userProgress") throw new Error("simulated progress write failure");
      return put.call(this, value, key);
    });
    expect(await save(record())).toEqual({ success: false, error: "write-failed" });
    vi.restoreAllMocks();
    expect(await progress.getStudySetProgress(set.id)).toEqual({ success: true, value: [] });
  });

  it("deletes a StudySet and only its progress in one transaction", async () => {
    const first = studySet();
    const second = { ...studySet(), id: "set.second" };
    expect((await sets.saveStudySet(first)).success).toBe(true);
    expect((await sets.saveStudySet(second)).success).toBe(true);
    expect((await save(record())).success).toBe(true);
    expect((await save(record(second.id))).success).toBe(true);
    expect((await sets.deleteStudySet(first.id)).success).toBe(true);
    expect(await sets.getStudySet(first.id)).toEqual({ success: false, error: "not-found" });
    expect(await progress.getStudySetProgress(first.id)).toEqual({ success: true, value: [] });
    expect(await progress.getStudySetProgress(second.id)).toEqual({ success: true, value: [record(second.id)] });
  });

  it("rolls back content, summary and progress when progress deletion fails", async () => {
    const set = studySet();
    expect((await sets.saveStudySet(set)).success).toBe(true);
    expect((await save(record())).success).toBe(true);
    const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === "userProgress") throw new Error("simulated progress delete failure");
      return original.call(this, key);
    });
    expect(await sets.deleteStudySet(set.id)).toEqual({ success: false, error: "delete-failed" });
    vi.restoreAllMocks();
    expect(await sets.getStudySet(set.id)).toEqual({ success: true, value: set });
    expect((await sets.listStudySets()).success).toBe(true);
    expect(await progress.getStudySetProgress(set.id)).toEqual({ success: true, value: [record()] });
  });

  it("preserves progress through Add Material replacement and leaves new questions without it", async () => {
    const existing = studySet();
    expect((await sets.saveStudySet(existing)).success).toBe(true);
    expect((await save(record())).success).toBe(true);
    const next = studySet(); next.revision = 2;
    next.questions.push({ ...structuredClone(next.questions[0]!), id: "question.added" });
    expect((await sets.replaceStudySet({ expectedId: existing.id, expectedRevision: 1, nextStudySet: next })).success).toBe(true);
    expect(await progress.getStudySetProgress(existing.id)).toEqual({ success: true, value: [record()] });
    expect((await sets.getStudySet(existing.id)).success).toBe(true);
  });
});
