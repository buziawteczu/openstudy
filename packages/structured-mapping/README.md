# `@openstudy/mapping`

Pure structured-record transformation and document-question review between the
neutral `@openstudy/import-core` boundary and authoritative `@openstudy/schema`
validation. React, file parsers, binary document extraction, storage, and crypto
are not dependencies of this package.
The folder is `structured-mapping`; the public workspace name is
`@openstudy/mapping`.

## Input and declarative mapping

The caller supplies an already-normalized, resource-bounded `RecordCollection`,
its `SourceDescriptor`, metadata, and an application-owned `MappingIdentity`.
It must not pass arbitrary runtime objects or document blocks as records.

```ts
const definition: MappingDefinition = {
  collectionKey: "records:/questions",
  promptPath: ["question", "text"],
  choicesPath: ["answers"],
  correctAnswer: {
    path: ["correct"],
    mode: "zero-based-index",
  },
  categoryPath: ["metadata", "chapter"],
  explanationPath: ["explanation"],
  externalIdPath: ["recordId"],
};
```

Paths are explicit object-key segment arrays. `["question.text"]` is distinct
from `["question", "text"]`; dots, slashes, empty keys, and prototype-like names
stay literal data. Only own data properties are read, never inherited properties
or accessors. Arrays are leaves, not index expressions. No expressions, functions,
semantic field inference, presets, or persistence are supported.

`discoverFields` scans a collection once, retains at most 200 selectable paths
and three original present samples per path, and traverses at most 100 object-key
segments. It reports `truncated` rather than pretending the list is complete.
Missing and explicit null remain distinct. These are discovery/UI limits,
not permission to skip source records during validation. Source parsing budgets
remain upstream. `fieldLabel` displays ordinary dotted paths and JSON-quoted
brackets for unusual keys.

## Supported targets and interpretation

- Required: textual question, array of non-blank answer strings, correct answer.
- Optional: one textual topic/category, explanation, and provenance external ID.
- Optional fields may be missing on individual records; present null, blank,
  numbers, arrays, and objects are invalid text, not silently omitted/coerced.
- Answer index modes require actual safe integer numbers, never numeric strings.
  Zero-based mode uses `0` for the first answer; one-based mode uses `1`.
- Exact answer-text mode performs no trimming, case folding, Unicode
  normalization, or fuzzy matching. Multiple matching answer labels are an
  ambiguity, not permission to select the first.
- Structured choice objects and source-choice-value/ID matching are deliberately
  unsupported in V1. Duplicate answer labels are allowed with an explicit index.

Internal IDs are never mapping targets. Imported external IDs remain
`Question.provenance[].externalId`; they are not canonical question identity.

## APIs and validation

`previewMapping(input)` transforms the first three **attempted** records,
including failures. It is not proof that later records are valid.
`inspectRecord(input, index)` gives original mapped values, contextual issues,
and a supported partial display for one record, without scanning the dataset.
Neither API returns a partial StudySet.

`validateMapping(input)` explicitly processes every selected record:

1. Check the collection/mapping/identity configuration.
2. Read mapped values without modifying the source.
3. Resolve the explicitly chosen correct-answer semantics.
4. Validate each proposed question with `QuestionSchema`; category labels use
   the canonical `NonBlankTextSchema`.
5. Only if every record passes, assemble the StudySet and call `StudySetSchema`.

Success is `{ status: "ready", candidate, inspectedCount, validCount,
invalidCount, issues: [] }`. Any failure is `{ status: "invalid", ... }`
**without a candidate property**. Empty collections and unexpected whole-set
validation failures become structured issues, not crashes. Valid records are
counted but never silently imported as a subset.

`MappingIssue` contains a zero-based `recordIndex` (or null for configuration/
whole-set errors), target, machine code, and concise message. Canonical issue
paths are translated into target labels; redundant schema messages are grouped.
The UI uses human-readable 1-based record numbers, counts affected records by
target, paginates ten issue messages at a time, and inspects records on demand.

## Canonical identity, categories, and provenance

The web import-session utility obtains 16 bytes from platform
`crypto.getRandomValues` once per selected collection. Its lowercase 32-hex
namespace is application-owned, never selected from source fields. Crypto
failure blocks candidate creation; there is no `Math.random`/timestamp fallback
or UUID library.

The pure transformer creates portable IDs under `os:<namespace>:` with distinct
`set`, `source`, `q:<recordIndex>`, `q:<recordIndex>:c:<choiceIndex>`, and
`category:<firstOccurrenceRecordIndex>` suffixes. A random namespace means
indexes are not identities by themselves. Question/choice IDs remain stable
across preview, inspection, and validation in that session, independent of
question text; separate imports intentionally create new identity.

The category registry uses exact labels and first-occurrence order. Repeated
labels share an opaque category ID; case/whitespace variants remain distinct.
On-demand invalid-record inspection has a local category registry, so its
category ID is not a promised final registry identity. Displayed labels remain
faithful; only the complete validation result is canonical.

One selected collection creates one canonical Source, including its original
JSON filename or safe normalized ZIP entry name. Unselected ZIP entries are
not merged. Questions reference that Source plus a collection/zero-based-record
locator and optional mapped external ID. Parser/adapter metadata and source
field names do not leak into the StudySet.

New candidates use `CURRENT_SCHEMA_VERSION`, revision `1`, an editable title,
and optional description. They exist only in the `/import` component session.
Changing configuration invalidates the result; choosing another collection/file
or leaving/reloading discards it. No Library entry, save action, durable state,
deduplication, progress, or study mode exists.

Identity preservation across future re-import/Add Material/update workflows
requires a separate reviewed lifecycle decision. This does not solve lineage
or trust arbitrary imported canonical IDs.

## Documents and development

DOCX/text-PDF existing questions use the focused `src/documents/` modules described
below. Documents never pass through structured field paths. No new workspace or
runtime dependency is required: reviewed-input-to-canonical transformation already
belongs to this boundary. Notes remain extraction-only.

### Document candidate contract and grouping

`extractDocumentQuestions(NormalizedDocument)` is pure and deterministic. It
returns `DocumentQuestions`: source descriptor, ordered temporary candidates,
and explicit ungrouped content. Candidates contain a source-location temporary ID,
source block references/opaque locators/pages, optional source number, prompt,
temporary choice IDs/text/optional literal labels, optional correct-choice
reference, editable category/explanation, evidence and review reasons.
`confirmed` and `excluded` are review decisions; candidates are not Questions.

DOCX rules:

- Literal `1. / 1)` numbered prompts and `Question 12` headings (the latter may
  introduce a following prompt paragraph).
- Plain prompt followed immediately by labeled alternatives or actual list items.
  Question-mark punctuation alone is never a boundary.
- Consecutive `A. / A)` labels or contiguous list roles; numeric alternatives
  require list structure. Automatic Word numbering labels are not resolved, so
  unlabelled list answers need manual correct-answer selection.
- Explicit rectangular unmerged `Question | A | B | ... | Correct` tables,
  one question per row. Other shapes remain ungrouped. Nested/merged arbitrary
  tables are not interpreted.
- Section headings can be editable category suggestions, requiring review.
  Intervening ambiguous prose remains source context, not invented answer text.

PDF rules preserve page/paint order, concatenate adjacent same-baseline items
without invented spaces, and split at extracted EOL or baseline changes. They do
not sort columns, reconstruct tables or recognize semantic headings. Numbered
prompts, labeled choices and explicit markers/key headings use shared structural
rules. All PDF candidates require source-order review, even when markers are
explicit; coordinates do not prove visual order.

Only `Correct answer: B / Answer: B` or an explicit Correct table cell selects an
answer with a unique literal label. `Answer key` introduces exact-number entries
such as `1. B`, or an explicit `Question/Number | Answer/Correct` table.
Numbering is matched exactly, never fuzzily or by entry order. Multiple markers
(even agreeing), duplicate question/key numbers, missing/unmatched numbers and
unresolvable labels remain flagged/unresolved; malformed/unmatched keys stay
visible in ungrouped content. Formatting never proves correctness.

Evidence is a small enum with no confidence scores; review reasons include
ambiguous boundaries/choices, duplicate numbers, key issues, PDF order,
category suggestions, revisions, unsupported extraction and source overlap.
Source text/runs remain unchanged upstream; candidate presentation strips explicit
labels only. The UI reads original `ExtractedDocument` separately for comparison.
Grouping uses no random/time/network/environment inputs.

### Review and final validation APIs

`createReviewSession` and `reviewReducer` implement scoped immutable editing,
navigation, correct-answer selection, confirmation, exclusion, and ungrouped
acknowledgement. Temporary IDs survive edits; added choice IDs use a monotonic
session-local counter, not canonical identity. Edits clear confirmation. Adding
is capped at 20 answers; extraction never truncates existing answers. Oversized
candidates remain incomplete until the user explicitly removes excess answers.

`inspectCandidate` classifies ready / needs-review / incomplete / ignored and
returns field-targeted readable issues. Missing answers require selection;
blank prompts/choices or fewer than two answers are incomplete. Optional category/
explanation use exact text, with empty string meaning cleared. Every included
candidate requires explicit confirmation after the latest correction, including
acknowledging source uncertainties. Excluded candidates retain their entire draft
but do not block readiness; un-exclusion restores normal checks.

`reviewCounts` reports total/reviewed/included/excluded/unresolved.
`finalizeDocumentReview(session, identity, title)` checks all included drafts,
ungrouped acknowledgement, nonempty questions and metadata before assembly.
It calls `QuestionSchema` per included question and `StudySetSchema` for the whole
set. Failure has issues but no partial candidate. All excluded/zero detected
questions cannot create an empty ready StudySet.

Canonical IDs reuse `canonicalId` from structured mapping:
`os:<128-bit namespace>:set/source/q:<position>/q:<position>:c:<choice>/category:<first position>`.
The browser generates the namespace only on explicit final validation, not during
document grouping/editing. Exact category labels share first-occurrence registry
IDs; source numbers/text/locators are never canonical identity. Source order and
original positions (including exclusion gaps) are preserved. Provenance uses
one existing `{sourceId, locator}` entry per contributing block/row/cell/PDF item
range, including answer-key markers and suggested sections. Locators are opaque,
source-local, parser-version-dependent; multiple entries can share one source.
No schema change or detailed document data is embedded in canonical Questions.

The frontend renders one candidate editor, an expandable original source
(open by default on wide desktop), previous/next and next-unresolved navigation.
Ungrouped content is paginated and requires explicit acceptance of omission.
Unrecognized missing questions must be corrected in the source and re-uploaded;
this is not a general document editor or arbitrary-document understanding.
Reload/navigation/file/intent reset loses decisions; no persistence/autosave exists.

Repository `typecheck`, `test`, `build`, and `verify` include this workspace.
Source aliases support checks before generated `dist` exists; workspace build
ordering builds schema/import-core before this package. Unit tests use the
existing Node/tsx toolchain, including a 10,000-record validation check.
There are no new third-party runtime dependencies.
