import { migrateStudySet, StudySetSchema, type StudySet } from "@openstudy/schema";
import { DATABASE_NAME, libraryDatabase, requestValue, transactionDone } from "./database.js";

export { DATABASE_NAME, DATABASE_VERSION } from "./database.js";

export type LibrarySummary = {
  id: string;
  title: string;
  revision: number;
  questionCount: number;
  categoryCount: number;
  sourceCount: number;
};

export type StorageErrorCode = "storage-unavailable" | "validation-failed" | "read-failed" |
  "write-failed" | "delete-failed" | "not-found" | "incompatible-study-set" |
  "revision-conflict" | "identity-mismatch" | "question-not-found" | "incompatible-progress" | "progress-conflict";
export type StorageResult<T> = { success: true; value: T } | { success: false; error: StorageErrorCode };

const success = <T>(value: T): StorageResult<T> => ({ success: true, value });
const failure = <T>(error: StorageErrorCode): StorageResult<T> => ({ success: false, error });

function summaryOf(studySet: StudySet): LibrarySummary {
  return {
    id: studySet.id, title: studySet.title, revision: studySet.revision,
    questionCount: studySet.questions.length, categoryCount: studySet.categories.length,
    sourceCount: studySet.sources.length,
  };
}

function isSummary(value: unknown): value is LibrarySummary {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.title === "string" &&
    ["revision", "questionCount", "categoryCount", "sourceCount"].every(
      (key) => typeof item[key] === "number" && Number.isSafeInteger(item[key]) && (item[key] as number) >= 0,
    );
}

/** A single browser storage boundary; test instances may use isolated database names. */
export function createStudySetStorage(name = DATABASE_NAME) {
  const connection = libraryDatabase(name);
  const database = connection.open;

  async function saveStudySet(input: unknown): Promise<StorageResult<LibrarySummary>> {
    const parsed = StudySetSchema.safeParse(input);
    if (!parsed.success) return failure("validation-failed");
    let db: IDBDatabase;
    try { db = await database(); } catch { return failure("storage-unavailable"); }
    const summary = summaryOf(parsed.data);
    try {
      const tx = db.transaction(["studySets", "libraryEntries"], "readwrite");
      const done = transactionDone(tx);
      try {
        tx.objectStore("studySets").put(parsed.data);
        tx.objectStore("libraryEntries").put(summary);
      } catch { tx.abort(); await done.catch(() => undefined); return failure("write-failed"); }
      await done;
      return success(summary);
    } catch { return failure("write-failed"); }
  }

  async function listStudySets(): Promise<StorageResult<LibrarySummary[]>> {
    let db: IDBDatabase;
    try { db = await database(); } catch { return failure("storage-unavailable"); }
    try {
      const values = await requestValue<unknown[]>(db.transaction("libraryEntries").objectStore("libraryEntries").getAll());
      if (!values.every(isSummary)) return failure("read-failed");
      return success(values.sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    } catch { return failure("read-failed"); }
  }

  async function getStudySet(id: string): Promise<StorageResult<StudySet>> {
    let db: IDBDatabase;
    try { db = await database(); } catch { return failure("storage-unavailable"); }
    let stored: unknown;
    try { stored = await requestValue<unknown>(db.transaction("studySets").objectStore("studySets").get(id)); }
    catch { return failure("read-failed"); }
    if (stored === undefined) return failure("not-found");
    const migrated = migrateStudySet(stored);
    if (!migrated.success || migrated.studySet.id !== id) return failure("incompatible-study-set");
    return success(migrated.studySet);
  }

  /** Compare and replace within one readwrite transaction across both stores. */
  async function replaceStudySet(input: {
    expectedId: string; expectedRevision: number; nextStudySet: unknown;
  }): Promise<StorageResult<LibrarySummary>> {
    const { expectedId, expectedRevision } = input;
    const parsed = StudySetSchema.safeParse(input.nextStudySet);
    if (!parsed.success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 ||
      !Number.isSafeInteger(expectedRevision + 1)) return failure("validation-failed");
    if (parsed.data.id !== expectedId) return failure("identity-mismatch");
    if (parsed.data.revision !== expectedRevision + 1) return failure("validation-failed");
    let db: IDBDatabase;
    try { db = await database(); } catch { return failure("storage-unavailable"); }
    let tx: IDBTransaction;
    try { tx = db.transaction(["studySets", "libraryEntries"], "readwrite"); }
    catch { return failure("write-failed"); }
    const completed = transactionDone(tx).then(() => true, () => false);
    async function abort(error: StorageErrorCode): Promise<StorageResult<LibrarySummary>> {
      try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
      await completed;
      return failure(error);
    }
    try {
      const stored: unknown = await requestValue(tx.objectStore("studySets").get(expectedId));
      if (stored === undefined) return abort("not-found");
      const current = migrateStudySet(stored);
      if (!current.success || current.studySet.id !== expectedId) return abort("incompatible-study-set");
      if (current.studySet.revision !== expectedRevision) return abort("revision-conflict");
      const summary = summaryOf(parsed.data);
      tx.objectStore("studySets").put(parsed.data);
      tx.objectStore("libraryEntries").put(summary);
      return (await completed) ? success(summary) : failure("write-failed");
    } catch { return abort("write-failed"); }
  }

  async function deleteStudySet(id: string): Promise<StorageResult<void>> {
    let db: IDBDatabase;
    try { db = await database(); } catch { return failure("storage-unavailable"); }
    try {
      const tx = db.transaction(["studySets", "libraryEntries", "userProgress", "flashcardProgress"], "readwrite");
      const done = transactionDone(tx);
      try {
        tx.objectStore("studySets").delete(id);
        tx.objectStore("libraryEntries").delete(id);
        for (const storeName of ["userProgress", "flashcardProgress"]) {
          const progress = tx.objectStore(storeName);
          const keys = await requestValue(progress.index("studySetId").getAllKeys(id));
          for (const key of keys) progress.delete(key);
        }
      } catch { tx.abort(); await done.catch(() => undefined); return failure("delete-failed"); }
      await done;
      return success(undefined);
    } catch { return failure("delete-failed"); }
  }

  const close = connection.close;

  return { saveStudySet, listStudySets, getStudySet, replaceStudySet, deleteStudySet, close };
}

export const studySetStorage = createStudySetStorage();
