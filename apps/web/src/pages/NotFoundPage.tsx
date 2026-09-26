import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <>
      <title>Page not found | OpenStudy</title>
      <div className="mb-8">
        <p className="eyebrow">OpenStudy</p>
        <h1 tabIndex={-1}>Page not found</h1>
        <p className="mt-3 max-w-[46ch] text-muted">
          This page doesn’t exist. Let’s get you back to your library.
        </p>
        <Link className="back-link" to="/">
          <span aria-hidden="true">←</span> Back to library
        </Link>
      </div>
    </>
  );
}
