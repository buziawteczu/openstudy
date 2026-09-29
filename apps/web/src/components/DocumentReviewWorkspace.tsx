import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DocumentBlock, ExtractedDocument } from "@openstudy/import-core";
import {
  createReviewSession, documentBlockText, EVIDENCE_LABELS, extractDocumentQuestions, finalizeDocumentReview,
  inspectCandidate, MAX_REVIEW_CHOICES, reviewCounts, reviewReducer,
  type DocumentQuestions, type DocumentReviewResult, type MappingIdentity, type ReviewAction,
} from "@openstudy/mapping";
import type { DocumentIngestionSummary } from "../import/ingest-file.js";
import { createMappingIdentity, defaultStudySetTitle } from "../import/mapping-session.js";
import { sourceContextText } from "../import/document-source.js";

function sourceIndex(extracted: ExtractedDocument): Map<string, DocumentBlock> {
  const result = new Map<string, DocumentBlock>();
  const work = [...extracted.blocks];
  while (work.length) {
    const block = work.pop()!;
    result.set(block.key, block);
    if (block.kind === "table") work.push(...block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks)));
  }
  return result;
}
function SourceText({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  return <><pre className="document-source-text">{full ? text : text.slice(0, 5000)}</pre>
    {text.length > 5000 && <button type="button" className="review-link" onClick={() => setFull(!full)}>
      {full ? "Show source excerpt" : "Show full source text"}</button>}
    {!full && text.length > 5000 && <p className="sample-note">Source excerpt; original extracted text is unchanged.</p>}</>;
}
function ExtractedContent({ summary }: { summary: DocumentIngestionSummary }) {
  const [page, setPage] = useState(0);
  const blocks = summary.extracted.blocks;
  return <details className="document-original">
    <summary>Extracted content</summary>
    {blocks.slice(page * 5, page * 5 + 5).map((block) => <div key={block.key} className="document-source-block">
      <p className="sample-note">{block.kind === "page-text" ? "Page " + block.pageNumber : block.kind === "table" ? "Table" : "Text block"}</p>
      <SourceText text={documentBlockText(block)} />
    </div>)}
    {blocks.length > 5 && <div className="review-navigation">
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous source blocks</button>
      <p>Source page {page + 1} of {Math.ceil(blocks.length / 5)}</p>
      <button type="button" disabled={(page + 1) * 5 >= blocks.length} onClick={() => setPage(page + 1)}>Next source blocks</button>
    </div>}
  </details>;
}

/** Intent gates grouping: the notes path never invokes candidate extraction. */
export function DocumentImportWorkspace({ summary }: { summary: DocumentIngestionSummary }) {
  const [intent, setIntent] = useState<"questions" | "notes" | "">("");
  const [selected, setSelected] = useState(false);
  const grouped = useRef<DocumentQuestions | null>(null);
  function continueDocument() {
    if (!intent) return;
    if (intent === "questions") grouped.current ??= extractDocumentQuestions(summary.document);
    setSelected(true);
  }
  return <section className="document-import" aria-label="Document import">
    {!selected ? <>
      <h2>What are you uploading?</h2>
      <fieldset className="answer-mode">
        <legend>Document intent</legend>
        <label className="mode-option"><input type="radio" name="document-intent" checked={intent === "questions"} onChange={() => setIntent("questions")} />
          <span>Questions or an existing test<span className="mode-help">Review existing wording and answers. Nothing is generated.</span></span></label>
        <label className="mode-option"><input type="radio" name="document-intent" checked={intent === "notes"} onChange={() => setIntent("notes")} />
          <span>Study material / notes<span className="mode-help">See extracted content. Creating questions from notes isn't supported yet.</span></span></label>
      </fieldset>
      <button className="action" type="button" disabled={!intent} onClick={continueDocument}>Continue with document</button>
    </> : intent === "notes" ? <>
      <h2>Content extracted successfully</h2>
      <p className="section-help">Creating questions from study material will be added later. No question candidates have been created.</p>
      <ExtractedContent summary={summary} />
    </> : grouped.current && <DocumentReviewWorkspace summary={summary} grouped={grouped.current} />}
    {selected && <button type="button" className="review-link" onClick={() => { setSelected(false); setIntent(""); }}>
      Change document intent (discard this review)</button>}
  </section>;
}

function DocumentReviewWorkspace({ summary, grouped }: { summary: DocumentIngestionSummary; grouped: DocumentQuestions }) {
  const [session, dispatch] = useReducer(reviewReducer, grouped, createReviewSession);
  const [title, setTitle] = useState(defaultStudySetTitle(summary.filename));
  const [result, setResult] = useState<DocumentReviewResult | null>(null);
  const [ungroupedPage, setUngroupedPage] = useState(0);
  const identity = useRef<MappingIdentity | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const finalHeading = useRef<HTMLHeadingElement>(null);
  const sourceDetails = useRef<HTMLDetailsElement>(null);
  const source = useMemo(() => sourceIndex(summary.extracted), [summary.extracted]);
  const counts = reviewCounts(session);
  const candidate = session.candidates[session.current];
  const inspection = candidate ? inspectCandidate(candidate) : undefined;
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (sourceDetails.current && window.matchMedia?.("(min-width: 68rem)").matches) sourceDetails.current.open = true;
  }, [candidate?.temporaryId]);
  const statuses = { ready: "Ready", "needs-review": "Needs review", incomplete: "Incomplete", ignored: "Excluded" };
  function change(action: ReviewAction) { setResult(null); dispatch(action); }
  function navigate(index: number) {
    dispatch({ type: "navigate", index });
    requestAnimationFrame(() => heading.current?.focus());
  }
  function finish() {
    identity.current ??= createMappingIdentity();
    setResult(identity.current ? finalizeDocumentReview(session, identity.current, title)
      : { status: "invalid", issues: ["Secure ID generation is unavailable. Try a current browser; no study set has been created."] });
    requestAnimationFrame(() => finalHeading.current?.focus());
  }
  const errors = (target: string) => inspection?.issues.filter((issue) => issue.target === target) ?? [];
  const errorProps = (target: string) => ({ "aria-invalid": errors(target).length > 0 || undefined,
    "aria-describedby": errors(target).length ? "review-error-" + target : undefined });
  const linkedErrors = (target: string) => errors(target).length > 0 && <ul id={"review-error-" + target} className="preview-problems">
    {errors(target).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>;
  const refs = candidate ? [...new Set(candidate.sourceBlockRefs.map((ref) => ref.blockKey))] : [];
  return <section className="document-review" aria-label="Document question review">
    <div className="review-progress" aria-live="polite" aria-atomic="true">
      <h2>Review existing questions</h2>
      <p>{counts.total} {counts.total === 1 ? "candidate" : "candidates"} · {counts.reviewed} reviewed · {counts.included} included · {counts.excluded} excluded · {counts.unresolved} unresolved</p>
    </div>
    <p className="section-help">Compare with your original file. Leaving or reloading will discard this review. Nothing is saved to the library.</p>
    {candidate && inspection ? <>
      <header className="review-current">
        <p className="eyebrow">{statuses[inspection.status]}</p>
        <h2 ref={heading} tabIndex={-1} aria-live="polite">Question {session.current + 1} of {counts.total}</h2>
        {candidate.sourceNumber !== undefined && <p className="sample-note">Source question number: {candidate.sourceNumber}</p>}
      </header>
      <div className="document-review-grid">
        <details className="document-original" key={candidate.temporaryId} ref={sourceDetails}>
          <summary>Original source</summary>
          <p className="sample-note">Original extracted text, unchanged by your edits. Source labels and spacing are retained.</p>
          {refs.map((key) => {
            const block = source.get(key);
            if (!block) return <p key={key} className="mapping-error">Source context unavailable. Compare with the original file.</p>;
            // Table structure is represented as rows/cells; not rendered as imported HTML.
            return <div key={key} className="document-source-block">
              <h3>{block.kind === "page-text" ? "Page " + block.pageNumber : block.kind === "table" ? "Table (rows and cells)" : block.kind === "heading" ? "Section heading" : block.kind === "list-item" ? "List item" : "Paragraph"}</h3>
              <SourceText text={sourceContextText(block, candidate.sourceBlockRefs)} />
              {"runs" in block && block.runs.some((run) => run.bold || run.italic || run.underline) && <p className="sample-note">Formatting is present; it does not determine the correct answer.</p>}
            </div>;
          })}
          {candidate.evidence.length > 0 && <details className="review-evidence">
            <summary>Why this candidate was found</summary>
            <ul>{candidate.evidence.map((evidence) => <li key={evidence}>{EVIDENCE_LABELS[evidence]}</li>)}</ul>
          </details>}
        </details>
        <div className="document-editor">
          {candidate.excluded && <p className="section-help">Intentionally excluded. Your edits and source remain here; include it again at any time.</p>}
          <fieldset disabled={candidate.excluded}>
            <legend className="sr-only">Edit current question</legend>
            <label htmlFor="review-prompt">Question text</label>
            <textarea id="review-prompt" className="mapping-control review-prompt" rows={3} value={candidate.prompt} {...errorProps("prompt")}
              onChange={(event) => change({ type: "text", field: "prompt", value: event.currentTarget.value })} />
            {linkedErrors("prompt")}
            <fieldset className="review-answers" {...errorProps("choices")}>
              <legend>Answers</legend>
              {candidate.choices.slice(0, MAX_REVIEW_CHOICES).map((choice, index) => <div key={choice.temporaryId} className="review-answer-row">
                <label htmlFor={"review-choice-" + index}>Answer {index + 1}{choice.label ? " · source label " + choice.label : ""}</label>
                <textarea id={"review-choice-" + index} className="mapping-control" rows={2} value={choice.text} {...errorProps("choices")}
                  onChange={(event) => change({ type: "choice-text", choiceId: choice.temporaryId, value: event.currentTarget.value })} />
                <button type="button" className="review-link" onClick={() => {
                  change({ type: "remove-choice", choiceId: choice.temporaryId });
                  requestAnimationFrame(() => document.getElementById("review-add-answer")?.focus());
                }}>Remove answer {index + 1}</button>
              </div>)}
              {candidate.choices.length > MAX_REVIEW_CHOICES && <p className="mapping-error">
                {candidate.choices.length - MAX_REVIEW_CHOICES} extra source answers are retained. Review them in the original source.
                <button type="button" className="review-link" onClick={() => change({ type: "remove-choice", choiceId: candidate.choices.at(-1)!.temporaryId })}>
                  Remove last extra answer</button>
              </p>}
              <button type="button" id="review-add-answer" className="review-link" disabled={candidate.choices.length >= MAX_REVIEW_CHOICES}
                onClick={() => {
                  const index = candidate.choices.length;
                  change({ type: "add-choice" });
                  requestAnimationFrame(() => document.getElementById("review-choice-" + index)?.focus());
                }}>Add answer</button>
              <p className="sample-note">At least 2 answers; at most {MAX_REVIEW_CHOICES}. Adding or removing is an explicit correction.</p>
              {linkedErrors("choices")}
            </fieldset>
            <label htmlFor="review-correct">Correct answer</label>
            <select id="review-correct" className="mapping-control" value={candidate.correctChoiceId ?? ""} {...errorProps("correct")}
              onChange={(event) => change({ type: "correct", choiceId: event.currentTarget.value })}>
              <option value="">Choose the correct answer</option>
              {candidate.choices.slice(0, MAX_REVIEW_CHOICES).map((choice, index) => <option key={choice.temporaryId} value={choice.temporaryId}>
                Answer {index + 1}: {choice.text.slice(0, 120) || "(blank)"}</option>)}
            </select>
            {linkedErrors("correct")}
            <details className="review-secondary">
              <summary>Category and explanation</summary>
              <label htmlFor="review-category">Topic / category (optional)</label>
              <input id="review-category" className="mapping-control" value={candidate.category} {...errorProps("category")}
                onChange={(event) => change({ type: "text", field: "category", value: event.currentTarget.value })} />
              {linkedErrors("category")}
              <label htmlFor="review-explanation">Explanation (optional)</label>
              <textarea id="review-explanation" className="mapping-control" rows={2} value={candidate.explanation} {...errorProps("explanation")}
                onChange={(event) => change({ type: "text", field: "explanation", value: event.currentTarget.value })} />
              <p className="sample-note">Only an explicit source explanation is prefilled. Any wording you add is your own correction.</p>
              {linkedErrors("explanation")}
            </details>
            {linkedErrors("review")}
            <label className="review-check"><input type="checkbox" checked={candidate.confirmed}
              aria-describedby={errors("review").length ? "review-error-review" : undefined}
              onChange={(event) => change({ type: "confirm", value: event.currentTarget.checked })} />
              <span>I checked the source, wording, grouping and correct answer. Confirm this question.</span></label>
          </fieldset>
          <label className="review-check"><input type="checkbox" checked={candidate.excluded}
            onChange={(event) => change({ type: "exclude", value: event.currentTarget.checked })} />
            <span>Exclude this question from the study set</span></label>
        </div>
      </div>
      <nav className="review-navigation" aria-label="Question navigation">
        <button type="button" disabled={session.current === 0} onClick={() => navigate(session.current - 1)}>Previous question</button>
        <button type="button" disabled={session.current + 1 >= counts.total} onClick={() => navigate(session.current + 1)}>Next question</button>
      </nav>
    </> : <><h3 className="review-current">No question groups found</h3>
      <p>Only explicit existing-question structures are supported. Nothing was invented. Review the extracted content or choose another file.</p>
      <ExtractedContent summary={summary} /></>}
    {grouped.ungrouped.length > 0 && <section className="review-ungrouped" aria-labelledby="ungrouped-title">
      <h3 id="ungrouped-title">{grouped.ungrouped.length} source blocks were not grouped into questions</h3>
      <p className="section-help">Unclear paragraphs, tables and unmatched keys are preserved here. They will not be included. Correct the original file and re-upload if they contain missing questions.</p>
      <details className="document-original"><summary>Review ungrouped source content</summary>
        {grouped.ungrouped.slice(ungroupedPage * 5, ungroupedPage * 5 + 5).map((entry, index) => <div className="document-source-block" key={index}>
          <p className="sample-note">{entry.ref.page ? "Page " + entry.ref.page + " · " : ""}
            {entry.reason === "unsupported-table" ? "Table structure wasn't recognized" : entry.reason === "unmatched-answer-key" ? "Answer-key reference couldn't be matched" : "Structure wasn't recognized"}</p>
          <SourceText text={source.get(entry.ref.blockKey) ? documentBlockText(source.get(entry.ref.blockKey)!) : entry.text} />
        </div>)}
        {grouped.ungrouped.length > 5 && <nav className="review-navigation" aria-label="Ungrouped source navigation">
          <button type="button" disabled={ungroupedPage === 0} onClick={() => setUngroupedPage(ungroupedPage - 1)}>Previous ungrouped blocks</button>
          <p>Page {ungroupedPage + 1} of {Math.ceil(grouped.ungrouped.length / 5)}</p>
          <button type="button" disabled={(ungroupedPage + 1) * 5 >= grouped.ungrouped.length} onClick={() => setUngroupedPage(ungroupedPage + 1)}>Next ungrouped blocks</button>
        </nav>}
      </details>
      <label className="review-check"><input type="checkbox" checked={session.ungroupedReviewed}
        onChange={(event) => change({ type: "ungrouped-reviewed", value: event.currentTarget.checked })} />
        <span>I reviewed the ungrouped content and accept that it will not become questions.</span></label>
    </section>}
    <section className="validation-step" aria-labelledby="document-finish-title">
      <h2 id="document-finish-title">Check the reviewed study set</h2>
      <label htmlFor="document-study-title">Study set title</label>
      <input id="document-study-title" className="mapping-control" value={title}
        aria-invalid={result?.status === "invalid" && result.issues.some((issue) => issue.startsWith("Study set title")) || undefined}
        aria-describedby={result?.status === "invalid" && result.issues.some((issue) => issue.startsWith("Study set title")) ? "document-final-errors" : undefined}
        onChange={(event) => { setResult(null); setTitle(event.currentTarget.value); }} />
      {counts.unresolved > 0 && <p className="section-help">{counts.unresolved} included questions still need attention. Correct and confirm them, or explicitly exclude them.</p>}
      <button type="button" className="action" onClick={finish}>Validate reviewed questions</button>
      <button type="button" className="review-link" disabled={counts.unresolved === 0}
        onClick={() => {
          const next = session.candidates.findIndex((entry, index) => index > session.current && !entry.excluded && inspectCandidate(entry).status !== "ready");
          navigate(next === -1 ? session.candidates.findIndex((entry) => !entry.excluded && inspectCandidate(entry).status !== "ready") : next);
        }}>Go to next unresolved question</button>
    </section>
    {result && <section className={"validation-result " + (result.status === "ready" ? "validation-ready" : "")} aria-labelledby="document-final-title">
      <div aria-live="polite" aria-atomic="true">
        <h2 id="document-final-title" ref={finalHeading} tabIndex={-1}>{result.status === "ready" ? "Study set ready" : "Study set needs attention"}</h2>
        <p>{counts.reviewed} candidates reviewed · {counts.included} included · {counts.excluded} excluded · {counts.unresolved} unresolved</p>
        {result.status === "ready" ? <><p>{result.candidate.title} · {result.candidate.questions.length} questions</p>
          <p className="section-help">Ready in memory only. Leaving or reloading discards it. Nothing has been saved or added to your library.</p></>
          : <ul className="preview-problems" id="document-final-errors">{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      </div>
    </section>}
  </section>;
}
