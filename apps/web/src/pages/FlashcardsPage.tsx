import { useEffect, useRef, useState } from "react";
import type { StudySet } from "@openstudy/schema";
import { createFlashcardSession, eligibleQuestions, rateFlashcard, revealFlashcard, summarizeFlashcardSession,
  updateFlashcardProgress, type FlashcardProgress, type FlashcardRating, type FlashcardSession } from "@openstudy/study";
import { Link, useParams } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";
import { flashcardProgressStorage } from "../storage/flashcard-progress.js";

type LoadState = { kind: "loading" } | { kind: "ready"; studySet: StudySet; progress: FlashcardProgress[]; focusHeading: boolean } |
  { kind: "missing" | "incompatible" | "error" } | { kind: "progress-error" };

export function FlashcardsPage() {
  const { id } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const retryFocus = useRef(false);
  useEffect(() => {
    let active = true;
    const focusFromRetry = retryFocus.current;
    retryFocus.current = false;
    setState({ kind: "loading" });
    if (focusFromRetry) requestAnimationFrame(() => { if (active) heading.current?.focus(); });
    if (!id) { setState({ kind: "missing" }); return; }
    void (async () => {
      const loaded = await studySetStorage.getStudySet(id);
      if (!active) return;
      if (!loaded.success) {
        if (loaded.error !== "not-found") {
          setState({ kind: loaded.error === "incompatible-study-set" ? "incompatible" : "error" });
          return;
        }
        const summaries = await studySetStorage.listStudySets();
        if (active) setState({ kind: summaries.success && summaries.value.some((entry) => entry.id === id) ? "incompatible" : summaries.success ? "missing" : "error" });
        return;
      }
      const progress = await flashcardProgressStorage.getStudySetFlashcardProgress(id);
      if (active) setState(progress.success ? { kind: "ready", studySet: loaded.value, progress: progress.value,
        focusHeading: focusFromRetry || document.activeElement === heading.current } : { kind: "progress-error" });
    })();
    return () => { active = false; };
  }, [id, reload]);
  if (state.kind === "ready") return <FlashcardExperience key={state.studySet.id} studySet={state.studySet} initialProgress={state.progress} focusHeading={state.focusHeading} />;
  return <>
    <title>Flashcards | OpenStudy</title>
    <p className="eyebrow">Flashcards</p>
    <h1 ref={heading} tabIndex={-1}>{state.kind === "missing" ? "Study set not found" : state.kind === "incompatible" ? "This study set can't be opened" : "Flashcards"}</h1>
    {state.kind === "loading" && <p role="status" className="mt-5">Opening study set…</p>}
    {state.kind === "missing" && <p className="mt-4 text-muted">It may have been deleted from this device.</p>}
    {state.kind === "incompatible" && <p className="mt-4 text-muted">Its saved data could not be validated.</p>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-danger">OpenStudy couldn't read this study set on this device.</p>}
    {state.kind === "progress-error" && <>
      <p role="alert" className="mt-4 text-danger">OpenStudy couldn't safely load flashcard progress for this study set. No session has started.</p>
      <button type="button" className="action" onClick={() => { retryFocus.current = true; setReload((value) => value + 1); }}>Retry loading progress</button>
    </>}
    {state.kind !== "loading" && <div className="mt-6"><Link className="back-link" to={id ? `/study-sets/${encodeURIComponent(id)}` : "/"}>Back to study set</Link></div>}
  </>;
}

function FlashcardExperience({ studySet, initialProgress, focusHeading }: { studySet: StudySet; initialProgress: FlashcardProgress[]; focusHeading: boolean }) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [count, setCount] = useState(String(Math.min(20, studySet.questions.length)));
  const [session, setSession] = useState<FlashcardSession | null>(null);
  const currentSession = useRef<FlashcardSession | null>(null);
  const ratingGuard = useRef(false);
  const [warning, setWarning] = useState(false);
  const progress = useRef(new Map(initialProgress.map((entry) => [entry.questionId, entry])));
  const persistedReviews = useRef(new Map(initialProgress.map((entry) => [entry.questionId, entry.reviews])));
  const unsaved = useRef(new Set<string>());
  const conflicted = useRef(new Set<string>());
  const writeQueue = useRef(Promise.resolve());
  const setupHeading = useRef<HTMLHeadingElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const completeHeading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (focusHeading) setupHeading.current?.focus(); }, [focusHeading]);
  useEffect(() => { ratingGuard.current = false; }, [session]);
  const eligible = eligibleQuestions(studySet, categoryId);
  const numericCount = Number(count);
  const countValid = /^[0-9]+$/.test(count) && Number.isSafeInteger(numericCount) && numericCount >= 1 && numericCount <= eligible.length;
  const path = `/study-sets/${encodeURIComponent(studySet.id)}`;
  const question = session && !session.completed ? studySet.questions.find((item) => item.id === session.questionIds[session.currentIndex]) : undefined;
  const summary = session ? summarizeFlashcardSession(session) : undefined;
  function commit(next: FlashcardSession | null) { currentSession.current = next; setSession(next); }
  function focus(target: "question" | "answer" | "complete" | "setup") {
    requestAnimationFrame(() => {
      if (!mounted.current) return;
      ({ question: questionHeading, answer: answerHeading, complete: completeHeading, setup: setupHeading })[target].current?.focus();
    });
  }
  function start() {
    if (!countValid || currentSession.current) return;
    const result = createFlashcardSession(studySet, { categoryId, count: numericCount });
    if (result.success) { commit(result.value); focus("question"); }
  }
  function reveal(questionId: string) {
    const latest = currentSession.current;
    if (!latest || latest.questionIds[latest.currentIndex] !== questionId) return;
    const result = revealFlashcard(latest);
    if (result.success) { commit(result.value); focus("answer"); }
  }
  function rate(questionId: string, rating: FlashcardRating) {
    const latest = currentSession.current;
    if (ratingGuard.current || !latest || latest.questionIds[latest.currentIndex] !== questionId) return;
    const result = rateFlashcard(latest, rating);
    if (!result.success) return;
    ratingGuard.current = true;
    commit(result.value.session);
    focus(result.value.session.completed ? "complete" : "question");
    const updated = updateFlashcardProgress(progress.current.get(questionId), result.value.review);
    if (!updated.success) { unsaved.current.add(questionId); setWarning(true); return; }
    const snapshot = updated.progress;
    progress.current.set(questionId, snapshot);
    unsaved.current.add(questionId);
    writeQueue.current = writeQueue.current.then(async () => {
      if (conflicted.current.has(questionId)) return;
      let saved: Awaited<ReturnType<typeof flashcardProgressStorage.saveFlashcardProgress>>;
      try { saved = await flashcardProgressStorage.saveFlashcardProgress({ progress: snapshot,
        expectedReviews: persistedReviews.current.get(questionId) ?? 0 }); }
      catch { saved = { success: false, error: "write-failed" }; }
      if (!saved.success && saved.error === "progress-conflict") conflicted.current.add(questionId);
      if (saved.success) {
        persistedReviews.current.set(questionId, snapshot.reviews);
        if (progress.current.get(questionId)?.reviews === snapshot.reviews) unsaved.current.delete(questionId);
      }
      if (mounted.current) setWarning(unsaved.current.size > 0);
    });
  }
  return <>
    <title>Flashcards · {studySet.title} | OpenStudy</title>
    <p className="eyebrow">Flashcards</p>
    {!session ? <>
      <h1 ref={setupHeading} tabIndex={-1}>Flashcards “{studySet.title}”</h1>
      <p className="mt-3 text-muted">Recall the answer, reveal it, then choose Again or Know it. Cards appear in their saved order.</p>
      <div className="mt-8 max-w-xl">
        <label htmlFor="flashcard-category" className="font-semibold">Topic / category</label>
        <select id="flashcard-category" className="mapping-control" value={categoryId ?? ""} onChange={(event) => {
          const next = event.currentTarget.value || null;
          setCategoryId(next); setCount(String(Math.min(20, eligibleQuestions(studySet, next).length)));
        }}>
          <option value="">All topics</option>
          {studySet.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
        <p className="mt-2 text-small text-muted">{eligible.length} {eligible.length === 1 ? "card" : "cards"} available</p>
        <label htmlFor="flashcard-count" className="mt-6 block font-semibold">Cards</label>
        <input id="flashcard-count" className="mapping-control" type="number" min={1} max={eligible.length} step={1} value={count}
          aria-invalid={!countValid || undefined} aria-describedby="flashcard-count-help" onChange={(event) => setCount(event.currentTarget.value)} />
        <p id="flashcard-count-help" className="mt-2 text-small text-muted">{eligible.length === 0 ? "No cards belong to this topic. Choose another topic." : `Choose a whole number from 1 to ${eligible.length}.`}</p>
        {!countValid && eligible.length > 0 && <p className="mt-2 text-danger">Enter a valid card count to start.</p>}
        <button type="button" className="action" disabled={!countValid} onClick={start}>Start flashcards</button>
      </div>
    </> : session.completed ? <>
      <h1 ref={completeHeading} tabIndex={-1}>Session complete</h1>
      <p className="mt-5 text-lg">{summary!.reviewed} {summary!.reviewed === 1 ? "card" : "cards"} reviewed</p>
      <p className="mt-3">{summary!.knowIt} Know it</p>
      <p>{summary!.again} Again</p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5">
        <button type="button" className="action" onClick={() => { commit(null); focus("setup"); }}>Study again</button>
        <Link className="back-link" to={path}>Back to study set</Link>
      </div>
    </> : question ? <section className="max-w-xl" aria-labelledby="flashcard-question-title" key={question.id}>
      <p id="flashcard-position" className="text-small font-semibold text-muted">Card {session.currentIndex + 1} of {session.questionIds.length}</p>
      <div className="mt-5 min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-8 [overflow-wrap:anywhere]">
        <h1 id="flashcard-question-title" ref={questionHeading} tabIndex={-1} aria-describedby="flashcard-position">{question.prompt}</h1>
        {!session.revealed ? <button key="reveal" type="button" className="action" onClick={(event) => {
          if (event.detail <= 1) reveal(question.id);
        }}>Reveal answer</button> : <div key="revealed" className="mt-8">
          <h2 ref={answerHeading} tabIndex={-1} aria-describedby={`flashcard-answer${question.explanation ? " flashcard-explanation" : ""}`}>Correct answer</h2>
          <p id="flashcard-answer" className="mt-3 text-lg font-semibold">{question.choices.find((choice) => choice.id === question.correctChoiceId)!.text}</p>
          {question.explanation && <p id="flashcard-explanation" className="mt-4 text-muted">{question.explanation}</p>}
          <div className="mt-6 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,7rem),1fr))]">
            <button type="button" className="min-h-12 rounded-small border border-accent px-3 py-3 font-semibold text-accent" disabled={ratingGuard.current} onClick={(event) => {
              if (event.detail <= 1) rate(question.id, "again");
            }}>Again</button>
            <button type="button" className="min-h-12 rounded-small bg-accent px-3 py-3 font-semibold text-surface hover:bg-accent-hover" disabled={ratingGuard.current} onClick={(event) => {
              if (event.detail <= 1) rate(question.id, "know-it");
            }}>Know it</button>
          </div>
        </div>}
      </div>
    </section> : <p role="alert">This card is no longer available. Return to the study set.</p>}
    {warning && <p role="alert" className="mt-6 text-small text-danger">Your flashcard progress couldn't be saved on this device. You can continue, but these results may be lost.</p>}
    {(!session || !session.completed) && <div className="mt-8"><Link className="back-link" to={path}>{session ? "Exit session" : "Back to study set"}</Link></div>}
  </>;
}
