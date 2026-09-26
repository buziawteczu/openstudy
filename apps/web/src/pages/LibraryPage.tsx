import { Link } from "react-router";

import { BookIcon } from "../components/BookIcon.js";

export function LibraryPage() {
  return (
    <>
      <title>Library | OpenStudy</title>
      <div className="mb-8">
        <p className="eyebrow">Library</p>
        <h1 tabIndex={-1}>Your study sets</h1>
        <p className="mt-3 max-w-[46ch] text-muted">
          A little space for everything you’re learning.
        </p>
      </div>
      <section
        className="rounded-surface border border-border bg-surface p-card text-center"
        aria-labelledby="empty-state-title"
      >
        <span className="mx-auto mb-6 grid size-[56px] place-items-center rounded-surface bg-accent-soft text-accent">
          <BookIcon />
        </span>
        <h2 id="empty-state-title">No study sets yet</h2>
        <p className="mx-auto mt-3 max-w-[40ch] text-muted">
          Bring your own study material and turn it into something you can learn from.
        </p>
        <Link className="action" to="/import">
          Import study set <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}
