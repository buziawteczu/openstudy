import { useEffect, useRef, useState } from "react";
import type { StudySet } from "@openstudy/schema";
import { Link, useNavigate, useParams } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";

type State = { kind: "loading" } | { kind: "ready"; studySet: StudySet } |
  { kind: "missing" } | { kind: "incompatible" } | { kind: "error" };

export function StudySetPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    if (!id) { setState({ kind: "missing" }); return; }
    void (async () => {
      const result = await studySetStorage.getStudySet(id);
      if (!active) return;
      if (result.success) { setState({ kind: "ready", studySet: result.value }); return; }
      if (result.error !== "not-found") {
        setState({ kind: result.error === "incompatible-study-set" ? "incompatible" : "error" });
        return;
      }
      const summaries = await studySetStorage.listStudySets();
      if (active) setState({ kind: summaries.success && summaries.value.some((entry) => entry.id === id) ? "incompatible" : summaries.success ? "missing" : "error" });
    })();
    return () => { active = false; };
  }, [id]);

  useEffect(() => { if (confirm) cancelButton.current?.focus(); }, [confirm]);

  function cancel() { setConfirm(false); setDeleteError(false); requestAnimationFrame(() => deleteButton.current?.focus()); }
  async function remove() {
    if (!id || deleting) return;
    setDeleting(true); setDeleteError(false);
    const result = await studySetStorage.deleteStudySet(id);
    if (result.success) navigate("/");
    else { setDeleteError(true); setDeleting(false); }
  }

  const title = state.kind === "ready" ? state.studySet.title : state.kind === "missing" ? "Study set not found" : state.kind === "incompatible" ? "This study set can't be opened" : "Study set";
  return <>
    <title>{title} | OpenStudy</title>
    <h1 tabIndex={-1} className="[overflow-wrap:anywhere]">{title}</h1>
    {state.kind === "loading" && <p role="status" className="mt-5">Opening study set…</p>}
    {state.kind === "ready" && <>
      <p className="mt-4 text-muted">Saved on this device</p>
      <section className="study-modes" aria-labelledby="study-modes-title">
        <h2 id="study-modes-title">Study</h2>
        <div className="mode-list">
          {([
            ["learn", "Learn", "Choose an answer and retry until you get it."],
            ["flashcards", "Flashcards", "Recall the answer, reveal it, then rate yourself."],
            ["test", "Test", "Answer first. See your results when you're done."],
          ] as const).map(([route, name, description]) => <Link key={route} className="mode-card"
            aria-labelledby={`mode-${route}`} aria-describedby={`mode-${route}-description`}
            to={`/study-sets/${encodeURIComponent(state.studySet.id)}/${route}`}>
            <h3 id={`mode-${route}`}>{name}</h3>
            <p id={`mode-${route}-description`}>{description}</p>
            <span aria-hidden="true">→</span>
          </Link>)}
        </div>
      </section>
      {state.studySet.description && <p className="set-description">{state.studySet.description}</p>}
      <dl className="study-set-facts">
        <div><dt>Questions</dt><dd>{state.studySet.questions.length}</dd></div>
        <div><dt>Categories</dt><dd>{state.studySet.categories.length}</dd></div>
        <div><dt>Sources</dt><dd>{state.studySet.sources.length}</dd></div>
      </dl>
      <details className="set-sources">
        <summary>Sources</summary>
        <ul className="mt-3 list-disc pl-5">{state.studySet.sources.map((source) =>
          <li key={source.id} className="[overflow-wrap:anywhere]">{source.originalFilename ?? source.label}</li>)}</ul>
      </details>
      <div className="set-management"><Link className="button button-secondary" to={`/study-sets/${encodeURIComponent(state.studySet.id)}/add-material`}>Add material</Link></div>
    </>}
    {state.kind === "missing" && <p className="mt-4 text-muted">It may have been deleted from this device.</p>}
    {state.kind === "incompatible" && <p className="mt-4 text-muted">Its saved data could not be validated.</p>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-danger">OpenStudy couldn't read this study set on this device.</p>}
    {state.kind !== "loading" && <div className="mt-6"><Link className="button button-quiet" to="/"><span aria-hidden="true">←</span> Back to library</Link></div>}
    {(state.kind === "ready" || state.kind === "incompatible") && <section className="mt-8 border-t border-border pt-6" aria-label="Delete study set">
      {!confirm ? <button ref={deleteButton} type="button" className="button button-danger" onClick={() => setConfirm(true)}>{state.kind === "ready" ? "Delete study set" : "Delete from this device"}</button>
        : <div className="rounded-surface border border-border bg-surface p-5" role="group" aria-labelledby="delete-title">
          <h2 id="delete-title">Delete {state.kind === "ready" ? `“${state.studySet.title}”` : "this study set"}?</h2>
          <p className="mt-2 text-muted">This removes the study set and its learning progress from this browser.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button ref={cancelButton} type="button" disabled={deleting} className="button button-secondary" onClick={cancel}>Cancel</button>
            <button type="button" disabled={deleting} className="button button-danger" onClick={() => void remove()}>{deleting ? "Deleting…" : "Delete"}</button>
          </div>
          {deleteError && <p role="alert" className="mt-3 text-danger">OpenStudy couldn't delete this study set. Please try again.</p>}
        </div>}
    </section>}
  </>;
}
