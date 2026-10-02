import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { StudySet } from "@openstudy/schema";
import { ingestFile, type IngestionSummary } from "../import/ingest-file.js";
import { ingestionErrorMessage, type IngestionFailure } from "../import/errors.js";
import { MappingWorkspace } from "../components/MappingWorkspace.js";
import { DocumentImportWorkspace } from "../components/DocumentReviewWorkspace.js";

type State =
  | { kind: "idle" }
  | { kind: "reading"; filename: string }
  | { kind: "success"; summary: IngestionSummary }
  | { kind: "error"; error: IngestionFailure };

export function ImportPage({ existingStudySet }: { existingStudySet?: StudySet | undefined }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function choose(file: File) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState({ kind: "reading", filename: file.name });
    try {
      const result = await ingestFile(file, undefined, request.signal);
      if (!request.signal.aborted) {
        setState(result.success ? { kind: "success", summary: result.value } : { kind: "error", error: result.error });
      }
    } catch {
      // Reset/navigation cancels extraction and must not announce stale results.
      if (!request.signal.aborted) setState({ kind: "error", error: { code: "read-failure", filename: file.name } });
    }
  }

  function reset() {
    controller.current?.abort();
    setState({ kind: "idle" });
    if (input.current) {
      input.current.value = "";
      // The canceled reading state must first re-enable the native control.
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  const filename = state.kind === "reading" ? state.filename : state.kind === "success" ? state.summary.filename : state.kind === "error" ? state.error.filename : undefined;
  const structured = state.kind === "success" && state.summary.kind === "structured";
  const loaded = state.kind === "success";
  const returnPath = existingStudySet ? `/study-sets/${encodeURIComponent(existingStudySet.id)}` : "/";
  return (
    <>
      {existingStudySet ? <title>{`Add material to ${existingStudySet.title} | OpenStudy`}</title> : <title>Import | OpenStudy</title>}
      <div className="mb-8">
        <p className="eyebrow">{existingStudySet ? "Add material" : "Import"}</p>
        <h1 tabIndex={-1}>{existingStudySet ? `Add material to “${existingStudySet.title}”` : "Import study material"}</h1>
        {existingStudySet && <p className="mt-3 text-muted">New material will be compared before this study set is updated.</p>}
      </div>
      <section className={"rounded-surface border border-border bg-surface " + (loaded ? "p-6" : "p-card")} aria-labelledby="choose-file-title">
        <h2 id="choose-file-title">Choose your material</h2>
        <p id="file-help" className={loaded ? "sr-only" : "mt-3 text-muted"}>Choose a DOCX, PDF with selectable text, JSON, or ZIP containing JSON files. Scanned PDFs and legacy DOC files aren't supported yet.</p>
        <label htmlFor="source-file" className="mt-6 block text-small font-semibold">Study material file</label>
        <input
          ref={input} id="source-file" type="file" accept=".docx,.pdf,.json,.zip"
          aria-describedby="file-help file-privacy"
          disabled={state.kind === "reading"}
          className="mt-2 block min-h-[48px] w-full min-w-0 max-w-full rounded-small text-small file:mr-3 file:min-h-[48px] file:cursor-pointer file:rounded-small file:border-0 file:bg-accent file:px-4 file:py-3 file:font-semibold file:text-surface hover:file:bg-accent-hover disabled:opacity-60"
          onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void choose(file); }}
        />
        <p id="file-privacy" className={loaded ? "sr-only" : "mt-3 text-small text-muted"}>Files are processed on this device.</p>
        {filename && <p className="mt-6 font-semibold [overflow-wrap:anywhere]">{filename}</p>}
        <div role="status" aria-live="polite" aria-atomic="true" className={structured ? "ingestion-status mt-3" : "mt-3"}>
          {state.kind === "reading" && <p>Reading and inspecting…</p>}
          {state.kind === "success" && state.summary.kind === "structured" && <>
            <h2 className="text-success">Ready for mapping</h2>
            <p>{state.summary.sources.length} JSON {state.summary.sources.length === 1 ? "file" : "files"} found</p>
            <p>{state.summary.collectionCount} {state.summary.collectionCount === 1 ? "collection" : "collections"} discovered</p>
            <p>{state.summary.recordCount} {state.summary.recordCount === 1 ? "record" : "records"} discovered</p>
            <p className="mt-3 text-small text-muted">Choose a collection below, then map its fields. Nothing has been added to your library.</p>
          </>}
          {state.kind === "success" && state.summary.kind === "document" && <>
            <h2 className="text-success">Document extracted</h2>
            {state.summary.sourceDocument.format === "pdf" ? <>
              <p className="mt-2">{state.summary.counts.pages} {state.summary.counts.pages === 1 ? "page" : "pages"} processed</p>
              <p>Selectable text extracted</p>
              {state.summary.counts.pagesWithoutText > 0 && <p>{state.summary.counts.pagesWithoutText} {state.summary.counts.pagesWithoutText === 1 ? "page has" : "pages have"} no selectable text.</p>}
              <p className="mt-3 text-small text-muted">PDF reading order may need review. Images and tables have not been reconstructed.</p>
            </> : <>
              <p className="mt-2">{state.summary.counts.paragraphs} {state.summary.counts.paragraphs === 1 ? "paragraph" : "paragraphs"} extracted</p>
              <p>{state.summary.counts.headings} {state.summary.counts.headings === 1 ? "heading" : "headings"}, {state.summary.counts.listItems} list {state.summary.counts.listItems === 1 ? "item" : "items"}</p>
              <p>{state.summary.counts.tables} {state.summary.counts.tables === 1 ? "table" : "tables"} extracted</p>
              <p className="mt-3 text-small text-muted">Basic text formatting is retained; the original Word layout is not reproduced.</p>
              {state.summary.document.hasEmbeddedMedia === true && <p className="text-small text-muted">This document contains media that has not been extracted.</p>}
              {state.summary.document.warnings.some((warning) => warning === "omitted-docx-parts" || warning === "unsupported-content") && <p className="text-small text-muted">Some document features or sections could not be extracted. Review against the original file.</p>}
            </>}
            <p className="mt-3 font-semibold">Content ready for review</p>
            <p className="mt-2 text-small text-muted">Choose how to use the extracted content below. Nothing has been added to your library.</p>
          </>}
        </div>
        {state.kind === "error" && <p role="alert" className="mt-3 text-danger [overflow-wrap:anywhere]">{ingestionErrorMessage(state.error)}</p>}
        <div className={structured ? "ingestion-actions" : undefined}>
          {state.kind !== "idle" && <button type="button" className="action cursor-pointer" onClick={reset}>{state.kind === "reading" ? "Cancel" : "Choose another file"}</button>}
          <div><Link className="back-link" to={returnPath}><span aria-hidden="true">←</span> {existingStudySet ? "Back to study set" : "Back to library"}</Link></div>
        </div>
      </section>
      {state.kind === "success" && state.summary.kind === "structured" && <MappingWorkspace summary={state.summary} existingStudySet={existingStudySet} />}
      {state.kind === "success" && state.summary.kind === "document" && <DocumentImportWorkspace summary={state.summary} existingStudySet={existingStudySet} />}
    </>
  );
}
