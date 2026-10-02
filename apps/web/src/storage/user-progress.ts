import { migrateStudySet, PortableIdSchema } from "@openstudy/schema";
import { UserProgressSchema, type UserProgress } from "@openstudy/study";
import { DATABASE_NAME, libraryDatabase, requestValue, transactionDone } from "./database.js";
import type { StorageErrorCode, StorageResult } from "./study-sets.js";

const success = <T>(value: T): StorageResult<T> => ({ success: true, value });
const failure = <T>(error: StorageErrorCode): StorageResult<T> => ({ success: false, error });

export function createUserProgressStorage(name = DATABASE_NAME) {
  const connection = libraryDatabase(name);

  async function getStudySetProgress(studySetId: string): Promise<StorageResult<UserProgress[]>> {
    if (!PortableIdSchema.safeParse(studySetId).success) return failure("validation-failed");
    let db: IDBDatabase;
    try { db = await connection.open(); } catch { return failure("storage-unavailable"); }
    try {
      const values = await requestValue<unknown[]>(db.transaction("userProgress").objectStore("userProgress").index("studySetId").getAll(studySetId));
      const parsed = values.map((value) => UserProgressSchema.safeParse(value));
      if (parsed.some((result) => !result.success || result.data.studySetId !== studySetId)) return failure("incompatible-progress");
      return success(parsed.map((result) => result.data!));
    } catch { return failure("read-failed"); }
  }

  async function saveQuestionProgress(input: unknown): Promise<StorageResult<UserProgress>> {
    const parsed = UserProgressSchema.safeParse(input);
    if (!parsed.success) return failure("validation-failed");
    const progress = parsed.data;
    let db: IDBDatabase;
    try { db = await connection.open(); } catch { return failure("storage-unavailable"); }
    let tx: IDBTransaction;
    try { tx = db.transaction(["studySets", "userProgress"], "readwrite"); }
    catch { return failure("write-failed"); }
    const done = transactionDone(tx).then(() => true, () => false);
    async function abort(error: StorageErrorCode): Promise<StorageResult<UserProgress>> {
      try { tx.abort(); } catch { /* Already aborted. */ }
      await done;
      return failure(error);
    }
    try {
      const stored: unknown = await requestValue(tx.objectStore("studySets").get(progress.studySetId));
      if (stored === undefined) return abort("not-found");
      const current = migrateStudySet(stored);
      if (!current.success || current.studySet.id !== progress.studySetId) return abort("incompatible-study-set");
      if (!current.studySet.questions.some((question) => question.id === progress.questionId)) return abort("question-not-found");
      tx.objectStore("userProgress").put(progress);
      return (await done) ? success(progress) : failure("write-failed");
    } catch { return abort("write-failed"); }
  }

  return { getStudySetProgress, saveQuestionProgress, close: connection.close };
}

export const userProgressStorage = createUserProgressStorage();
