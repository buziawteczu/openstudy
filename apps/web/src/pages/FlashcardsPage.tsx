import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { StudySet } from "@openstudy/schema";
import { createFlashcardSession, eligibleQuestions, rateFlashcard, revealFlashcard, summarizeFlashcardSession,
  updateFlashcardProgress, type FlashcardProgress, type FlashcardRating, type FlashcardSession } from "@openstudy/study";
import { Link, useParams } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";
import { flashcardProgressStorage } from "../storage/flashcard-progress.js";

import { StudyProgress, StudySessionFrame, StudySetup } from "../components/study/StudyPresentation.js";

type LoadState = { kind: "loading" } | { kind: "ready"; studySet: StudySet; progress: FlashcardProgress[]; focusHeading: boolean } |
  { kind: "missing" | "incompatible" | "error" } | { kind: "progress-error" };

function ignoreRepeatedNavigationClick(event: MouseEvent<HTMLAnchorElement>) {
  // Advancing a card can move a link beneath the second click of a rating double-click.
  if (event.detail > 1) event.preventDefault();
}

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
  const content = <>
    {!session ? <StudySetup mode="Flashcards" title={studySet.title} headingRef={setupHeading} prefix="flashcard"
      description="Recall the answer, reveal it, then rate yourself. Cards appear in their saved order."
      categories={studySet.categories} categoryId={categoryId} onCategoryChange={(event) => {
        const next = event.currentTarget.value || null;
        setCategoryId(next); setCount(String(Math.min(20, eligibleQuestions(studySet, next).length)));
      }} count={count} onCountChange={(event) => setCount(event.currentTarget.value)} countInvalid={!countValid}
      available={eligible.length} unit="card"
      countHelp={eligible.length === 0 ? "No cards belong to this topic. Choose another topic." : `Choose a whole number from 1 to ${eligible.length}.`}
      countError={!countValid && eligible.length > 0 ? "Enter a valid card count to start." : undefined}>
      <button type="button" className="button button-primary" disabled={!countValid} onClick={start}>Start flashcards</button>
    </StudySetup> : session.completed ? <section className="session-summary">
      <h1 ref={completeHeading} tabIndex={-1}>Session complete</h1>
      <p className="summary-total">{summary!.reviewed} {summary!.reviewed === 1 ? "card" : "cards"} reviewed</p>
      <div className="summary-counts"><p>{summary!.knowIt} Know it</p><p>{summary!.again} Again</p></div>
      <div className="summary-actions">
        <button type="button" className="button button-primary" onClick={(event) => {
          if (event.detail <= 1) { commit(null); focus("setup"); }
        }}>Study again</button>
        <Link className="button button-quiet" to={path} onClick={ignoreRepeatedNavigationClick}>Back to study set</Link>
      </div>
    </section> : question ? <section aria-labelledby="flashcard-question-title" key={question.id}>
      <StudyProgress id="flashcard-position" label="Card" current={session.currentIndex + 1} total={session.questionIds.length} />
      <div className="study-card flashcard-card">
        <h1 id="flashcard-question-title" ref={questionHeading} tabIndex={-1} aria-describedby="flashcard-position">{question.prompt}</h1>
        {!session.revealed ? <button key="reveal" type="button" className="button button-primary study-primary" onClick={(event) => {
          if (event.detail <= 1) reveal(question.id);
        }}>Reveal answer</button> : <div key="revealed" className="flashcard-reveal">
          <div className="answer-block answer-block-correct">
            <h2 ref={answerHeading} tabIndex={-1} aria-describedby={`flashcard-answer${question.explanation ? " flashcard-explanation" : ""}`}>Correct answer</h2>
            <p id="flashcard-answer" className="revealed-answer">{question.choices.find((choice) => choice.id === question.correctChoiceId)!.text}</p>
          </div>
          {question.explanation && <p id="flashcard-explanation" className="answer-explanation">{question.explanation}</p>}
          <div className="rating-actions">
            <button type="button" className="button button-secondary" disabled={ratingGuard.current} onClick={(event) => {
              if (event.detail <= 1) rate(question.id, "again");
            }}>Again</button>
            <button type="button" className="button button-primary" disabled={ratingGuard.current} onClick={(event) => {
              if (event.detail <= 1) rate(question.id, "know-it");
            }}>Know it</button>
          </div>
        </div>}
      </div>
    </section> : <p role="alert">This card is no longer available. Return to the study set.</p>}
    {warning && <p role="alert" className="feedback feedback-warning session-warning">Your flashcard progress couldn't be saved on this device. You can continue, but these results may be lost.</p>}
    {!session && <div className="mt-6"><Link className="button button-quiet" to={path} onClick={ignoreRepeatedNavigationClick}>Back to study set</Link></div>}
  </>;
  return <>
    <title>Flashcards · {studySet.title} | OpenStudy</title>
    {session ? <StudySessionFrame mode="Flashcards" title={studySet.title} exit={<Link className="button button-quiet" to={path}
      onClick={ignoreRepeatedNavigationClick}>Exit session</Link>}>{content}</StudySessionFrame> : content}
  </>;
}
