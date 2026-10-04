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
    <p className="eyebrow">Study set</p>
    <h1 tabIndex={-1} className="[overflow-wrap:anywhere]">{title}</h1>
    {state.kind === "loading" && <p role="status" className="mt-5">Opening study set…</p>}
    {state.kind === "ready" && <>
      <p className="mt-4 text-muted">Saved on this device</p>
      {state.studySet.description && <p className="mt-5">{state.studySet.description}</p>}
      <dl className="study-set-facts">
        <div><dt>Questions</dt><dd>{state.studySet.questions.length}</dd></div>
        <div><dt>Categories</dt><dd>{state.studySet.categories.length}</dd></div>
        <div><dt>Sources</dt><dd>{state.studySet.sources.length}</dd></div>
      </dl>
      <section className="mt-8" aria-labelledby="sources-title">
        <h2 id="sources-title">Sources</h2>
        <ul className="mt-3 list-disc pl-5">{state.studySet.sources.map((source) =>
          <li key={source.id} className="[overflow-wrap:anywhere]">{source.originalFilename ?? source.label}</li>)}</ul>
      </section>
      <div className="mt-8"><Link className="action inline-block" to={`/study-sets/${encodeURIComponent(state.studySet.id)}/learn`}>Learn</Link></div>
      <div><Link className="back-link" to={`/study-sets/${encodeURIComponent(state.studySet.id)}/add-material`}>Add material</Link></div>
    </>}
    {state.kind === "missing" && <p className="mt-4 text-muted">It may have been deleted from this device.</p>}
    {state.kind === "incompatible" && <p className="mt-4 text-muted">Its saved data could not be validated.</p>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-danger">OpenStudy couldn't read this study set on this device.</p>}
    {state.kind !== "loading" && <div className="mt-8"><Link className="back-link" to="/"><span aria-hidden="true">←</span> Back to library</Link></div>}
    {(state.kind === "ready" || state.kind === "incompatible") && <section className="mt-8 border-t border-border pt-6" aria-label="Delete study set">
      {!confirm ? <button ref={deleteButton} type="button" className="review-link" onClick={() => setConfirm(true)}>{state.kind === "ready" ? "Delete study set" : "Delete from this device"}</button>
        : <div className="rounded-surface border border-border bg-surface p-5" role="group" aria-labelledby="delete-title">
          <h2 id="delete-title">Delete {state.kind === "ready" ? `“${state.studySet.title}”` : "this study set"}?</h2>
          <p className="mt-2 text-muted">This removes the study set and its learning progress from this browser.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button ref={cancelButton} type="button" disabled={deleting} className="review-link" onClick={cancel}>Cancel</button>
            <button type="button" disabled={deleting} className="action" onClick={() => void remove()}>{deleting ? "Deleting…" : "Delete"}</button>
          </div>
          {deleteError && <p role="alert" className="mt-3 text-danger">OpenStudy couldn't delete this study set. Please try again.</p>}
        </div>}
    </section>}
  </>;
}
