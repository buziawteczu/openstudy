import { useRef, useState } from "react";
import type { StudySet } from "@openstudy/schema";
import { Link, useNavigate } from "react-router";
import { analyzeStudySetMerge, applyStudySetMerge } from "../merge/study-sets.js";
import { studySetStorage } from "../storage/study-sets.js";
import { SaveStudySetButton } from "./SaveStudySetButton.js";

export function ReadyStudySetAction({ studySet, existingStudySet }: { studySet: StudySet; existingStudySet?: StudySet | undefined }) {
  if (!existingStudySet) return <SaveStudySetButton studySet={studySet} />;
  return <MergeReview existingStudySet={existingStudySet} incomingStudySet={studySet} />;
}

function MergeReview({ existingStudySet, incomingStudySet }: { existingStudySet: StudySet; incomingStudySet: StudySet }) {
  const navigate = useNavigate();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"conflict" | "missing" | "write" | null>(null);
  const analysis = analyzeStudySetMerge(existingStudySet, incomingStudySet);
  const returnPath = `/study-sets/${encodeURIComponent(existingStudySet.id)}`;

  async function update() {
    if (busy.current || !analysis.success || analysis.plan.issues.length) return;
    const result = applyStudySetMerge(existingStudySet, incomingStudySet);
    if (!result.success) { setError("write"); return; }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const stored = await studySetStorage.replaceStudySet({
        expectedId: existingStudySet.id, expectedRevision: existingStudySet.revision, nextStudySet: result.studySet,
      });
      if (stored.success) navigate(returnPath);
      else setError(stored.error === "revision-conflict" ? "conflict" : stored.error === "not-found" ||
        stored.error === "incompatible-study-set" ? "missing" : "write");
    } catch { setError("write"); }
    finally { busy.current = false; setSaving(false); }
  }

  return <section className="mt-6 border-t border-border pt-6" aria-labelledby="merge-preview-title">
    <h3 id="merge-preview-title">Adding material to “{existingStudySet.title}”</h3>
    {!analysis.success ? <p role="alert" className="mt-3 text-danger">This material cannot be compared safely. Return to the study set and try another file.</p> : <>
      <p className="mt-3">{analysis.plan.incomingQuestionCount} {analysis.plan.incomingQuestionCount === 1 ? "question" : "questions"} found · {analysis.plan.newQuestions.length} new · {analysis.plan.exactDuplicates.length} already exist · {analysis.plan.issues.length} need attention</p>
      <p className="mt-3 text-muted">{analysis.plan.newQuestions.length} {analysis.plan.newQuestions.length === 1 ? "question" : "questions"} will be added. {analysis.plan.newSources.length} {analysis.plan.newSources.length === 1 ? "source" : "sources"} and {analysis.plan.newCategories.length} {analysis.plan.newCategories.length === 1 ? "category" : "categories"} will be added.</p>
      {analysis.plan.exactDuplicates.length > 0 && <details className="mt-5">
        <summary>{analysis.plan.exactDuplicates.length} already in this study set</summary>
        <p className="mt-2 text-muted">The matching questions keep their existing identity. New source and category information will be added.</p>
        <ul className="mt-3 list-disc pl-5">{analysis.plan.exactDuplicates.slice(0, 10).map((item) => <li key={item.incomingIndex} className="[overflow-wrap:anywhere]">
          Incoming question {item.incomingIndex + 1}: {item.prompt} matches saved question {existingStudySet.questions.findIndex((question) => question.id === item.existingId) + 1}.
        </li>)}</ul>
        {analysis.plan.exactDuplicates.length > 10 && <p className="mt-2 text-muted">Showing the first 10 of {analysis.plan.exactDuplicates.length} matches.</p>}
      </details>}
      {analysis.plan.issues.length > 0 && <section className="mt-5" aria-labelledby="merge-issues-title">
        <h4 id="merge-issues-title">Needs attention</h4>
        <p className="mt-2 text-muted">This material cannot be merged safely. Your saved study set has not changed.</p>
        <ul className="preview-problems">{analysis.plan.issues.slice(0, 10).map((issue, index) => <li key={index}>
          {issue.incomingIndex !== undefined ? `Question ${issue.incomingIndex + 1}: ` : ""}{issue.message}
        </li>)}</ul>
        {analysis.plan.issues.length > 10 && <p className="text-muted">And {analysis.plan.issues.length - 10} more issues.</p>}
      </section>}
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" className="action" disabled={saving || analysis.plan.issues.length > 0} onClick={() => void update()}>
          {saving ? "Updating…" : "Update study set"}
        </button>
        <Link className="back-link" to={returnPath}>← Back to study set</Link>
      </div>
      {error && <p role="alert" className="mt-3 text-danger">{error === "conflict" ?
        "This study set changed while you were adding material. Reopen it and try again." : error === "missing" ?
          "This study set is no longer available. Return to the library and reopen it." :
          "OpenStudy couldn't update this study set on this device. Please try again."}</p>}
    </>}
  </section>;
}
