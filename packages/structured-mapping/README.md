# `@openstudy/mapping`

Pure structured-record transformation between the neutral `@openstudy/import-core`
boundary and authoritative `@openstudy/schema` validation. React, file parsers,
document extraction, storage, and crypto are not dependencies of this package.
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

DOCX/PDF remain at neutral extraction with a truthful next-step message.
Document question extraction/review must later consume document blocks and their
locators/warnings, not force paragraphs through these field paths.

Repository `typecheck`, `test`, `build`, and `verify` include this workspace.
Source aliases support checks before generated `dist` exists; workspace build
ordering builds schema/import-core before this package. Unit tests use the
existing Node/tsx toolchain, including a 10,000-record validation check.
There are no new third-party runtime dependencies.
