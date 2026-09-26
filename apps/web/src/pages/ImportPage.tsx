import { Link } from "react-router";

export function ImportPage() {
  return (
    <>
      <title>Import | OpenStudy</title>
      <div className="page-heading">
        <p className="eyebrow">Import</p>
        <h1 tabIndex={-1}>Import study material</h1>
      </div>
      <section className="placeholder" aria-labelledby="import-placeholder-title">
        <p className="status-label">Coming next</p>
        <h2 id="import-placeholder-title">A home for your material</h2>
        <p>
          Importing JSON and ZIP study material will be available in a later update.
          There’s nothing to upload just yet.
        </p>
        <Link className="back-link" to="/">
          <span aria-hidden="true">←</span> Back to library
        </Link>
      </section>
    </>
  );
}
