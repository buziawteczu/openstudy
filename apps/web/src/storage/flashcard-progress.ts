import { migrateStudySet, PortableIdSchema } from "@openstudy/schema";
import { FlashcardProgressSchema, type FlashcardProgress } from "@openstudy/study";
import { DATABASE_NAME, libraryDatabase, requestValue, transactionDone } from "./database.js";
import type { StorageErrorCode, StorageResult } from "./study-sets.js";

const success = <T>(value: T): StorageResult<T> => ({ success: true, value });
const failure = <T>(error: StorageErrorCode): StorageResult<T> => ({ success: false, error });

export function createFlashcardProgressStorage(name = DATABASE_NAME) {
  const connection = libraryDatabase(name);
  async function getStudySetFlashcardProgress(studySetId: string): Promise<StorageResult<FlashcardProgress[]>> {
    if (!PortableIdSchema.safeParse(studySetId).success) return failure("validation-failed");
    let db: IDBDatabase;
    try { db = await connection.open(); } catch { return failure("storage-unavailable"); }
    try {
      const values = await requestValue<unknown[]>(db.transaction("flashcardProgress").objectStore("flashcardProgress").index("studySetId").getAll(studySetId));
      const parsed = values.map((value) => FlashcardProgressSchema.safeParse(value));
      if (parsed.some((entry) => !entry.success || entry.data.studySetId !== studySetId)) return failure("incompatible-progress");
      return success(parsed.map((entry) => entry.data!));
    } catch { return failure("read-failed"); }
  }

  async function saveFlashcardProgress(input: { progress: unknown; expectedReviews: number }): Promise<StorageResult<FlashcardProgress>> {
    const parsed = FlashcardProgressSchema.safeParse(input.progress);
    if (!parsed.success || !Number.isSafeInteger(input.expectedReviews) || input.expectedReviews < 0 ||
      parsed.data.reviews <= input.expectedReviews) return failure("validation-failed");
    const progress = parsed.data;
    let db: IDBDatabase;
    try { db = await connection.open(); } catch { return failure("storage-unavailable"); }
    let tx: IDBTransaction;
    try { tx = db.transaction(["studySets", "flashcardProgress"], "readwrite"); } catch { return failure("write-failed"); }
    const done = transactionDone(tx).then(() => true, () => false);
    async function abort(error: StorageErrorCode): Promise<StorageResult<FlashcardProgress>> {
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
      const store = tx.objectStore("flashcardProgress");
      const existing: unknown = await requestValue(store.get([progress.studySetId, progress.questionId]));
      const prior = existing === undefined ? undefined : FlashcardProgressSchema.safeParse(existing);
      if (prior && (!prior.success || prior.data.studySetId !== progress.studySetId || prior.data.questionId !== progress.questionId))
        return abort("incompatible-progress");
      if ((prior?.data.reviews ?? 0) !== input.expectedReviews) return abort("progress-conflict");
      store.put(progress);
      return await done ? success(progress) : failure("write-failed");
    } catch { return abort("write-failed"); }
  }
  return { getStudySetFlashcardProgress, saveFlashcardProgress, close: connection.close };
}

export const flashcardProgressStorage = createFlashcardProgressStorage();
