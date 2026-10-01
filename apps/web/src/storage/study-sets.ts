import { migrateStudySet, StudySetSchema, type StudySet } from "@openstudy/schema";

export const DATABASE_NAME = "openstudy-library";
// IndexedDB layout version. This is independent of StudySet.schemaVersion.
export const DATABASE_VERSION = 1;

export type LibrarySummary = {
  id: string;
  title: string;
  revision: number;
  questionCount: number;
  categoryCount: number;
  sourceCount: number;
};

export type StorageErrorCode = "storage-unavailable" | "validation-failed" | "read-failed" |
  "write-failed" | "delete-failed" | "not-found" | "incompatible-study-set";
export type StorageResult<T> = { success: true; value: T } | { success: false; error: StorageErrorCode };

const success = <T>(value: T): StorageResult<T> => ({ success: true, value });
const failure = <T>(error: StorageErrorCode): StorageResult<T> => ({ success: false, error });

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

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
  let databasePromise: Promise<IDBDatabase> | undefined;
  function database(): Promise<IDBDatabase> {
    if (!databasePromise) {
      databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
        let request: IDBOpenDBRequest;
        try { request = indexedDB.open(name, DATABASE_VERSION); }
        catch (error) { reject(error); return; }
        let blocked = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("studySets")) db.createObjectStore("studySets", { keyPath: "id" });
          if (!db.objectStoreNames.contains("libraryEntries")) db.createObjectStore("libraryEntries", { keyPath: "id" });
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); databasePromise = undefined; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { blocked = true; reject(new Error("IndexedDB blocked")); };
      }).catch((error: unknown) => { databasePromise = undefined; throw error; });
    }
    return databasePromise!;
  }

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

  async function deleteStudySet(id: string): Promise<StorageResult<void>> {
    let db: IDBDatabase;
    try { db = await database(); } catch { return failure("storage-unavailable"); }
    try {
      const tx = db.transaction(["studySets", "libraryEntries"], "readwrite");
      const done = transactionDone(tx);
      try {
        tx.objectStore("studySets").delete(id);
        tx.objectStore("libraryEntries").delete(id);
      } catch { tx.abort(); await done.catch(() => undefined); return failure("delete-failed"); }
      await done;
      return success(undefined);
    } catch { return failure("delete-failed"); }
  }

  async function close(): Promise<void> {
    if (!databasePromise) return;
    try { (await databasePromise).close(); } catch { /* Opening failed. */ }
    databasePromise = undefined;
  }

  return { saveStudySet, listStudySets, getStudySet, deleteStudySet, close };
}

export const studySetStorage = createStudySetStorage();
