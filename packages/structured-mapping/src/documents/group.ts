import type { DocumentBlock, NormalizedDocument, PageTextBlock, TableBlock, TextBlock } from "@openstudy/import-core";
import type { DocumentQuestionCandidate, DocumentQuestions, Evidence, ReviewReason, SourceBlockRef, UngroupedContent } from "./contracts.js";

interface Unit {
  readonly text: string;
  readonly ref: SourceBlockRef;
  readonly kind: DocumentBlock["kind"];
  readonly list?: TextBlock["list"];
  readonly formatting?: boolean;
  readonly revisions?: boolean;
  readonly table?: TableBlock;
}
interface Draft {
  temporaryId: string;
  sourceBlockRefs: SourceBlockRef[];
  sourceNumber?: string;
  prompt: string;
  choices: { temporaryId: string; text: string; label?: string }[];
  category: string;
  explanation: string;
  evidence: Evidence[];
  reviewReasons: ReviewReason[];
  markers: { label: string; refs: SourceBlockRef[]; key: boolean }[];
}
const textOf = (block: DocumentBlock): string => block.kind === "table"
  ? block.rows.map((row) => row.cells.map((cell) => cell.blocks.map(textOf).join("\n")).join("\t")).join("\n")
  : block.kind === "page-text" ? block.items.map((item) => item.text + (item.hasLineBreak ? "\n" : "")).join("")
  : block.kind === "unsupported" ? block.description : block.runs.map((run) => run.text).join("");
const refOf = (block: DocumentBlock): SourceBlockRef => ({ blockKey: block.key, locator: block.locator });

/** Keep PDF paint order. Split only on source EOL or changed baseline, never sort columns. */
function pdfUnits(page: PageTextBlock): Unit[] {
  const units: Unit[] = [];
  let text = "";
  let first: PageTextBlock["items"][number] | undefined;
  let previous: PageTextBlock["items"][number] | undefined;
  function flush() {
    if (first && previous) units.push({ text, kind: "page-text", ref: {
      blockKey: page.key, locator: first.locator + (previous !== first ? "/through:" + previous.locator : ""), page: page.pageNumber,
    } });
    text = ""; first = undefined; previous = undefined;
  }
  for (const item of page.items) {
    if (previous && (previous.hasLineBreak || previous.transform[5] !== item.transform[5])) flush();
    first ??= item;
    text += item.text;
    previous = item;
  }
  flush();
  return units;
}
function docxUnits(blocks: readonly DocumentBlock[]): Unit[] {
  return blocks.map((block) => ({
    text: textOf(block), ref: refOf(block), kind: block.kind,
    ...(block.kind === "table" ? { table: block } : {}),
    ...(block.kind === "paragraph" || block.kind === "heading" || block.kind === "list-item"
      ? { ...(block.list ? { list: block.list } : {}), formatting: block.runs.some((run) => run.bold || run.italic || run.underline),
        revisions: block.runs.some((run) => run.revision) } : {}),
  }));
}
const numbered = (text: string) => text.match(/^\s*(\d+)[.)]\s+([\s\S]+)$/u);
const questionHeading = (text: string) => text.match(/^\s*Question\s+(\d+)\s*[:.)-]?\s*([\s\S]*)$/iu);
const choice = (text: string) => text.match(/^\s*([A-Z])[.)]\s*([\s\S]*)$/u);
const numericChoice = (text: string) => text.match(/^\s*(\d+)[.)]\s+([\s\S]+)$/u);
const answer = (text: string) => text.match(/^\s*(?:Correct answer|Answer)\s*:\s*([A-Z]|\d+)\s*[.)]?\s*$/iu);
const explanation = (text: string) => text.match(/^\s*Explanation\s*:\s*([\s\S]+)$/iu);
const isKeyHeading = (text: string) => /^\s*Answer key\s*[:.]?\s*$/iu.test(text);
const keyEntry = (text: string) => text.match(/^\s*(\d+)\s*[.):=-]\s*([A-Z]|\d+)\s*[.)]?\s*$/iu);
const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];

/** Format-specific units feed shared conservative structural grouping, not semantic inference. */
export function extractDocumentQuestions(document: NormalizedDocument): DocumentQuestions {
  const pdf = document.sourceDocument.format === "pdf";
  const units = pdf ? document.blocks.flatMap((block) => block.kind === "page-text" ? pdfUnits(block)
    : [{ text: textOf(block), kind: block.kind, ref: refOf(block) }]) : docxUnits(document.blocks);
  const drafts: Draft[] = [];
  const used = new Set<string>();
  const ungrouped: UngroupedContent[] = [];
  const keys: { number: string; label: string; ref: SourceBlockRef }[] = [];
  let current: Draft | undefined;
  let section: Unit | undefined;
  let keyMode = false;
  let choicesList: TextBlock["list"] | undefined;
  function add(draft: Draft, unit: Unit) {
    draft.sourceBlockRefs.push(unit.ref); used.add(unit.ref.locator);
    if (unit.formatting) draft.evidence.push("formatting-present");
    if (unit.revisions) draft.reviewReasons.push("source-revisions");
  }
  function start(unit: Unit, prompt: string, number?: string): Draft {
    choicesList = undefined;
    const draft: Draft = {
      temporaryId: "candidate:" + unit.ref.locator, sourceBlockRefs: [], prompt, choices: [], category: section?.text ?? "",
      explanation: "", evidence: number === undefined ? [] : ["explicit-question-number"],
      reviewReasons: [
        ...(pdf ? ["pdf-reading-order" as const] : []),
        ...(section ? ["category-suggestion" as const] : []),
        ...(document.warnings.includes("unsupported-content") || document.warnings.includes("omitted-docx-parts")
          ? ["unsupported-content" as const] : []),
      ], markers: [], ...(number === undefined ? {} : { sourceNumber: number }),
    };
    if (section) add(draft, section);
    add(draft, unit); drafts.push(draft); return draft;
  }
  function addChoice(draft: Draft, unit: Unit, label: string | undefined, text: string) {
    if (draft.choices.some((entry) => label !== undefined && entry.label === label)) draft.reviewReasons.push("ambiguous-choices");
    draft.choices.push({ temporaryId: draft.temporaryId + ":choice:" + draft.choices.length, text,
      ...(label === undefined ? {} : { label }) });
    draft.evidence.push(label ? "labeled-choices" : "contiguous-choice-list");
    add(draft, unit);
  }
  function table(unit: Unit) {
    const block = unit.table!;
    const headers = block.rows[0]?.cells.map((cell) => cell.blocks.map(textOf).join("\n").trim()) ?? [];
    const rectangular = block.rows.every((row) => row.cells.length === headers.length && row.cells.every((cell) =>
      cell.columnSpan === 1 && cell.verticalMerge === undefined && cell.blocks.every((child) =>
        child.kind === "paragraph" || child.kind === "list-item" || child.kind === "heading")));
    if (keyMode && rectangular && headers.length === 2 && /^(Question|Number)$/iu.test(headers[0] ?? "")
      && /^(Answer|Correct)$/iu.test(headers[1] ?? "")) {
      used.add(unit.ref.locator);
      for (const row of block.rows.slice(1)) {
        const number = row.cells[0]!.blocks.map(textOf).join("\n").trim();
        const label = row.cells[1]!.blocks.map(textOf).join("\n").trim().toUpperCase();
        const ref = { blockKey: block.key, locator: row.locator };
        if (/^\d+$/u.test(number) && /^([A-Z]|\d+)$/u.test(label)) keys.push({ number, label, ref });
        else ungrouped.push({ ref, text: row.cells.map((cell) => cell.blocks.map(textOf).join("\n")).join("\t"), reason: "unmatched-answer-key" });
      }
      return;
    }
    const labels = headers.slice(1, -1);
    if (!keyMode && rectangular && /^Question$/iu.test(headers[0] ?? "") && /^Correct$/iu.test(headers.at(-1) ?? "")
      && labels.length >= 2 && labels.every((label, index) => label === String.fromCharCode(65 + index))) {
      used.add(unit.ref.locator);
      for (const row of block.rows.slice(1)) {
        const cellTexts = row.cells.map((cell) => cell.blocks.map(textOf).join("\n"));
        const raw = cellTexts[0]!;
        const match = numbered(raw) ?? questionHeading(raw);
        const rowUnit = { ...unit, ref: { blockKey: block.key, locator: row.locator } };
        const draft = start(rowUnit, match?.[2] ?? raw, match?.[1]);
        draft.evidence.push("explicit-question-table");
        labels.forEach((label, index) => {
          const cell = row.cells[index + 1]!;
          addChoice(draft, { ...unit, ref: { blockKey: block.key, locator: cell.locator } }, label, cellTexts[index + 1]!);
        });
        const correct = row.cells.at(-1)!;
        if (cellTexts.at(-1)!.trim()) draft.markers.push({ label: cellTexts.at(-1)!.trim().toUpperCase(),
          refs: [{ blockKey: block.key, locator: correct.locator }], key: false });
      }
      return;
    }
    used.add(unit.ref.locator);
    ungrouped.push({ ref: unit.ref, text: unit.text, reason: "unsupported-table" });
  }
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const text = unit.text;
    if (!/\S/u.test(text)) continue;
    if (isKeyHeading(text)) { keyMode = true; current = undefined; used.add(unit.ref.locator); continue; }
    if (unit.table) { current = undefined; table(unit); continue; }
    if (keyMode) {
      const entry = keyEntry(text);
      if (entry) { keys.push({ number: entry[1]!, label: entry[2]!.toUpperCase(), ref: unit.ref }); used.add(unit.ref.locator); }
      else { used.add(unit.ref.locator); ungrouped.push({ ref: unit.ref, text, reason: "unmatched-answer-key" }); }
      continue;
    }
    const heading = questionHeading(text);
    const numberedPrompt = numbered(text);
    const labeled = choice(text);
    const listChoice = current && unit.kind === "list-item"
      && (!units[i - 1]?.list || !unit.list || !choicesList || (choicesList.key === unit.list.key && choicesList.level === unit.list.level))
      && (!units[i - 1]?.list || (unit.list?.level ?? 0) > (units[i - 1]?.list?.level ?? 0) || current.choices.length > 0);
    const marker = answer(text);
    const explain = explanation(text);
    if (current && marker) {
      current.markers.push({ label: marker[1]!.toUpperCase(), refs: [unit.ref], key: false });
      add(current, unit); continue;
    }
    if (current && explain) { current.explanation = explain[1]!; add(current, unit); continue; }
    if (current && (labeled || listChoice)) {
      const match = labeled ?? numericChoice(text);
      if (current.markers.length || current.explanation) current.reviewReasons.push("ambiguous-choices");
      choicesList ??= unit.list;
      addChoice(current, unit, match?.[1], match?.[2] ?? text); continue;
    }
    if (heading || numberedPrompt) {
      const match = heading ?? numberedPrompt!;
      current = start(unit, match[2]!, match[1]);
      if (!/\S/u.test(current.prompt) && units[i + 1] && !choice(units[i + 1]!.text)
        && !numbered(units[i + 1]!.text) && !questionHeading(units[i + 1]!.text)
        && !answer(units[i + 1]!.text) && !explanation(units[i + 1]!.text) && !isKeyHeading(units[i + 1]!.text)
        && (units[i + 1]!.kind === "paragraph" || units[i + 1]!.kind === "page-text")) {
        current.prompt = units[i + 1]!.text; add(current, units[++i]!);
      }
      continue;
    }
    if (unit.kind === "heading") { section = unit; current = undefined; continue; }
    // Plain prompt requires an immediately following labeled alternative or actual list role.
    const next = units[i + 1];
    if (!labeled && next && (choice(next.text) || next.kind === "list-item")) {
      if (current && current.choices.length === 0) {
        current.reviewReasons.push("ambiguous-boundary"); add(current, unit);
      } else {
        const previous = current;
        current = start(unit, text);
        if (previous && previous.markers.length === 0) {
          previous.reviewReasons.push("ambiguous-boundary"); current.reviewReasons.push("ambiguous-boundary");
        }
      }
      continue;
    }
    if (current) { current.reviewReasons.push("ambiguous-boundary"); add(current, unit); }
  }
  const byNumber = new Map<string, Draft[]>();
  for (const draft of drafts) {
    if (draft.sourceNumber === undefined) continue;
    const group = byNumber.get(draft.sourceNumber) ?? []; group.push(draft); byNumber.set(draft.sourceNumber, group);
  }
  for (const group of byNumber.values()) if (group.length > 1) group.forEach((draft) => draft.reviewReasons.push("duplicate-question-number"));
  const byKeyNumber = new Map<string, typeof keys>();
  for (const entry of keys) {
    const entries = byKeyNumber.get(entry.number) ?? []; entries.push(entry); byKeyNumber.set(entry.number, entries);
  }
  for (const [number, entries] of byKeyNumber) {
    const group = byNumber.get(number);
    if (group?.length === 1 && entries.length === 1) group[0]!.markers.push({ label: entries[0]!.label, refs: [entries[0]!.ref], key: true });
    else {
      for (const entry of entries) ungrouped.push({ ref: entry.ref, text: number + ". " + entry.label, reason: "unmatched-answer-key" });
      // An orphan key stays ungrouped; only candidates with this number are affected.
      for (const draft of group ?? []) draft.reviewReasons.push("unmatched-answer-key");
    }
  }
  if (keyMode) for (const draft of drafts) {
    if (draft.sourceNumber === undefined || !byKeyNumber.has(draft.sourceNumber)) draft.reviewReasons.push("unmatched-answer-key");
  }
  for (const unit of units) if (!used.has(unit.ref.locator) && /\S/u.test(unit.text)) {
    ungrouped.push({ ref: unit.ref, text: unit.text, reason: "unrecognized-structure" });
  }
  // Shared section context is intentional; overlapping question/choice units are not.
  const owners = new Map<string, Draft>();
  const sectionLocators = new Set(units.filter((unit) => unit.kind === "heading" && !questionHeading(unit.text)).map((unit) => unit.ref.locator));
  for (const draft of drafts) for (const ref of draft.sourceBlockRefs) {
    if (sectionLocators.has(ref.locator)) continue;
    const other = owners.get(ref.locator);
    if (other && other !== draft) { other.reviewReasons.push("source-overlap"); draft.reviewReasons.push("source-overlap"); }
    owners.set(ref.locator, draft);
  }
  const candidates = drafts.map<DocumentQuestionCandidate>((draft) => {
    const labels = draft.choices.map((entry) => entry.label);
    if (labels.some((label) => label !== undefined) && !labels.every((label, index) =>
      label === (/^\d+$/u.test(labels[0] ?? "") ? String(index + 1) : String.fromCharCode(65 + index)))) {
      draft.reviewReasons.push("ambiguous-choices");
    }
    let correctChoiceId: string | undefined;
    if (draft.markers.length > 1) draft.reviewReasons.push("multiple-answer-markers");
    else if (draft.markers[0]) {
      const marker = draft.markers[0];
      const matching = draft.choices.filter((entry) => entry.label === marker.label);
      if (matching.length === 1) { correctChoiceId = matching[0]!.temporaryId; draft.evidence.push(marker.key ? "explicit-answer-key-match" : "explicit-answer-marker"); }
      else draft.reviewReasons.push("unmatched-answer-key");
    }
    for (const marker of draft.markers) draft.sourceBlockRefs.push(...marker.refs);
    const { markers: _markers, ...rest } = draft;
    return { ...rest, sourceBlockRefs: [...new Map(draft.sourceBlockRefs.map((ref) => [ref.locator, ref])).values()],
      evidence: unique(draft.evidence), reviewReasons: unique(draft.reviewReasons), confirmed: false, excluded: false,
      ...(correctChoiceId === undefined ? {} : { correctChoiceId }) };
  });
  return { sourceDocument: document.sourceDocument, candidates, ungrouped };
}

/** Original source preview is always read from ExtractedDocument, never edited drafts. */
export { textOf as documentBlockText };
