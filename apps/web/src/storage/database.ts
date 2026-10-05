export const DATABASE_NAME = "openstudy-library";
// IndexedDB layout version, independent of canonical StudySet.schemaVersion.
export const DATABASE_VERSION = 3;

export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

/** One connection per database name, shared by StudySet and progress storage. */
export function getLibraryDatabase(name = DATABASE_NAME) {
  let databasePromise: Promise<IDBDatabase> | undefined;
  function open(): Promise<IDBDatabase> {
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
          if (!db.objectStoreNames.contains("userProgress")) {
            const progress = db.createObjectStore("userProgress", { keyPath: ["studySetId", "questionId"] });
            progress.createIndex("studySetId", "studySetId");
          }
          if (!db.objectStoreNames.contains("flashcardProgress")) {
            const progress = db.createObjectStore("flashcardProgress", { keyPath: ["studySetId", "questionId"] });
            progress.createIndex("studySetId", "studySetId");
          }
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
    return databasePromise;
  }
  async function close(): Promise<void> {
    if (!databasePromise) return;
    try { (await databasePromise).close(); } catch { /* Opening failed. */ }
    databasePromise = undefined;
  }
  return { open, close };
}

const connections = new Map<string, ReturnType<typeof getLibraryDatabase>>();
export function libraryDatabase(name = DATABASE_NAME) {
  let connection = connections.get(name);
  if (!connection) { connection = getLibraryDatabase(name); connections.set(name, connection); }
  return connection;
}
