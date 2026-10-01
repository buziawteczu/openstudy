import { useMemo, useRef, useState, type FormEvent } from "react";
import type { RecordCollection, SourceDescriptor, SourceValue } from "@openstudy/import-core";
import {
  discoverFields, fieldLabel, inspectRecord, previewMapping, TARGET_LABELS, validateMapping,
  type AnswerMode, type MappingInput, type MappingIssue, type MappingResult, type MappingTarget,
  type RecordPreview,
} from "@openstudy/mapping";
import type { StructuredIngestionSummary } from "../import/ingest-file.js";
import { createMappingIdentity, defaultStudySetTitle } from "../import/mapping-session.js";
import { SaveStudySetButton } from "./SaveStudySetButton.js";

type CollectionOption = { key: string; source: SourceDescriptor; collection: RecordCollection; label: string };
type Selections = Record<MappingTarget, string>;
const targets: readonly MappingTarget[] = ["prompt", "choices", "correctAnswer", "category", "explanation", "externalId"];
const required = new Set<MappingTarget>(["prompt", "choices", "correctAnswer"]);
const emptySelections: Selections = { prompt: "", choices: "", correctAnswer: "", category: "", explanation: "", externalId: "" };
const ISSUE_PAGE_SIZE = 10;
const PREVIEW_CHOICE_LIMIT = 20;

function SourceSample({ value }: { value: SourceValue }) {
  const text = JSON.stringify(value, null, 2);
  const truncated = text.length > 800;
  return <><pre className="source-value">{text.slice(0, 800)}</pre>{truncated && <p className="sample-note">Sample excerpt; the source value is unchanged.</p>}</>;
}

function QuestionPreview({ record, compact = false }: { record: RecordPreview; compact?: boolean }) {
  return <article className="question-preview" aria-label={"Preview of record " + (record.recordIndex + 1)}>
    <p className="preview-record">Record {record.recordIndex + 1}{record.issues.length ? " · needs attention" : ""}</p>
    <h3>{record.display.prompt ?? "Question text unavailable"}</h3>
    {record.display.choices.length > 0
      ? <ol className="preview-answers">{record.display.choices.slice(0, PREVIEW_CHOICE_LIMIT).map((choice, index) =>
        <li key={index} className={choice.correct ? "answer-correct" : ""}>
          <span>{choice.text}</span>{choice.correct && <span className="correct-label">Correct answer</span>}
        </li>)}</ol>
      : <p className="sample-note">No supported answers to preview.</p>}
    {record.display.choices.length > PREVIEW_CHOICE_LIMIT && <p className="sample-note">First {PREVIEW_CHOICE_LIMIT} answers shown. Final validation checks every answer.</p>}
    {record.display.category && <p className="preview-detail">Topic: {record.display.category}</p>}
    {record.display.explanation && <p className="preview-detail">{record.display.explanation}</p>}
    {!compact && record.issues.length > 0 && <ul className="preview-problems">{record.issues.map((entry, index) =>
      <li key={index}>{TARGET_LABELS[entry.target]}: {entry.message}</li>)}</ul>}
  </article>;
}

export function MappingWorkspace({ summary }: { summary: StructuredIngestionSummary }) {
  const collections = useMemo<CollectionOption[]>(() => summary.sources.flatMap((item, sourceIndex) =>
    item.candidate.collections.map((collection) => ({
      key: JSON.stringify([sourceIndex, collection.key]),
      source: item.candidate.source, collection,
      label: (item.candidate.source.originalFilename ?? item.candidate.source.label ?? "JSON file")
        + " · " + (collection.label ?? collection.key) + " — " + collection.records.length + " records",
    }))), [summary]);
  const [selected, setSelected] = useState(collections.length === 1 ? collections[0]!.key : "");
  const option = collections.find((entry) => entry.key === selected);
  return <section className="mapping-workspace" aria-label="Structured mapping">
    <div className="collection-step">
      <p className="eyebrow">1 · Choose a collection</p>
      <h2>Which records become questions?</h2>
      <p className="section-help">Map one collection at a time. Other collections and files won't be combined.</p>
      <label htmlFor="record-collection">Record collection</label>
      <select id="record-collection" className="mapping-control" value={selected} onChange={(event) => setSelected(event.currentTarget.value)}>
        <option value="">Choose a collection</option>
        {collections.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </select>
      {collections.length > 1 && !option && <p className="section-help">Several collections were found. Choose one to start mapping.</p>}
      {collections.length === 0 && <p className="section-help">No record collections were found. Choose another file containing an array of question records.</p>}
      {option?.collection.records.length === 0 && <p className="section-help">This collection is empty. Choose another collection or file.</p>}
    </div>
    {option && <SelectedMapping key={option.key} option={option} defaultTitle={defaultStudySetTitle(summary.filename)} />}
  </section>;
}

function SelectedMapping({ option, defaultTitle }: { option: CollectionOption; defaultTitle: string }) {
  const [identity] = useState(createMappingIdentity);
  const fields = useMemo(() => discoverFields(option.collection), [option.collection]);
  const [selections, setSelections] = useState<Selections>(emptySelections);
  const [mode, setMode] = useState<AnswerMode | "">("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [validated, setValidated] = useState<{ input: MappingInput; result: MappingResult } | null>(null);
  const [page, setPage] = useState(0);
  const [activeRecord, setActiveRecord] = useState<number | null>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const inspectionHeading = useRef<HTMLHeadingElement>(null);
  const input = useMemo<MappingInput | undefined>(() => {
    if (!identity || !mode || !selections.prompt || !selections.choices || !selections.correctAnswer) return undefined;
    const path = (target: MappingTarget) => JSON.parse(selections[target]) as string[];
    return {
      source: option.source, collection: option.collection, identity, title,
      ...(description === "" ? {} : { description }),
      definition: {
        collectionKey: option.collection.key, promptPath: path("prompt"), choicesPath: path("choices"),
        correctAnswer: { path: path("correctAnswer"), mode },
        ...(selections.category ? { categoryPath: path("category") } : {}),
        ...(selections.explanation ? { explanationPath: path("explanation") } : {}),
        ...(selections.externalId ? { externalIdPath: path("externalId") } : {}),
      },
    };
  }, [identity, mode, selections, title, description, option]);
  // Preview depends on the mapping, not metadata typing.
  const preview = useMemo(() => input ? previewMapping(input) : undefined, [identity, mode, selections, option]);
  const validation = validated && validated.input === input ? validated.result : undefined;
  const recordIssues = useMemo(() => validation?.issues.filter((entry) => entry.recordIndex !== null) ?? [], [validation]);
  const globalIssues = validation?.issues.filter((entry) => entry.recordIndex === null) ?? [];
  const counts = useMemo(() => {
    const result = new Map<MappingIssue["target"], Set<number>>();
    for (const entry of recordIssues) {
      const records = result.get(entry.target) ?? new Set<number>();
      records.add(entry.recordIndex!); result.set(entry.target, records);
    }
    return result;
  }, [recordIssues]);
  const inspected = useMemo(() => input && validation && activeRecord !== null
    ? inspectRecord(input, activeRecord) : undefined, [input, validation, activeRecord]);
  const selectedFields = fields.fields.filter((field) => Object.values(selections).includes(JSON.stringify(field.path)));
  const sourceFields = selectedFields.length ? selectedFields : fields.fields.slice(0, 4);

  function invalidate() { setValidated(null); setActiveRecord(null); setPage(0); }
  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input) return;
    setValidated({ input, result: validateMapping(input) });
    setActiveRecord(null); setPage(0);
    requestAnimationFrame(() => summaryHeading.current?.focus());
  }
  function showRecord(recordIndex: number) {
    setActiveRecord(recordIndex);
    requestAnimationFrame(() => inspectionHeading.current?.focus());
  }

  if (!identity) return <p role="alert" className="mapping-error">Secure ID generation is unavailable in this browser. Try a current browser; no questions have been created.</p>;
  return <>
    <form onSubmit={validate} noValidate>
      <div className="mapping-grid">
        <aside className="mapping-source" aria-labelledby="mapping-source-title">
          <p className="eyebrow">Source</p>
          <h2 id="mapping-source-title">Your data</h2>
          <p className="source-origin">Source: {option.source.originalFilename ?? option.source.label ?? "JSON file"}</p>
          <p className="section-help">{option.collection.records.length} {option.collection.records.length === 1 ? "record" : "records"} · {fields.fields.length} selectable fields</p>
          <p className="section-help">{selectedFields.length ? "Samples of your selected fields." : "A few fields to help you start. Select fields in the mapping controls to see their samples."}</p>
          {fields.truncated && <p className="mapping-error">Field discovery is limited to 200 fields and 100 nested levels. Reshape the source if a needed field isn't listed.</p>}
          <div className="source-samples">{sourceFields.map((field) => <div className="source-field" key={JSON.stringify(field.path)}>
            <h3>{fieldLabel(field.path)}</h3>
            {field.samples[0] && <SourceSample value={field.samples[0].value} />}
            {field.samples.length > 1 && <details><summary>More samples</summary>{field.samples.slice(1).map((sample) =>
              <div key={sample.recordIndex}><p className="sample-note">Record {sample.recordIndex + 1}</p><SourceSample value={sample.value} /></div>)}</details>}
          </div>)}</div>
        </aside>
        <section className="mapping-controls" aria-labelledby="map-fields-title">
          <p className="eyebrow">2 · Map fields</p>
          <h2 id="map-fields-title">Give your data meaning</h2>
          <p className="section-help">Choose each source field yourself. Required fields are marked below.</p>
          {targets.map((target) => {
            const errorCount = counts.get(target)?.size ?? 0;
            return <div className="mapping-field" key={target}>
              <label htmlFor={"map-" + target}>{TARGET_LABELS[target]} <span className="field-optional">{required.has(target) ? "(required)" : "(optional)"}</span></label>
              <select id={"map-" + target} className="mapping-control" value={selections[target]}
                required={required.has(target)} aria-invalid={errorCount > 0 || undefined}
                aria-describedby={errorCount ? "error-" + target : target === "externalId" ? "external-id-help" : undefined}
                onChange={(event) => { invalidate(); setSelections({ ...selections, [target]: event.currentTarget.value }); }}>
                <option value="">{required.has(target) ? "Choose a source field" : "Not mapped"}</option>
                {fields.fields.map((field) => <option key={JSON.stringify(field.path)} value={JSON.stringify(field.path)}>{fieldLabel(field.path)}</option>)}
              </select>
              {target === "externalId" && <p id="external-id-help" className="sample-note">Kept as source provenance, not a question's internal ID.</p>}
              {errorCount > 0 && <p id={"error-" + target} className="mapping-error">{errorCount} {errorCount === 1 ? "record needs" : "records need"} attention here. See final validation.</p>}
            </div>;
          })}
          <fieldset className="answer-mode">
            <legend>How is the correct answer stored? <span className="field-optional">(required)</span></legend>
            <p id="answer-mode-help" className="sample-note">Choose explicitly. Field names don't decide this.</p>
            {([
              ["zero-based-index", "Zero-based index", "0 is the first answer; 1 is the second."],
              ["one-based-index", "One-based index", "1 is the first answer; 2 is the second."],
              ["choice-text", "Exact answer text", "Matches answer text, including case and whitespace."],
            ] as const).map(([value, label, help]) => <label key={value} className="mode-option">
              <input type="radio" name="answer-mode" value={value} checked={mode === value} aria-describedby="answer-mode-help"
                onChange={() => { invalidate(); setMode(value); }} />
              <span><span>{label}</span><span className="mode-help">{help}</span></span>
            </label>)}
          </fieldset>
        </section>
        <section className="mapping-preview" aria-labelledby="mapping-preview-title">
          <p className="eyebrow">3 · Preview</p>
          <h2 id="mapping-preview-title">A first look</h2>
          <p className="section-help">First 3 attempted records only. A good preview doesn't guarantee the whole collection is valid.</p>
          {!preview && <p className="preview-empty">Map the three required fields and choose an answer mode to see your questions here.</p>}
          {preview?.records.map((record) => <QuestionPreview key={record.recordIndex} record={record} />)}
          {preview && preview.records.length === 0 && <p className="preview-empty">This collection has no records to preview.</p>}
        </section>
      </div>
      <section className="validation-step" aria-labelledby="validate-title">
        <p className="eyebrow">4 · Validate all records</p>
        <h2 id="validate-title">Check the complete study set</h2>
        <p className="section-help">Every selected record must pass. Nothing is saved or added to your library.</p>
        <div className="study-set-metadata">
          <div>
            <label htmlFor="study-set-title">Study set title <span className="field-optional">(required)</span></label>
            <input id="study-set-title" className="mapping-control" value={title} required
              aria-invalid={globalIssues.some((entry) => entry.target === "title") || undefined}
              aria-describedby={globalIssues.some((entry) => entry.target === "title") ? "validation-global-issues" : undefined}
              onChange={(event) => { invalidate(); setTitle(event.currentTarget.value); }} />
          </div>
          <div>
            <label htmlFor="study-set-description">Description <span className="field-optional">(optional)</span></label>
            <textarea id="study-set-description" className="mapping-control" rows={2} value={description}
              aria-invalid={globalIssues.some((entry) => entry.target === "description") || undefined}
              aria-describedby={globalIssues.some((entry) => entry.target === "description") ? "validation-global-issues" : undefined}
              onChange={(event) => { invalidate(); setDescription(event.currentTarget.value); }} />
          </div>
        </div>
        <button className="action" type="submit" disabled={!input} aria-describedby={!input ? "validation-help" : undefined}>Validate all records</button>
        {!input && <p id="validation-help" className="sample-note">Choose the three required source fields and an answer mode first.</p>}
      </section>
    </form>
    {validation && <section className={"validation-result " + (validation.status === "ready" ? "validation-ready" : "")} aria-labelledby="validation-summary-title">
      <div aria-live="polite" aria-atomic="true">
        <h2 id="validation-summary-title" ref={summaryHeading} tabIndex={-1}>{validation.status === "ready" ? "Study set ready" : "Final validation: needs attention"}</h2>
        <p className="validation-counts">{validation.inspectedCount} {validation.inspectedCount === 1 ? "record" : "records"} inspected · {validation.validCount} ready · {validation.invalidCount} {validation.invalidCount === 1 ? "needs" : "need"} attention</p>
        {validation.status === "ready"
          ? <><p>{validation.candidate.title} · {validation.candidate.questions.length} {validation.candidate.questions.length === 1 ? "question" : "questions"} · {validation.candidate.categories.length} {validation.candidate.categories.length === 1 ? "category" : "categories"}</p>
            <p className="section-help">Ready to save on this device. Leaving or reloading before saving loses this import.</p>
            <SaveStudySetButton studySet={validation.candidate} /></>
          : <p className="section-help">No complete study set has been created. Adjust the mapping, or correct the original file and upload it again.</p>}
      </div>
      {globalIssues.length > 0 && <ul id="validation-global-issues" className="preview-problems">{globalIssues.map((entry, index) =>
        <li key={index}>{entry.message}{entry.target === "title" && <> <a href="#study-set-title">Edit title</a></>}{entry.target === "description" && <> <a href="#study-set-description">Edit description</a></>}</li>)}</ul>}
      {recordIssues.length > 0 && <>
        <h3 className="issue-heading">Record issues</h3>
        <ul className="issue-counts">{[...counts].map(([target, records]) => <li key={target}>{TARGET_LABELS[target]}: {records.size} {records.size === 1 ? "record" : "records"}</li>)}</ul>
        <ul className="issue-list">{recordIssues.slice(page * ISSUE_PAGE_SIZE, (page + 1) * ISSUE_PAGE_SIZE).map((entry, index) => <li key={page * ISSUE_PAGE_SIZE + index}>
          <button type="button" onClick={() => showRecord(entry.recordIndex!)} aria-expanded={activeRecord === entry.recordIndex} aria-controls={inspected ? "record-inspection" : undefined}>
            <span className="issue-record">Record {entry.recordIndex! + 1} · {TARGET_LABELS[entry.target]}</span>
            <span>{entry.message}</span>
          </button>
        </li>)}</ul>
        {recordIssues.length > ISSUE_PAGE_SIZE && <div className="issue-pagination">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous issues</button>
          <p aria-live="polite">Page {page + 1} of {Math.ceil(recordIssues.length / ISSUE_PAGE_SIZE)}</p>
          <button type="button" disabled={(page + 1) * ISSUE_PAGE_SIZE >= recordIssues.length} onClick={() => setPage(page + 1)}>Next issues</button>
        </div>}
      </>}
      {inspected && <section id="record-inspection" className="record-inspection" aria-labelledby="record-inspection-title">
        <h3 id="record-inspection-title" ref={inspectionHeading} tabIndex={-1}>Inspect record {inspected.recordIndex + 1}</h3>
        <p className="section-help">Source values are unchanged. This is an inspection, not a record editor.</p>
        <ul className="preview-problems">{inspected.issues.map((entry, index) => <li key={index}>{TARGET_LABELS[entry.target]}: {entry.message}</li>)}</ul>
        <div className="inspection-grid">
          <div><h4>Mapped source values</h4>{targets.map((target) => {
            const value = inspected.values[target];
            return value ? <div className="source-field" key={target}>
              <h4>{TARGET_LABELS[target]} · {fieldLabel(value.path)}</h4>
              {value.present ? <SourceSample value={value.value!} /> : <p className="sample-note">Missing from this record.</p>}
            </div> : null;
          })}</div>
          <div><h4>Transformed preview</h4><QuestionPreview record={inspected} compact /></div>
        </div>
      </section>}
    </section>}
  </>;
}
