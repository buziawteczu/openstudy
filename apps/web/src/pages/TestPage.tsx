import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { StudySet } from "@openstudy/schema";
import { createTestSession, eligibleQuestions, selectTestAnswer, clearTestAnswer, nextTestQuestion,
  previousTestQuestion, submitTest, summarizeTest, testMistakes, type TestSession, type TestResult } from "@openstudy/study";
import { Link, useParams } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";

import { AnswerOption, StudyProgress, StudySessionFrame, StudySetup } from "../components/study/StudyPresentation.js";

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

  const content = <>
    {state.view === "setup" ? <StudySetup mode="Test" title={studySet.title} headingRef={setupHeading} prefix="test"
      description="Answer first. See your results when you're done."
      categories={studySet.categories} categoryId={categoryId} onCategoryChange={(event) => {
        const next = event.currentTarget.value || null;
        const available = eligibleQuestions(studySet, next).length;
        setCategoryId(next);
        if (!countValid) setCount(String(Math.min(20, available)));
        else if (numericCount > available) setCount(String(available));
      }} count={count} onCountChange={(event) => setCount(event.currentTarget.value)} countInvalid={!countValid}
      available={eligible.length} unit="question"
      countHelp={eligible.length === 0 ? "No questions belong to this topic. Choose another topic." : `Choose a whole number from 1 to ${eligible.length}.`}
      countError={!countValid && eligible.length > 0 ? "Enter a valid question count to start." : undefined}>
      <label className="study-checkbox">
        <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.currentTarget.checked)} />Shuffle questions
      </label>
      <button type="button" className="button button-primary" disabled={!countValid} onClick={(event) => { if (event.detail <= 1) start(); }}>Start test</button>
      {startError && <p role="alert" className="feedback feedback-error">OpenStudy couldn't start this test. Please try again.</p>}
    </StudySetup> : state.view === "active" && question ? <section aria-labelledby="test-question-title" key={question.id}>
      <StudyProgress id="test-position" label="Question" current={state.session.currentIndex + 1} total={state.session.questionIds.length} />
      <div className="study-card">
        <h1 id="test-question-title" ref={questionHeading} tabIndex={-1} aria-describedby="test-position">{question.prompt}</h1>
        <fieldset className="study-answers" disabled={state.confirming}>
          <legend>Choose one answer</legend>
          <div className="answer-list">{question.choices.map((choice, index) => <AnswerOption key={choice.id}
            id={choice.id} text={choice.text} index={index} name="test-answer" checked={selection === choice.id} onChange={() => select(choice.id)} />)}</div>
        </fieldset>
        {selection && <button type="button" className="button button-quiet clear-answer" disabled={state.confirming}
          onClick={(event) => { if (event.detail <= 1) select(null); }}>Clear answer</button>}
        <div className="study-navigation">
          <button type="button" className="button button-secondary" disabled={state.confirming || state.session.currentIndex === 0}
            onClick={(event) => { if (event.detail <= 1) navigate("previous"); }}>Previous</button>
          {state.session.currentIndex + 1 < state.session.questionIds.length ?
            <button key="next" type="button" className="button button-secondary" disabled={state.confirming}
              onClick={(event) => { if (event.detail <= 1) navigate("next"); }}>Next</button> :
            <button key="finish" ref={finishButton} type="button" className="button button-secondary" disabled={state.confirming}
              onClick={(event) => { if (event.detail <= 1) finish(); }}>Finish test</button>}
        </div>
      </div>
      {state.confirming && <div role="group" aria-labelledby="test-confirmation-title" aria-describedby="test-confirmation-help"
        className="test-confirmation feedback feedback-warning">
        <h2 id="test-confirmation-title">{state.session.answers.filter((answer) => answer.selectedChoiceId === null).length} {state.session.answers.filter((answer) => answer.selectedChoiceId === null).length === 1 ? "question is" : "questions are"} unanswered.</h2>
        <p id="test-confirmation-help" className="mt-3">Unanswered questions receive no points. Submit this test?</p>
        <div className="confirmation-actions">
          <button ref={keepWorking} type="button" className="button button-secondary" onClick={(event) => {
            if (event.detail <= 1) transition({ ...state, confirming: false }, "finish");
          }}>Keep working</button>
          <button type="button" className="button button-primary" onClick={(event) => { if (event.detail <= 1) finish(true); }}>Submit test</button>
        </div>
      </div>}
    </section> : state.view === "results" && summary ? <section className="session-summary">
      <h1 ref={resultHeading} tabIndex={-1}>Test complete</h1>
      <p className="test-score">{summary.correct} / {summary.total}</p>
      <p className="test-percentage">{summary.percentage}%</p>
      <div className="summary-counts"><p>{summary.correct} correct</p><p>{summary.incorrect} incorrect</p><p>{summary.unanswered} unanswered</p></div>
      <p className="summary-note">These results are temporary and aren't saved on this device.</p>
      {mistakes.length === 0 && <p className="mt-4">No mistakes to review.</p>}
      <div className="summary-actions">
        {mistakes.length > 0 && <button type="button" className="button button-primary" onClick={(event) => {
          if (event.detail <= 1) transition({ ...state, view: "review", mistakeIndex: 0 }, "mistake");
        }}>Review mistakes</button>}
        <button type="button" className="button button-secondary" onClick={(event) => {
          if (event.detail <= 1) transition({ view: "setup" }, "setup");
        }}>Take another test</button>
        <Link className="button button-quiet" onClick={ignoreRepeatedNavigation} to={path}>Back to study set</Link>
      </div>
    </section> : state.view === "review" && mistake && reviewQuestion ? <section aria-labelledby="test-mistake-title" key={mistake.questionId}>
      <StudyProgress id="test-mistake-position" label="Mistake" current={state.mistakeIndex + 1} total={mistakes.length} />
      <div className="study-card">
        <h1 id="test-mistake-title" ref={mistakeHeading} tabIndex={-1} aria-describedby="test-mistake-position">{reviewQuestion.prompt}</h1>
        <div className="answer-block">
          <h2>Your answer</h2>
          <p>{mistake.selectedChoiceId === null ? "No answer" : reviewQuestion.choices.find((choice) => choice.id === mistake.selectedChoiceId)!.text}</p>
        </div>
        <div className="answer-block answer-block-correct">
          <h2>Correct answer</h2>
          <p className="revealed-answer">{reviewQuestion.choices.find((choice) => choice.id === reviewQuestion.correctChoiceId)!.text}</p>
        </div>
        {reviewQuestion.explanation && <div className="answer-explanation"><h2>Explanation</h2><p className="mt-2">{reviewQuestion.explanation}</p></div>}
        <div className="study-navigation">
          <button type="button" className="button button-secondary" disabled={state.mistakeIndex === 0} onClick={(event) => { if (event.detail <= 1) reviewMove(-1); }}>Previous mistake</button>
          <button type="button" className="button button-secondary" disabled={state.mistakeIndex + 1 === mistakes.length} onClick={(event) => { if (event.detail <= 1) reviewMove(1); }}>Next mistake</button>
        </div>
      </div>
      <button type="button" className="button button-quiet mt-4" onClick={(event) => {
        if (event.detail <= 1) transition({ view: "results", session: state.session, result: state.result }, "results");
      }}>Back to results</button>
      <div><Link className="button button-quiet" onClick={ignoreRepeatedNavigation} to={path}>Back to study set</Link></div>
    </section> : null}
    {state.view === "setup" && <div className="mt-6"><Link className="button button-quiet" onClick={ignoreRepeatedNavigation} to={path}>Back to study set</Link></div>}
  </>;
  return <>
    <title>Test · {studySet.title} | OpenStudy</title>
    {session ? <StudySessionFrame mode="Test" title={studySet.title} exit={<Link className="button button-quiet" onClick={ignoreRepeatedNavigation}
      to={path}>Exit session</Link>}>{content}</StudySessionFrame> : content}
  </>;
}
