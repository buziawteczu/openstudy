import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { StudySet } from "@openstudy/schema";
import { createTestSession, eligibleQuestions, selectTestAnswer, clearTestAnswer, nextTestQuestion,
  previousTestQuestion, submitTest, summarizeTest, testMistakes, type TestSession, type TestResult } from "@openstudy/study";
import { Link, useParams } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";

type LoadState = { kind: "loading" } | { kind: "ready"; studySet: StudySet; focusHeading: boolean } |
  { kind: "missing" | "incompatible" | "error" };
type ExperienceState = { view: "setup" } | { view: "active"; session: TestSession; confirming: boolean } |
  { view: "results"; session: TestSession; result: TestResult } |
  { view: "review"; session: TestSession; result: TestResult; mistakeIndex: number };

// Layout changes can put a different control beneath a second pointer click.
function ignoreRepeatedNavigation(event: MouseEvent<HTMLAnchorElement>) {
  if (event.detail > 1) event.preventDefault();
}

export function TestPage() {
  const { id } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    if (!id) { setState({ kind: "missing" }); return; }
    void (async () => {
      const loaded = await studySetStorage.getStudySet(id);
      if (!active) return;
      if (loaded.success) {
        setState({ kind: "ready", studySet: loaded.value, focusHeading: document.activeElement === heading.current });
        return;
      }
      if (loaded.error !== "not-found") {
        setState({ kind: loaded.error === "incompatible-study-set" ? "incompatible" : "error" }); return;
      }
      const summaries = await studySetStorage.listStudySets();
      if (active) setState({ kind: summaries.success && summaries.value.some((entry) => entry.id === id) ?
        "incompatible" : summaries.success ? "missing" : "error" });
    })();
    return () => { active = false; };
  }, [id]);
  if (state.kind === "ready") return <TestExperience key={state.studySet.id} studySet={state.studySet} focusHeading={state.focusHeading} />;
  return <>
    <title>Test | OpenStudy</title>
    <p className="eyebrow">Test</p>
    <h1 ref={heading} tabIndex={-1}>{state.kind === "missing" ? "Study set not found" : state.kind === "incompatible" ? "This study set can't be opened" : "Test"}</h1>
    {state.kind === "loading" && <p role="status" className="mt-5">Opening study set…</p>}
    {state.kind === "missing" && <p className="mt-4 text-muted">It may have been deleted from this device.</p>}
    {state.kind === "incompatible" && <p className="mt-4 text-muted">Its saved data could not be validated.</p>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-danger">OpenStudy couldn't read this study set on this device.</p>}
    {state.kind !== "loading" && <div className="mt-6"><Link className="back-link" onClick={ignoreRepeatedNavigation}
      to={id ? `/study-sets/${encodeURIComponent(id)}` : "/"}>Back to study set</Link></div>}
  </>;
}

function TestExperience({ studySet, focusHeading }: { studySet: StudySet; focusHeading: boolean }) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [count, setCount] = useState(String(Math.min(20, studySet.questions.length)));
  const [shuffle, setShuffle] = useState(true);
  const [state, setState] = useState<ExperienceState>({ view: "setup" });
  const latest = useRef(state);
  const transitionGuard = useRef(false);
  const mounted = useRef(true);
  const [startError, setStartError] = useState(false);
  const setupHeading = useRef<HTMLHeadingElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const mistakeHeading = useRef<HTMLHeadingElement>(null);
  const keepWorking = useRef<HTMLButtonElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  const targets = { setup: setupHeading, question: questionHeading, results: resultHeading,
    mistake: mistakeHeading, confirmation: keepWorking, finish: finishButton };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (focusHeading) setupHeading.current?.focus(); }, [focusHeading]);
  useEffect(() => { transitionGuard.current = false; }, [state]);
  const eligible = eligibleQuestions(studySet, categoryId);
  const numericCount = Number(count);
  const countValid = /^[0-9]+$/.test(count) && Number.isSafeInteger(numericCount) && numericCount >= 1 && numericCount <= eligible.length;
  const path = `/study-sets/${encodeURIComponent(studySet.id)}`;
  const session = state.view === "setup" ? null : state.session;
  const question = state.view === "active" ? studySet.questions.find((item) => item.id === state.session.questionIds[state.session.currentIndex])! : undefined;
  const selection = state.view === "active" ? state.session.answers[state.session.currentIndex]!.selectedChoiceId : null;
  const result = state.view === "results" || state.view === "review" ? state.result : null;
  const summary = result ? summarizeTest(result) : null;
  const mistakes = result ? testMistakes(result) : [];
  const mistake = state.view === "review" ? mistakes[state.mistakeIndex]! : undefined;
  const reviewQuestion = mistake ? studySet.questions.find((item) => item.id === mistake.questionId)! : undefined;

  function commit(next: ExperienceState) { latest.current = next; setState(next); }
  function transition(next: ExperienceState, target: keyof typeof targets) {
    if (transitionGuard.current || latest.current !== state) return;
    transitionGuard.current = true;
    commit(next);
    requestAnimationFrame(() => { if (mounted.current && latest.current === next) targets[target].current?.focus(); });
  }
  function start() {
    if (state.view !== "setup" || !countValid || latest.current !== state || transitionGuard.current) return;
    const created = createTestSession(studySet, { categoryId, count: numericCount, shuffle }, Math.random);
    if (created.success) { setStartError(false); transition({ view: "active", session: created.value, confirming: false }, "question"); }
    else setStartError(true);
  }
  function select(choiceId: string | null) {
    if (state.view !== "active" || state.confirming || latest.current !== state || transitionGuard.current) return;
    const selected = choiceId === null ? clearTestAnswer(state.session) : selectTestAnswer(state.session, studySet, choiceId);
    if (selected.success) commit({ ...state, session: selected.value });
  }
  function navigate(direction: "previous" | "next") {
    if (state.view !== "active" || state.confirming) return;
    const moved = direction === "next" ? nextTestQuestion(state.session) : previousTestQuestion(state.session);
    if (moved.success) transition({ ...state, session: moved.value }, "question");
  }
  function finish(confirmed = false) {
    if (state.view !== "active" || (confirmed ? !state.confirming : state.confirming) ||
      latest.current !== state || transitionGuard.current) return;
    const submitted = submitTest(state.session, studySet, { allowUnanswered: confirmed });
    if (submitted.success) transition({ view: "results", ...submitted.value }, "results");
    else if (submitted.error === "unanswered-questions") transition({ ...state, confirming: true }, "confirmation");
  }
  function reviewMove(direction: number) {
    if (state.view !== "review") return;
    const index = state.mistakeIndex + direction;
    if (index >= 0 && index < mistakes.length) transition({ ...state, mistakeIndex: index }, "mistake");
  }

  return <>
    <title>Test · {studySet.title} | OpenStudy</title>
    <p className="eyebrow">Test</p>
    {state.view === "setup" ? <>
      <h1 ref={setupHeading} tabIndex={-1}>Test “{studySet.title}”</h1>
      <p className="mt-3 text-muted">Choose your questions. Results appear only after you submit the whole test.</p>
      <div className="mt-8 max-w-xl">
        <label htmlFor="test-category" className="font-semibold">Topic / category</label>
        <select id="test-category" className="mapping-control" value={categoryId ?? ""} onChange={(event) => {
          const next = event.currentTarget.value || null;
          const available = eligibleQuestions(studySet, next).length;
          setCategoryId(next);
          if (!countValid) setCount(String(Math.min(20, available)));
          else if (numericCount > available) setCount(String(available));
        }}>
          <option value="">All topics</option>
          {studySet.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
        <p className="mt-2 text-small text-muted">{eligible.length} {eligible.length === 1 ? "question" : "questions"} available</p>
        <label htmlFor="test-count" className="mt-6 block font-semibold">Questions</label>
        <input id="test-count" className="mapping-control" type="number" min={1} max={eligible.length} step={1} value={count}
          aria-invalid={!countValid || undefined} aria-describedby="test-count-help" onChange={(event) => setCount(event.currentTarget.value)} />
        <p id="test-count-help" className="mt-2 text-small text-muted">{eligible.length === 0 ? "No questions belong to this topic. Choose another topic." : `Choose a whole number from 1 to ${eligible.length}.`}</p>
        {!countValid && eligible.length > 0 && <p className="mt-2 text-danger">Enter a valid question count to start.</p>}
        <label className="mt-5 flex min-h-12 cursor-pointer items-center gap-3">
          <input className="size-5 shrink-0 accent-accent" type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.currentTarget.checked)} />Shuffle questions
        </label>
        <button type="button" className="action" disabled={!countValid} onClick={(event) => { if (event.detail <= 1) start(); }}>Start test</button>
        {startError && <p role="alert" className="mt-3 text-danger">OpenStudy couldn't start this test. Please try again.</p>}
      </div>
    </> : state.view === "active" && question ? <section className="max-w-xl [overflow-wrap:anywhere]" aria-labelledby="test-question-title" key={question.id}>
      <p id="test-position" className="text-small font-semibold text-muted">Question {state.session.currentIndex + 1} of {state.session.questionIds.length}</p>
      <div className="mt-5 min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-8">
        <h1 id="test-question-title" ref={questionHeading} tabIndex={-1} aria-describedby="test-position">{question.prompt}</h1>
        <fieldset className="mt-6 min-w-0" disabled={state.confirming}>
          <legend className="font-semibold">Choose one answer</legend>
          <div className="mt-3 grid gap-3">{question.choices.map((choice) => <label key={choice.id}
            className="flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-small border border-border px-4 py-3">
            <input type="radio" name="test-answer" className="mt-1.5 size-5 shrink-0 accent-accent" value={choice.id}
              checked={selection === choice.id} onChange={() => select(choice.id)} />
            <span className="min-w-0">{choice.text}</span>
          </label>)}</div>
        </fieldset>
        {selection && <button type="button" className="review-link mt-3" disabled={state.confirming}
          onClick={(event) => { if (event.detail <= 1) select(null); }}>Clear answer</button>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="action mt-0 px-3" disabled={state.confirming || state.session.currentIndex === 0}
            onClick={(event) => { if (event.detail <= 1) navigate("previous"); }}>Previous</button>
          {state.session.currentIndex + 1 < state.session.questionIds.length ?
            <button key="next" type="button" className="action mt-0 px-3" disabled={state.confirming}
              onClick={(event) => { if (event.detail <= 1) navigate("next"); }}>Next</button> :
            <button key="finish" ref={finishButton} type="button" className="action mt-0 px-3" disabled={state.confirming}
              onClick={(event) => { if (event.detail <= 1) finish(); }}>Finish test</button>}
        </div>
      </div>
      {state.confirming && <div role="group" aria-labelledby="test-confirmation-title" aria-describedby="test-confirmation-help"
        className="mt-6 rounded-surface border border-border bg-surface p-5">
        <h2 id="test-confirmation-title">{state.session.answers.filter((answer) => answer.selectedChoiceId === null).length} {state.session.answers.filter((answer) => answer.selectedChoiceId === null).length === 1 ? "question is" : "questions are"} unanswered.</h2>
        <p id="test-confirmation-help" className="mt-3 text-muted">Unanswered questions receive no points. Submit this test?</p>
        <div className="flex flex-wrap items-center gap-x-5">
          <button ref={keepWorking} type="button" className="back-link" onClick={(event) => {
            if (event.detail <= 1) transition({ ...state, confirming: false }, "finish");
          }}>Keep working</button>
          <button type="button" className="action" onClick={(event) => { if (event.detail <= 1) finish(true); }}>Submit test</button>
        </div>
      </div>}
    </section> : state.view === "results" && summary ? <>
      <h1 ref={resultHeading} tabIndex={-1}>Test complete</h1>
      <p className="mt-5 text-3xl font-semibold">{summary.correct} / {summary.total}</p>
      <p className="mt-2 text-xl">{summary.percentage}%</p>
      <p className="mt-5">{summary.correct} correct</p><p>{summary.incorrect} incorrect</p><p>{summary.unanswered} unanswered</p>
      <p className="mt-4 text-small text-muted">These results are temporary and aren't saved on this device.</p>
      {mistakes.length === 0 && <p className="mt-4">No mistakes to review.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-x-5">
        {mistakes.length > 0 && <button type="button" className="action" onClick={(event) => {
          if (event.detail <= 1) transition({ ...state, view: "review", mistakeIndex: 0 }, "mistake");
        }}>Review mistakes</button>}
        <button type="button" className="action" onClick={(event) => {
          if (event.detail <= 1) transition({ view: "setup" }, "setup");
        }}>Take another test</button>
        <Link className="back-link" onClick={ignoreRepeatedNavigation} to={path}>Back to study set</Link>
      </div>
    </> : state.view === "review" && mistake && reviewQuestion ? <section className="max-w-xl [overflow-wrap:anywhere]" aria-labelledby="test-mistake-title" key={mistake.questionId}>
      <p id="test-mistake-position" className="text-small font-semibold text-muted">Mistake {state.mistakeIndex + 1} of {mistakes.length}</p>
      <div className="mt-5 min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-8">
        <h1 id="test-mistake-title" ref={mistakeHeading} tabIndex={-1} aria-describedby="test-mistake-position">{reviewQuestion.prompt}</h1>
        <h2 className="mt-6">Your answer</h2>
        <p className="mt-3">{mistake.selectedChoiceId === null ? "No answer" : reviewQuestion.choices.find((choice) => choice.id === mistake.selectedChoiceId)!.text}</p>
        <h2 className="mt-6">Correct answer</h2>
        <p className="mt-3 font-semibold">{reviewQuestion.choices.find((choice) => choice.id === reviewQuestion.correctChoiceId)!.text}</p>
        {reviewQuestion.explanation && <><h2 className="mt-6">Explanation</h2><p className="mt-3 text-muted">{reviewQuestion.explanation}</p></>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="action mt-0 px-3" disabled={state.mistakeIndex === 0} onClick={(event) => { if (event.detail <= 1) reviewMove(-1); }}>Previous mistake</button>
          <button type="button" className="action mt-0 px-3" disabled={state.mistakeIndex + 1 === mistakes.length} onClick={(event) => { if (event.detail <= 1) reviewMove(1); }}>Next mistake</button>
        </div>
      </div>
      <button type="button" className="back-link" onClick={(event) => {
        if (event.detail <= 1) transition({ view: "results", session: state.session, result: state.result }, "results");
      }}>Back to results</button>
      <div><Link className="back-link" onClick={ignoreRepeatedNavigation} to={path}>Back to study set</Link></div>
    </section> : null}
    {(state.view === "setup" || state.view === "active") && <div className="mt-8"><Link className="back-link" onClick={ignoreRepeatedNavigation} to={path}>{session ? "Exit session" : "Back to study set"}</Link></div>}
  </>;
}
