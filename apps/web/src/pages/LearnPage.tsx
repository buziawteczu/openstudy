import { useEffect, useRef, useState } from "react";
import type { StudySet } from "@openstudy/schema";
import {
  checkAnswer, clearAnswer, continueLearnSession, createLearnSession, eligibleQuestions, selectAnswer,
  updateUserProgress, type LearnSession, type UserProgress,
} from "@openstudy/study";
import { Link, useParams } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";
import { userProgressStorage } from "../storage/user-progress.js";

import { AnswerOption, StudyProgress, StudySessionFrame, StudySetup } from "../components/study/StudyPresentation.js";

type LoadState = { kind: "loading" } | { kind: "ready"; studySet: StudySet; progress: UserProgress[]; focusHeading: boolean } |
  { kind: "missing" | "incompatible" | "error" } | { kind: "progress-error"; studySet: StudySet };

export function LearnPage() {
  const { id } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const routeHeading = useRef<HTMLHeadingElement>(null);
  const retryFocus = useRef(false);
  useEffect(() => {
    let active = true;
    const focusFromRetry = retryFocus.current;
    retryFocus.current = false;
    setState({ kind: "loading" });
    if (focusFromRetry) requestAnimationFrame(() => { if (active) routeHeading.current?.focus(); });
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
      const progress = await userProgressStorage.getStudySetProgress(id);
      if (active) setState(progress.success ? { kind: "ready", studySet: loaded.value, progress: progress.value,
        focusHeading: focusFromRetry || document.activeElement === routeHeading.current }
        : { kind: "progress-error", studySet: loaded.value });
    })();
    return () => { active = false; };
  }, [id, reload]);

  if (state.kind === "ready") return <LearnExperience studySet={state.studySet} initialProgress={state.progress} focusHeading={state.focusHeading} />;
  const title = state.kind === "missing" ? "Study set not found" : state.kind === "incompatible" ? "This study set can't be opened" : "Learn";
  return <>
    <title>Learn | OpenStudy</title>
    <p className="eyebrow">Learn</p>
    <h1 ref={routeHeading} tabIndex={-1}>{title}</h1>
    {state.kind === "loading" && <p role="status" className="mt-5">Opening study set…</p>}
    {state.kind === "missing" && <p className="mt-4 text-muted">It may have been deleted from this device.</p>}
    {state.kind === "incompatible" && <p className="mt-4 text-muted">Its saved data could not be validated.</p>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-danger">OpenStudy couldn't read this study set on this device.</p>}
    {state.kind === "progress-error" && <>
      <p role="alert" className="mt-4 text-danger">OpenStudy couldn't safely load learning progress for this study set. No session has started.</p>
      <button type="button" className="action" onClick={() => { retryFocus.current = true; setReload((value) => value + 1); }}>Retry loading progress</button>
    </>}
    {state.kind !== "loading" && <div className="mt-6"><Link className="back-link" to={id ? `/study-sets/${encodeURIComponent(id)}` : "/"}>← Back to study set</Link></div>}
  </>;
}

function LearnExperience({ studySet, initialProgress, focusHeading }: { studySet: StudySet; initialProgress: UserProgress[]; focusHeading: boolean }) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [count, setCount] = useState(String(Math.min(20, studySet.questions.length)));
  const [session, setSession] = useState<LearnSession | null>(null);
  const [warning, setWarning] = useState(false);
  const progress = useRef(new Map(initialProgress.map((entry) => [entry.questionId, entry])));
  const persistedAttempts = useRef(new Map(initialProgress.map((entry) => [entry.questionId, entry.attempts])));
  const unsaved = useRef(new Set<string>());
  const conflicted = useRef(new Set<string>());
  const writeQueue = useRef(Promise.resolve());
  const setupHeading = useRef<HTMLHeadingElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const completeHeading = useRef<HTMLHeadingElement>(null);
  const eligible = eligibleQuestions(studySet, categoryId);
  const numericCount = Number(count);
  const countValid = /^[0-9]+$/.test(count) && Number.isSafeInteger(numericCount) && numericCount >= 1 && numericCount <= eligible.length;
  const path = `/study-sets/${encodeURIComponent(studySet.id)}`;
  const question = session && !session.completed ? studySet.questions.find((item) => item.id === session.questionIds[session.currentIndex]) : undefined;

  useEffect(() => { if (focusHeading) setupHeading.current?.focus(); }, [focusHeading]);

  function changeCategory(value: string) {
    const next = value || null;
    setCategoryId(next);
    const available = eligibleQuestions(studySet, next).length;
    if (Number(count) > available || !countValid) setCount(String(available));
  }
  function start() {
    const result = createLearnSession(studySet, { categoryId, count: numericCount });
    if (!result.success) return;
    setSession(result.value);
    requestAnimationFrame(() => questionHeading.current?.focus());
  }
  function choose(choiceId: string) {
    if (!session) return;
    const result = selectAnswer(session, studySet, choiceId);
    if (result.success) setSession(result.value);
  }
  function clear() {
    if (!session) return;
    const result = clearAnswer(session);
    if (result.success) setSession(result.value);
  }
  function check() {
    if (!session) return;
    const result = checkAnswer(session, studySet);
    if (!result.success) return;
    setSession(result.value.session);
    const checked = result.value.checked;
    const previous = progress.current.get(checked.questionId);
    const updated = updateUserProgress(previous, checked);
    if (!updated.success) setWarning(true);
    else {
      progress.current.set(checked.questionId, updated.progress);
      unsaved.current.add(checked.questionId);
      const snapshot = updated.progress;
      writeQueue.current = writeQueue.current.then(async () => {
        if (conflicted.current.has(checked.questionId)) return;
        let saved: Awaited<ReturnType<typeof userProgressStorage.saveQuestionProgress>>;
        try { saved = await userProgressStorage.saveQuestionProgress({ progress: snapshot,
          expectedAttempts: persistedAttempts.current.get(checked.questionId) ?? 0 }); }
        catch { saved = { success: false, error: "write-failed" }; }
        if (!saved.success && saved.error === "progress-conflict") conflicted.current.add(checked.questionId);
        if (saved.success) persistedAttempts.current.set(checked.questionId, snapshot.attempts);
        if (saved.success && progress.current.get(checked.questionId)?.attempts === snapshot.attempts) {
          unsaved.current.delete(checked.questionId);
          if (unsaved.current.size === 0) setWarning(false);
        } else if (!saved.success) setWarning(true);
      });
    }
    if (result.value.session.resolved) requestAnimationFrame(() => feedbackHeading.current?.focus());
  }
  function continueSession() {
    if (!session) return;
    const result = continueLearnSession(session);
    if (!result.success) return;
    setSession(result.value);
    requestAnimationFrame(() => result.value.completed ? completeHeading.current?.focus() : questionHeading.current?.focus());
  }
  function studyAgain() {
    setSession(null);
    requestAnimationFrame(() => setupHeading.current?.focus());
  }

  const content = <>
    {!session ? <StudySetup mode="Learn" title={studySet.title} headingRef={setupHeading} prefix="learn"
      description="Choose an answer and retry until you get it. Questions appear in their saved order."
      categories={studySet.categories} categoryId={categoryId} onCategoryChange={(event) => changeCategory(event.currentTarget.value)}
      count={count} onCountChange={(event) => setCount(event.currentTarget.value)} countInvalid={count !== "" && !countValid}
      available={eligible.length} unit="question" countHelp={`Choose a whole number from 1 to ${eligible.length}.`}
      countError={!countValid && eligible.length > 0 ? "Enter a valid question count to start." : undefined}>
      {eligible.length === 0 && <p className="text-muted">No questions belong to this topic. Choose another topic.</p>}
      <button type="button" className="button button-primary" disabled={!countValid} onClick={start}>Start learning</button>
    </StudySetup> : session.completed ? <section className="session-summary">
      <h1 ref={completeHeading} tabIndex={-1}>Session complete</h1>
      <p className="summary-total">{session.results.length} {session.results.length === 1 ? "question" : "questions"} completed</p>
      <div className="summary-counts">
        <p>{session.results.filter((result) => result.firstAttemptCorrect).length} correct on the first try</p>
        <p>{session.results.filter((result) => !result.firstAttemptCorrect).length} needed another attempt</p>
      </div>
      <div className="summary-actions">
        <button type="button" className="button button-primary" onClick={studyAgain}>Study again</button>
        <Link className="button button-quiet" to={path}>Back to study set</Link>
      </div>
    </section> : question ? <section aria-labelledby="learn-question-title">
      <StudyProgress id="learn-position" label="Question" current={session.currentIndex + 1} total={session.questionIds.length} />
      <div className="study-card">
        <h1 id="learn-question-title" ref={questionHeading} tabIndex={-1} aria-describedby="learn-position">{question.prompt}</h1>
        <fieldset className="study-answers" disabled={session.resolved}>
          <legend>Choose one answer</legend>
          <div className="answer-list">{question.choices.map((choice, index) => <AnswerOption key={choice.id}
            id={choice.id} text={choice.text} index={index} name="learn-answer" checked={session.selectedChoiceId === choice.id}
            onChange={() => choose(choice.id)} feedback={session.selectedChoiceId === choice.id && session.feedback !== "none" ? session.feedback : undefined} />)}</div>
        </fieldset>
        {!session.resolved && session.selectedChoiceId && <button type="button" className="button button-quiet clear-answer" onClick={clear}>Clear answer</button>}
        <div role="status" aria-live="polite" aria-atomic="true" className="study-feedback">
          {session.feedback === "wrong" && <p className="feedback feedback-error">Not quite. Try another answer.</p>}
          {session.feedback === "correct" && <div className="feedback feedback-success">
            <h2 ref={feedbackHeading} tabIndex={-1}>Correct.</h2>
            {question.explanation && <p className="mt-3">{question.explanation}</p>}
          </div>}
        </div>
        {session.resolved ? <button type="button" className="button button-primary study-primary" onClick={(event) => {
          // The button is reused after Check answer; ignore the rest of that click sequence.
          if (event.detail <= 1) continueSession();
        }}>Continue</button>
          : <button type="button" className="button button-primary study-primary" disabled={!session.selectedChoiceId} onClick={(event) => {
            if (event.detail <= 1) check();
          }}>Check answer</button>}
      </div>
    </section> : <p role="alert">This question is no longer available. Return to the study set.</p>}
    {warning && <p role="alert" className="feedback feedback-warning session-warning">Your learning progress couldn't be saved on this device. You can continue, but these results may be lost.</p>}
    {!session && <div className="mt-6"><Link className="button button-quiet" to={path}>← Back to study set</Link></div>}
  </>;
  return <>
    <title>Learn · {studySet.title} | OpenStudy</title>
    {session ? <StudySessionFrame mode="Learn" title={studySet.title} exit={<Link className="button button-quiet" to={path}
      onClick={(event) => { if (event.detail > 1) event.preventDefault(); }}>Exit session</Link>}>{content}</StudySessionFrame> : content}
  </>;
}
