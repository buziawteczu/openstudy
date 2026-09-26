import { Link } from "react-router";

import { BookIcon } from "../components/BookIcon.js";

export function LibraryPage() {
  return (
    <>
      <title>Library | OpenStudy</title>
      <div className="page-heading">
        <p className="eyebrow">Library</p>
        <h1 tabIndex={-1}>Your study sets</h1>
        <p className="page-description">
          A little space for everything you’re learning.
        </p>
      </div>
      <section className="empty-state" aria-labelledby="empty-state-title">
        <span className="empty-state-icon">
          <BookIcon />
        </span>
        <h2 id="empty-state-title">No study sets yet</h2>
        <p>
          Bring your own study material and turn it into something you can learn from.
        </p>
        <Link className="action" to="/import">
          Import study set <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}
