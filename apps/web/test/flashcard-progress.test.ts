import fixture from "../../../packages/schema/test/fixtures/1.0.0/minimal.json";
import { StudySetSchema } from "@openstudy/schema";
import { updateFlashcardProgress } from "@openstudy/study";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudySetStorage } from "../src/storage/study-sets.js";
import { createUserProgressStorage } from "../src/storage/user-progress.js";
import { createFlashcardProgressStorage } from "../src/storage/flashcard-progress.js";
import { requestValue, transactionDone } from "../src/storage/database.js";
import { applyStudySetMerge } from "../src/merge/study-sets.js";

let name: string;
let sets: ReturnType<typeof createStudySetStorage>;
let cards: ReturnType<typeof createFlashcardProgressStorage>;
let learn: ReturnType<typeof createUserProgressStorage>;
const set = () => StudySetSchema.parse(structuredClone(fixture));
const record = (studySetId = fixture.id, questionId = fixture.questions[0]!.id) => ({ studySetId, questionId,
  reviews: 1, againCount: 1, knowItCount: 0, lastRating: "again" as const });
const learnRecord = () => ({ studySetId: fixture.id, questionId: fixture.questions[0]!.id,
  attempts: 2, firstAttemptCorrect: false, eventualCorrect: true, needsReview: true });
function open(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function raw(storeName: string) {
  const db = await open();
  try { return await requestValue<unknown[]>(db.transaction(storeName).objectStore(storeName).getAll()); }
  finally { db.close(); }
}
async function put(storeName: string, value: unknown) {
  const db = await open();
  const tx = db.transaction(storeName, "readwrite"); const done = transactionDone(tx);
  tx.objectStore(storeName).put(value); await done; db.close();
}
async function legacy(version: 1 | 2) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("studySets", { keyPath: "id" });
      request.result.createObjectStore("libraryEntries", { keyPath: "id" });
      if (version === 2) request.result.createObjectStore("userProgress", { keyPath: ["studySetId", "questionId"] }).createIndex("studySetId", "studySetId");
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const stores = version === 2 ? ["studySets", "libraryEntries", "userProgress"] : ["studySets", "libraryEntries"];
  const tx = db.transaction(stores, "readwrite"); const done = transactionDone(tx);
  tx.objectStore("studySets").put(set());
  tx.objectStore("libraryEntries").put({ id: fixture.id, title: fixture.title, revision: 1, questionCount: 1, categoryCount: 0, sourceCount: 1 });
  if (version === 2) tx.objectStore("userProgress").put(learnRecord());
  await done; db.close();
}
beforeEach(() => { name = `openstudy-flashcards-${crypto.randomUUID()}`; sets = createStudySetStorage(name);
  cards = createFlashcardProgressStorage(name); learn = createUserProgressStorage(name); });
afterEach(async () => {
  vi.restoreAllMocks(); await sets.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
});

describe("FlashcardProgress storage", () => {
  it.each([1, 2] as const)("upgrades layout v%i to v3 preserving every existing record", async (version) => {
    await legacy(version);
    const beforeSets = await raw("studySets"); const beforeEntries = await raw("libraryEntries");
    const beforeLearn = version === 2 ? JSON.stringify(await raw("userProgress")) : "[]";
    expect(await cards.getStudySetFlashcardProgress(fixture.id)).toEqual({ success: true, value: [] });
    const db = await open(); expect(db.version).toBe(3);
    expect(Array.from(db.objectStoreNames)).toEqual(["flashcardProgress", "libraryEntries", "studySets", "userProgress"]);
    const store = db.transaction("flashcardProgress").objectStore("flashcardProgress");
    expect(store.keyPath).toEqual(["studySetId", "questionId"]); expect(store.index("studySetId").keyPath).toBe("studySetId"); db.close();
    expect(await raw("studySets")).toEqual(beforeSets); expect(await raw("libraryEntries")).toEqual(beforeEntries);
    expect(JSON.stringify(await raw("userProgress"))).toBe(beforeLearn);
  });
  it("saves first progress and normal updates across a DB reopen", async () => {
    await sets.saveStudySet(set()); const first = record();
    expect(await cards.saveFlashcardProgress({ progress: first, expectedReviews: 0 })).toEqual({ success: true, value: first });
    const result = updateFlashcardProgress(first, { studySetId: first.studySetId, questionId: first.questionId, rating: "know-it" });
    if (!result.success) throw new Error(result.error);
    expect(await cards.saveFlashcardProgress({ progress: result.progress, expectedReviews: 1 })).toEqual({ success: true, value: result.progress });
    await cards.close();
    expect(await createFlashcardProgressStorage(name).getStudySetFlashcardProgress(fixture.id)).toEqual({ success: true, value: [result.progress] });
  });
  it.each([{ ...record(), reviews: 0 }, { ...record(), reviews: 2 }, { ...record(), lastRating: "know-it" }, { ...record(), questionId: "bad id" }])("rejects malformed progress before writing: %j", async (progress) => {
    expect(await cards.saveFlashcardProgress({ progress, expectedReviews: 0 })).toEqual({ success: false, error: "validation-failed" });
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 1])("rejects invalid expectedReviews %s", async (expectedReviews) => {
    expect(await cards.saveFlashcardProgress({ progress: record(), expectedReviews })).toEqual({ success: false, error: "validation-failed" });
  });
  it("rejects nonexistent sets and questions", async () => {
    expect(await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 })).toEqual({ success: false, error: "not-found" });
    await sets.saveStudySet(set());
    expect(await cards.saveFlashcardProgress({ progress: record(fixture.id, "missing"), expectedReviews: 0 })).toEqual({ success: false, error: "question-not-found" });
  });
  it("refuses malformed saved progress on reads and writes", async () => {
    await sets.saveStudySet(set()); await put("flashcardProgress", { ...record(), reviews: 0 });
    expect(await cards.getStudySetFlashcardProgress(fixture.id)).toEqual({ success: false, error: "incompatible-progress" });
    expect(await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 })).toEqual({ success: false, error: "incompatible-progress" });
  });
  it("validates stored canonical content and rolls back failed writes", async () => {
    await sets.saveStudySet(set()); await put("studySets", { id: fixture.id, schemaVersion: "2.0.0" });
    expect(await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 })).toEqual({ success: false, error: "incompatible-study-set" });
    await put("studySets", set()); const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "flashcardProgress") throw new Error("write failure"); return original.call(this, value, key);
    });
    expect(await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 })).toEqual({ success: false, error: "write-failed" });
    vi.restoreAllMocks(); expect(await raw("flashcardProgress")).toEqual([]);
  });
  it("rejects stale writes and leaves durable progress unchanged", async () => {
    await sets.saveStudySet(set()); await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 });
    expect(await cards.saveFlashcardProgress({ progress: { ...record(), reviews: 2, againCount: 2 }, expectedReviews: 0 })).toEqual({ success: false, error: "progress-conflict" });
    expect(await raw("flashcardProgress")).toEqual([record()]);
  });
  it("two callers with one baseline cannot overwrite each other", async () => {
    await sets.saveStudySet(set()); await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 });
    const a = createFlashcardProgressStorage(name); const b = createFlashcardProgressStorage(name);
    const first = { ...record(), reviews: 2, againCount: 2 };
    const stale = { ...record(), reviews: 2, knowItCount: 1, lastRating: "know-it" };
    const outcomes = await Promise.all([a.saveFlashcardProgress({ progress: first, expectedReviews: 1 }), b.saveFlashcardProgress({ progress: stale, expectedReviews: 1 })]);
    expect(outcomes).toEqual([{ success: true, value: first }, { success: false, error: "progress-conflict" }]);
    expect(await raw("flashcardProgress")).toEqual([first]);
  });
  it("accepts safe cumulative recovery after a failed write", async () => {
    await sets.saveStudySet(set()); const recovered = { ...record(), reviews: 2, knowItCount: 1, lastRating: "know-it" };
    expect(await cards.saveFlashcardProgress({ progress: recovered, expectedReviews: 0 })).toEqual({ success: true, value: recovered });
  });
  it("Flashcard writes leave Learn and canonical records byte-for-byte unchanged", async () => {
    await sets.saveStudySet(set()); await learn.saveQuestionProgress({ progress: learnRecord(), expectedAttempts: 0 });
    const beforeLearn = JSON.stringify(await raw("userProgress")); const beforeSets = JSON.stringify(await raw("studySets"));
    await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 });
    await cards.saveFlashcardProgress({ progress: { ...record(), reviews: 2, knowItCount: 1, lastRating: "know-it" }, expectedReviews: 1 });
    expect(JSON.stringify(await raw("userProgress"))).toBe(beforeLearn); expect(JSON.stringify(await raw("studySets"))).toBe(beforeSets);
  });
  it("Add Material exact duplicates preserve both progress types and new questions have neither", async () => {
    const existing = set(); await sets.saveStudySet(existing);
    await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 }); await learn.saveQuestionProgress({ progress: learnRecord(), expectedAttempts: 0 });
    const incoming = set(); incoming.id = "set.incoming"; incoming.sources = [{ id: "source.new", label: "More" }];
    incoming.questions[0]!.id = "q.duplicate"; incoming.questions[0]!.provenance = [{ sourceId: "source.new" }];
    incoming.questions.push({ ...structuredClone(incoming.questions[0]!), id: "q.new", prompt: "A new question?",
      choices: [{ id: "new.yes", text: "Yes" }, { id: "new.no", text: "No" }], correctChoiceId: "new.yes" });
    const merged = applyStudySetMerge(existing, incoming); if (!merged.success) throw new Error(merged.error);
    expect(await sets.replaceStudySet({ expectedId: existing.id, expectedRevision: 1, nextStudySet: merged.studySet })).toMatchObject({ success: true });
    expect(await raw("flashcardProgress")).toEqual([record()]); expect(await raw("userProgress")).toEqual([learnRecord()]);
    expect(merged.studySet.questions.map((question) => question.id)).toEqual([existing.questions[0]!.id, "q.new"]);
  });
  it("deletion removes both progress types only for the selected StudySet", async () => {
    await sets.saveStudySet(set()); await sets.saveStudySet({ ...set(), id: "set.other" });
    await learn.saveQuestionProgress({ progress: learnRecord(), expectedAttempts: 0 });
    await learn.saveQuestionProgress({ progress: { ...learnRecord(), studySetId: "set.other" }, expectedAttempts: 0 });
    await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 });
    await cards.saveFlashcardProgress({ progress: record("set.other"), expectedReviews: 0 });
    expect(await sets.deleteStudySet(fixture.id)).toEqual({ success: true, value: undefined });
    expect(await raw("flashcardProgress")).toEqual([record("set.other")]);
    expect(await raw("userProgress")).toEqual([{ ...learnRecord(), studySetId: "set.other" }]);
    expect(await sets.getStudySet(fixture.id)).toEqual({ success: false, error: "not-found" });
  });
  it("failed Flashcard deletion rolls back all four stores", async () => {
    await sets.saveStudySet(set()); await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 });
    await learn.saveQuestionProgress({ progress: learnRecord(), expectedAttempts: 0 });
    const stores = ["studySets", "libraryEntries", "userProgress", "flashcardProgress"];
    const before = await Promise.all(stores.map(raw)); const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === "flashcardProgress") throw new Error("delete failure"); return original.call(this, key);
    });
    expect(await sets.deleteStudySet(fixture.id)).toEqual({ success: false, error: "delete-failed" }); vi.restoreAllMocks();
    expect(await Promise.all(stores.map(raw))).toEqual(before);
  });
  it("reports unavailable storage and invalid read identity", async () => {
    expect(await cards.getStudySetFlashcardProgress("bad id")).toEqual({ success: false, error: "validation-failed" });
    vi.spyOn(indexedDB, "open").mockImplementation(() => { throw new Error("unavailable"); });
    expect(await cards.getStudySetFlashcardProgress(fixture.id)).toEqual({ success: false, error: "storage-unavailable" });
    expect(await cards.saveFlashcardProgress({ progress: record(), expectedReviews: 0 })).toEqual({ success: false, error: "storage-unavailable" });
  });
});
