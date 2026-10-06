import type { ChangeEventHandler, ReactNode, Ref } from "react";

/** Visual structure only. Each mode owns its configuration and transitions. */
export function StudySetup({ mode, title, description, headingRef, prefix, categories, categoryId,
  onCategoryChange, count, onCountChange, countInvalid, available, unit, countHelp, countError,
  children }: {
  mode: string; title: string; description: string; headingRef: Ref<HTMLHeadingElement>;
  prefix: string; categories: readonly { id: string; label: string }[]; categoryId: string | null;
  onCategoryChange: ChangeEventHandler<HTMLSelectElement>; count: string;
  onCountChange: ChangeEventHandler<HTMLInputElement>; countInvalid: boolean;
  available: number; unit: "question" | "card"; countHelp: string; countError?: string | undefined;
  children: ReactNode;
}) {
  return <section className="study-setup">
    <h1 ref={headingRef} tabIndex={-1}>{mode} <span className="setup-set-title">“{title}”</span></h1>
    <p className="setup-description">{description}</p>
    <div className="setup-panel">
      <div className="setup-fields">
        <div>
          <label htmlFor={`${prefix}-category`}>Topic / category</label>
          <select id={`${prefix}-category`} className="study-control" value={categoryId ?? ""} onChange={onCategoryChange}>
            <option value="">All topics</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
          </select>
          <p className="field-help">{available} {unit}{available === 1 ? "" : "s"} available</p>
        </div>
        <div>
          <label htmlFor={`${prefix}-count`}>{unit === "card" ? "Cards" : "Questions"}</label>
          <input id={`${prefix}-count`} className="study-control" type="number" min={1} max={available} step={1}
            value={count} aria-invalid={countInvalid || undefined} aria-describedby={`${prefix}-count-help${countError ? ` ${prefix}-count-error` : ""}`}
            onChange={onCountChange} />
          <p id={`${prefix}-count-help`} className="field-help">{countHelp}</p>
          {countError && <p id={`${prefix}-count-error`} className="field-error">{countError}</p>}
        </div>
      </div>
      <div className="setup-actions">{children}</div>
    </div>
  </section>;
}

export function StudySessionFrame({ mode, title, exit, children }: {
  mode: string; title: string; exit: ReactNode; children: ReactNode;
}) {
  return <div className="study-session" data-study-session="">
    <div className="session-topline">
      <p className="session-context"><strong>{mode}</strong><span>{title}</span></p>
      {exit}
    </div>
    {children}
  </div>;
}

export function StudyProgress({ id, label, current, total }: {
  id: string; label: "Question" | "Card" | "Mistake"; current: number; total: number;
}) {
  return <div className="study-progress">
    <p id={id}>{label} {current} of {total}</p>
    <progress max={total} value={current} aria-label={`${label} position`} aria-valuetext={`${current} of ${total}`} />
  </div>;
}

function answerLetter(index: number): string {
  let letter = "";
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) {
    letter = String.fromCharCode(65 + (number - 1) % 26) + letter;
  }
  return letter;
}

export function AnswerOption({ id, text, index, name, checked, onChange, feedback }: {
  id: string; text: string; index: number; name: string; checked: boolean;
  onChange: () => void; feedback?: "wrong" | "correct" | undefined;
}) {
  return <label className="answer-option" data-feedback={feedback}>
    <input type="radio" name={name} value={id} checked={checked} onChange={onChange} />
    <span className="answer-text"><span className="answer-letter" aria-hidden="true">{answerLetter(index)}</span>{text}
      {feedback === "wrong" && <span className="answer-feedback">Incorrect selection</span>}
      {feedback === "correct" && <span className="answer-feedback">Correct answer</span>}
    </span>
  </label>;
}
