import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BookIcon } from "../components/BookIcon.js";
import { studySetStorage, type LibrarySummary } from "../storage/study-sets.js";

type State = { kind: "loading" } | { kind: "ready"; entries: LibrarySummary[] } | { kind: "error" };

export function LibraryPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    void studySetStorage.listStudySets().then((result) => {
      if (active) setState(result.success ? { kind: "ready", entries: result.value } : { kind: "error" });
    });
    return () => { active = false; };
  }, []);

  return <>
    <title>Library | OpenStudy</title>
    <div className="mb-8">
      <p className="eyebrow">Library</p>
      <h1 tabIndex={-1}>Your study sets</h1>
      <p className="mt-3 max-w-[46ch] text-muted">Study sets are stored in this browser on this device.</p>
    </div>
    {state.kind === "loading" && <p role="status">Loading your library…</p>}
    {state.kind === "error" && <section role="alert" className="rounded-surface border border-border bg-surface p-card">
      <h2>Library unavailable</h2>
      <p className="mt-3 text-muted">OpenStudy couldn't read saved study sets on this device.</p>
      <Link className="action" to="/import">Import study material</Link>
    </section>}
    {state.kind === "ready" && (state.entries.length === 0 ? <section
      className="rounded-surface border border-border bg-surface p-card text-center" aria-labelledby="empty-state-title">
      <span className="mx-auto mb-6 grid size-[56px] place-items-center rounded-surface bg-accent-soft text-accent"><BookIcon /></span>
      <h2 id="empty-state-title">No study sets yet</h2>
      <p className="mx-auto mt-3 max-w-[40ch] text-muted">Bring your own study material and turn it into something you can learn from.</p>
      <Link className="action" to="/import">Import study set <span aria-hidden="true">→</span></Link>
    </section> : <>
      <ul className="library-list">
        {state.entries.map((entry) => <li key={entry.id}>
          <Link className="library-card" to={`/study-sets/${encodeURIComponent(entry.id)}`}>
            <span className="library-card-title">{entry.title}</span>
            <span className="text-muted">{entry.questionCount} {entry.questionCount === 1 ? "question" : "questions"} · {entry.categoryCount} {entry.categoryCount === 1 ? "category" : "categories"}</span>
            <span className="library-card-open">Open <span aria-hidden="true">→</span></span>
          </Link>
        </li>)}
      </ul>
      <Link className="action" to="/import">Import study material</Link>
    </>)}
  </>;
}
