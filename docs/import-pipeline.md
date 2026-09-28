# Import pipeline

## Purpose

The import pipeline converts untrusted external material into a validated canonical StudySet candidate. It is separate from persistence and study behavior.

The implemented local inputs are JSON, ZIP containing JSON, DOCX, and PDF with
selectable text. JSON/ZIP record collections now support explicit mapping and
complete canonical validation into an in-memory StudySet candidate. DOCX/PDF
stop at neutral extraction. Persistence, study, and document question review
remain future work.

## Implemented neutral boundary (`@openstudy/import-core`)

Conceptual PR 4 established contracts and inspection. Conceptual PR 5 adds
local JSON/ZIP ingestion at `/import` and a format-neutral record-array adapter.
Conceptual PR 6 adds document contracts, DOCX extraction, and text-PDF extraction.
Conceptual PR 7 adds structured mapping in `@openstudy/mapping`; import-core
itself stays neutral. Documents are not StudySets or structured record arrays.

| Stage | Representation and owner |
| --- | --- |
| Raw source | User file/binary/archive; ingestion/extraction owns reading and safety. No raw-file API in import-core. |
| Normalized structured source | `NormalizedStructuredSource`: upstream `SourceDescriptor` plus nested serializable `SourceValue`; already read/extracted, not canonical content. |
| Mapping candidate | `MappingCandidate`: source descriptor, adapter ID, and explicit `RecordCollection[]`; source field names/values remain opaque data. |
| Canonical candidate / StudySet | `@openstudy/mapping` explicitly transforms the chosen structured collection and calls canonical validation; only an all-valid candidate exists in memory. Persistence and study remain deferred. |

The structured path is therefore:

```text
raw input -> ingestion/extraction -> normalized structured source
          -> structured adapter -> neutral mapping candidate + inspection
          -> reviewed mapping -> canonical candidate -> schema validation
          -> explicit lifecycle/persistence decision -> study
```

`StructuredSourceAdapter.inspect` recognizes an already-normalized structure and
returns `ImportResult<MappingCandidate>`. It preserves the source descriptor and
reports its adapter ID. It may identify source-specific record collections but
must not interpret question semantics, generate canonical IDs, or access I/O.
The production `structuredRecordsAdapter` discovers object-only arrays (including
empty arrays) at the root or through nested containers. It stops at each record
collection, leaving nested record fields intact. Mixed arrays are not filtered;
primitive data or standalone objects without record arrays are unsupported.
No field name, including `questions`, `answers`, or `correctIndex`, is interpreted.
Escaped JSON-pointer collection keys are temporary locators. No registry is added.

`inspectMappingCandidate` validates an explicitly supplied neutral candidate and
reports collection counts, top-level field presence/types, and the first three
present sample values with record indexes. Nested values remain intact, so later
mapping can inspect them without premature stringification. No collection is
automatically selected for questions. Empty collections remain visible; a
candidate with no collections is a typed failure. Missing fields and explicit
null values are different.

Only finite numbers, strings, booleans, null, dense arrays, and plain data objects
are normalized source values. Inspection rejects non-serializable values and
returns detached snapshots without mutating the caller. Field/type ordering is
locale-independent; collection and sample ordering follows the supplied input.
Expected failures use `unsupported-source`, `no-record-collection`, or
`invalid-normalized-data` with machine-readable context, not UI error copy.

Source/collection `key` values are temporary import-local tokens. Collection
keys are unique within a candidate; records use local array positions rather
than invented IDs. Neither keys nor source fields named `id` are canonical
StudySet/Question/Choice IDs or deduplication evidence. Adapter/format/media-type
metadata stays upstream and is not automatically copied into canonical Source.

The web ingestion modules own file reading, UTF-8/JSON parsing, and archive budgets.
Each JSON file/entry supplies one normalized source and mapping candidate;
summary counts are aggregated, but candidates are not merged or canonicalized.
Even a `schemaVersion` field remains opaque at this stage. The later canonical
import path must explicitly validate/migrate declared canonical material; generic
collection discovery is not a substitute for that boundary.

DOCX/PDF extraction retains `SourceDocument`, `ExtractedDocument`, and
`NormalizedDocument` representations. Future reviewed mapping may project suitable
tables into the structured boundary; paragraphs/pages are not forced into record
arrays. Study continues to consume validated canonical data only.

See [the import-core README](../packages/import-core/README.md) and
[the structured-mapping README](../packages/structured-mapping/README.md) for
the public contracts.

## V1 structured import

### Implemented local ingestion

`apps/web/src/import` contains `ingest-file.ts` (FileReader/orchestration),
`json.ts` (native parse and bounded normalization), `zip.ts` (archive checks and
streamed extraction), `limits.ts` (tunable budgets), and `errors.ts` (typed failures
and UI messages). Browser APIs do not enter import-core. Vite/TypeScript resolve
the workspace's public source entry so clean-checkout checks do not require a
pre-existing package `dist` directory.

The picker supports `.docx`, `.pdf`, `.json` and `.zip`, case-insensitively; MIME hints are not
trusted. Raw sizes are checked before reading. JSON is decoded as strict UTF-8
(an initial UTF-8 BOM is tolerated) and parsed once with `JSON.parse`; non-finite
numbers, excessive depth, or excessive node count fail before inspection. Field
names, nested structures, and values are preserved, not flattened or mapped.

All file processing is on-device, in memory. No upload, backend, external API,
analytics, storage, or AI is used. ZIP code is bundled with the app, not fetched
when selecting a source. Browser tests block network requests after app load and
exercise both file types. Loading the app initially is separate from ingestion;
this PR does not add an offline-installable PWA or service worker.

Idle, reading, success, and error states use a labeled native picker, a polite
status region, and error alerts. Cancel/reset aborts ongoing reads/extraction;
reset clears the input and restores focus so the same file can be selected again.
Success says **Ready for mapping**, with file/collection/record counts and no
Continue button. Structured mapping follows below in the same `/import` session.
Nothing is added to the Library. Any invalid JSON entry fails
the entire attempt rather than silently returning a partial import.

### Implemented structured mapping and candidate boundary

```text
JSON/ZIP inspection -> explicit collection selection -> manual field mapping
  -> explicit answer interpretation -> first-three-record preview
  -> Validate all records -> contextual issues OR all-valid canonical candidate
  -> STOP (in memory; no save, Library entry, persistence, or study)
```

Ambiguous collections have no default selection; a sole collection may be
preselected. Unrelated collections/ZIP entries are never merged. Required
targets are Question, Answers, and Correct answer; optional targets are topic/
category, explanation, and source record ID. Title is editable (filename default),
description optional, and a new candidate uses revision `1`.

`MappingDefinition` contains `collectionKey`, `promptPath`, `choicesPath`,
`correctAnswer: { path, mode }`, and optional `categoryPath`, `explanationPath`,
`externalIdPath`. Paths are object-key segment arrays, not expressions or array
indexes. Nested objects and literal unusual keys are supported. Bounded discovery
lists at most 200 paths/100 levels, with an explicit truncation notice and three
source samples; it does not flatten or change the records.

Correct-answer mode must be explicitly selected: zero-based safe integer,
one-based safe integer, or exact choice text. No names decide semantics. Text
matching preserves case/whitespace and rejects multiple matching labels.
V1 choices are non-blank string arrays; heterogeneous/structured choices and
source-choice-value/ID matching are unsupported. Prompts are non-blank strings,
not coerced objects/numbers. Optional mapped values may be missing per record;
present blank/null/non-text values fail rather than being silently omitted.

The web session generates a cryptographic 128-bit opaque namespace per selected
collection; pure transformation adds entity/record/choice suffixes. No question
text or external record ID becomes canonical identity. Exact category labels
form a deterministic first-occurrence registry with generated IDs. Questions
reference one canonical Source for the selected JSON/ZIP entry, preserve its
filename, and carry a collection/record locator plus optional provenance
external ID. Identity preservation on re-import is future lifecycle work.

The live preview attempts only the first three records. Full validation runs
only on an explicit action, uses `QuestionSchema` for each mapped question,
and then calls `StudySetSchema` for the complete candidate. Issues retain source
record index, target, code, and concise copy. Valid/invalid record counts are
distinct from issue-message counts; navigation renders ten messages at a time
and retrieves original mapped values plus a transformed preview on demand.
All selected records must pass: no partial candidate or "import valid anyway".
Unexpected whole-candidate schema failures are structured errors.

React coordinates the flow but owns no answer-resolution/schema rules. State
stays scoped under `/import`; mapping/metadata changes invalidate prior
validation, and collection/file reset or navigation/reload loses the session.
Only the structured workflow widens the app shell to `78rem` (about 1248px);
desktop source/mapping/preview columns collapse into an ordered vertical flow
below `68rem`. Labels, native controls, a radio fieldset, linked errors,
polite final summary, deliberate summary/inspection focus, and visible focus
support keyboard operation. Live preview never moves focus.

DOCX/PDF never show this mapper. Their summary says question extraction and
review for documents will be added next. No document question extraction,
automatic/AI mapping, fuzzy matching, question deduplication, saved presets,
local storage, or study modes are implemented.

### Structured runtime dependency and browser baseline

Structured ingestion uses `@zip.js/zip.js` 2.18.2 (locked),
using the tree-shakable `lib/zip-core-native.js` entry point, not its filesystem
API or full WASM archive bundle. It supplies central-directory inspection,
streamed extraction, CRC-32 checks, and strict local-header/integrity checks.
Workers are explicitly disabled. Stored and DEFLATE ZIP entries are supported.
DEFLATE requires a modern browser with native `DecompressionStream("deflate-raw")`;
unsupported browsers receive a typed error and can still select plain JSON.
There is no downloaded fallback. See the [ZIP reader documentation](https://gildas-lormeau.github.io/zip.js/api/classes/ZipReader.html)
and [integrity/stream options](https://gildas-lormeau.github.io/zip.js/api/interfaces/EntryGetDataOptions.html).

The longer-term lifecycle below continues beyond the current in-memory stop:

```text
select file
    |
    v
type and safety checks
    |
    v
read JSON entries
    |
    v
detect candidate record collections
    |
    v
choose or confirm mapping
    |
    v
preview canonical candidates
    |
    v
validate
    |
    v
review issues and confirm import
    |
    v
commit StudySet revision to local persistence
```

### 1. Ingestion

The ingestion layer accepts a user-selected `.json` file or `.zip` containing JSON entries. It records source metadata and returns parseable inputs or understandable failures. It does not decide question semantics.

A file claiming to be JSON is still untrusted. File extensions, MIME hints, archive metadata, and parsed content can disagree.

### 2. Record collection detection

For canonical StudySet JSON, the schema location is known. For unfamiliar structured JSON, the importer may identify candidate arrays or record collections and ask the user to select one.

Detection is a convenience, not an authority. The product should say:

> Upload structured data and map it into the supported study format.

It should not promise that arbitrary JSON will work automatically.

### 3. Mapping

Mapping translates source fields and shapes into canonical candidate fields. For example:

| Source field | Canonical meaning |
| --- | --- |
| `questionText` | question prompt |
| `choices` | answer choices |
| `correctIndex` | correct answer reference |
| `chapter` | category |
| `explanation` | explanation |

Mapping must handle structural decisions such as nested fields and answer references, not only rename keys. Users should see sample source values beside their canonical preview.

The implemented V1 requires manual field choices and explicit answer semantics.
There are no automatic or AI suggestions. Optional assistants remain a separate
future capability; ambiguous mappings must never be silently finalized.

### 4. Canonical candidate creation

The mapping step produces an in-memory candidate in the current canonical shape. Source-specific names stop here. The candidate is not yet trusted or persisted.

Already-canonical files declare `schemaVersion`. Supported older versions are validated against their declared schema, passed through explicit migrations, and then validated against the current schema. Unversioned source data uses an importer or manual mapping; it is not guessed to be an old schema version.

### 5. Validation

Validation produces machine-readable issues with stable codes and locations, plus user-facing grouping. It should separate errors that block a record from warnings that require review.

Instead of exposing only:

```text
Invalid schema at $.questions[182]
```

the UI should be able to summarize:

```text
17 questions need attention
8 have no correct answer
5 contain fewer than two choices
4 reference an answer that does not exist
```

The underlying location still matters for diagnostics and navigation. It should not be the only explanation.

Current structured mapping requires all selected records to be valid. Partial
imports may be useful later, but confirmation, provenance, and retry semantics
remain unresolved. No invalid record is silently dropped.

### 6. Commit

This stage is not implemented. Future persistence happens only after explicit
confirmation and creates a new StudySet or an explicit StudySet revision.
Import previews and validation failures must not partially mutate durable
content or progress.

## ZIP safety

ZIP input is untrusted. Risks include:

- compression bombs and misleading compression ratios;
- excessive total extracted size;
- excessive entry count;
- nested archives;
- malformed or encrypted archives;
- duplicate or confusing entry names;
- path traversal names such as `../` or absolute paths if extraction ever reaches a filesystem;
- resource exhaustion during parsing;
- non-JSON content disguised as JSON.

Implemented tunable defaults in `apps/web/src/import/limits.ts` are:

| Limit | Configured value |
| --- | ---: |
| Single JSON file or extracted JSON entry | 10 MiB (10,485,760 bytes) |
| ZIP compressed size | 20 MiB (20,971,520 bytes) |
| Total uncompressed entries, including ignored files | 50 MiB (52,428,800 bytes) |
| Entry count, including directories/non-JSON/empty entries | 100 |
| Per-entry expansion ratio | 200:1, using `max(1, compressedSize)` |
| JSON depth | 100 edges from the root |
| JSON nodes | 200,000 values across the whole selection (all JSON entries) |
| Nested ZIP | unsupported |

These are implementation budgets, not permanent product guarantees. The ratio is
a heuristic that can reject legitimate repetitive JSON; an uncompressed ZIP or
plain JSON is a workaround. Mobile-device memory/performance still needs profiling.
Byte caps do not equal a JavaScript heap cap: decoded strings, parsed objects,
neutral inspection snapshots, and native decompressor buffers consume more memory.

The entry generator stops before retaining more than 100 entries. All names and
declared sizes are checked before extraction. Entries are then processed
sequentially into a bounded `WritableStream`, checking actual per-entry and total
output before retaining JSON chunks; non-JSON output is discarded. CRCs, output
size, overlapping entries, and local/central header agreement are checked by the
library. False underreported sizes are rejected as corrupt before their output
is retained. The library may allocate bounded input/central-directory buffers and
native output chunks before the sink sees them; these safeguards are not a claim
of a perfect hostile-input sandbox or zero transient allocation.

Only harmless empty directories are skipped. Non-JSON files still count against
limits and undergo integrity checks; their content is never rendered/executed.
Encrypted entries, symbolic links, split archives, unsupported compression, and
ambiguous/malformed metadata are rejected. Valid unsorted central directories are
allowed, and their entry order is retained. Nested archive extensions (ZIP, 7z,
RAR, TAR, gzip, bzip2, xz, zstd, and common variants) are rejected. ZIP/gzip/7z/RAR
magic also catches common disguised archives. This is not universal file-type
identification for every renamed archive format.

Paths are logical, never filesystem targets. Backslashes become `/`, Unicode is
normalized to NFC, and empty/`.` segments are removed. Absolute/UNC paths,
drive/colon paths, controls/NULs, `..` segments, and empty logical names fail.
Duplicate normalized names (including directories and ignored files) reject the
whole archive; no overwriting occurs. Comparison is case-sensitive because these
are in-memory logical names, not a Windows filesystem. Safe normalized names are
retained as source filenames; source keys are deterministic selection-local
`source:0`, `source:1`, etc., never canonical identity.

Expected failures are discriminated `IngestionResult` values. Codes distinguish
unsupported type/browser/archive entry, raw/per-entry size, read failure,
malformed JSON, JSON resource budgets, corruption, entry count, extracted size,
ratio, nested archives, duplicate names, unsafe paths, no JSON, no record
collection, and neutral inspection failure. Filename, entry, applicable limit,
and import-core failure context are retained internally where available; UI
copy is concise and never exposes stack traces. Cancellation rejects only to
the orchestrator and is not presented as an error.

## Adding material versus updating material

The user intent must be explicit.

### Add material

Adds new sources and candidate questions while retaining existing content by default. Expected behavior:

- preserve existing internal question IDs where no reviewed change occurs;
- preserve linked progress;
- label newly added questions;
- skip or link exact duplicates according to an explicit decision;
- present possible duplicates for review;
- retain source contribution metadata;
- create a new StudySet revision atomically.

### Update or replace existing material

Reprocesses a known source or deliberately replaces content. This path may propose additions, changes, and removals, but it must present a diff and progress implications before commit. Replacement must not be inferred merely because filenames match.

Both workflows should use the same validation and revision boundary. Import rollback and revision retention remain open questions.

## Duplicate handling

Duplicate detection is staged and must preserve uncertainty.

### Stage 1: exact duplicate

Use deterministic normalization and hashing to identify equivalent canonical content. The fingerprint is evidence for deduplication, not necessarily the question's primary ID.

The exact normalization contract is unresolved. Decisions are needed for Unicode normalization, whitespace, case, punctuation, HTML, answer order, category, explanations, and choice identifiers. The contract must be versioned or otherwise stable enough that a software update does not unpredictably reclassify a dataset.

### Stage 2: near textual duplicate

Deterministic text similarity may flag review candidates. Thresholds and normalization must be testable. A match must not automatically overwrite, merge, or transfer progress.

### Stage 3: semantic duplicate

Optional future AI, embeddings, or Jev may suggest that two differently worded questions are duplicates, updates, or distinct. Such output is advisory and reviewable. It cannot become a requirement for importing or studying.

## Provenance

Every accepted question should be traceable to one or more source locators where available, for example:

- `questions.json`, record 182;
- `biology.pdf`, page 14;
- `additional-material.docx`, table 3, row 8.

Importers produce provenance metadata alongside candidates. The StudySet lifecycle retains the association. The study engine does not need provenance to evaluate an answer.

PR 0 does not decide whether a minimal `sourceRef` lives on each Question or whether all details live in a separate contribution relation. The design must support multiple contributing sources without copying document structures into core question logic.

## Implemented document extraction

Document formats follow a longer pipeline:

```text
DOCX / PDF with selectable text
        |
        v
SourceDocument (descriptor, format, byte count; not raw bytes)
        |
        v
ExtractedDocument (ordered, serializable source blocks)
        |
        v
NormalizedDocument
        |
        v
STOP: content ready for future review/mapping
        |
        v
future reviewed mapping / optional generation -> canonical candidate -> validation
```

Raw File/Blob, source descriptor, extracted blocks, normalized document, mapping
candidate, and StudySet are distinct stages. The web layer owns FileReader,
ZIP/XML parsing and PDF.js. Import-core owns parser-free readonly contracts,
line-ending normalization and summary counts. It has no runtime dependencies or
browser/schema/storage coupling. `@openstudy/schema` is unchanged.

`SourceDocument` wraps an import-local SourceDescriptor, `docx | pdf`, and byte
length. `ExtractedDocument` preserves original extracted text;
`NormalizedDocument` is a detached snapshot changing **only CRLF/CR to LF**.
No trimming, summarization, translation, spelling changes, Unicode normalization,
reordering, question/answer inference, or destructive minification occurs. Raw
buffers and parser objects are not retained in the result or persisted.

Block keys/locators are deterministic within the same extraction, not canonical
identity. DOCX uses logical XML paths, including run positions; PDF uses 1-based
page and 0-based item locators. Editing the source or changing the parser can
change them. No DOM nodes, PDF.js instances, fonts or callbacks enter contracts.

### DOCX approach and fidelity

No extra DOCX runtime dependency is added. The mature existing zip.js native-stream
reader verifies the OOXML package; the platform namespace-aware XML parser reads
the main document and styles. This narrow approach keeps source runs and tables
without a second ZIP parser or converting untrusted source content to rendered
HTML. The format is described in the
[Microsoft Open XML documentation](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document).
It is deliberately **not** a full Word renderer/style resolver.

Preserved from the main body:

- Ordered paragraphs (including empty ones), headings with an available outline
  level, and paragraph/character style identifiers.
- List roles, source numbering ID and nesting level. Automatic bullet/number
  labels, restarts and numbering definitions are **not** resolved. Literal labels
  remain text, not inferred answer choices.
- Separate text runs, text/whitespace, tabs, breaks, direct bold/italic/underline,
  simple inherited style flags and explicit formatting-off values. Paragraphs
  without an explicit style use the declared default paragraph style and its
  existing inheritance chain, including available outline/numbering properties.
  Explicit paragraph styles and direct formatting still take precedence. Complex
  style toggles, theme/layout/font behavior are not fully reproduced.
- Tables as ordered rows/cells with nested blocks/tables, column spans and
  vertical-merge start/continuation metadata. No semantic table interpretation.
- Hyperlink display text without following targets. Inline tracked changes retain
  inserted/deleted wording and revision markers; changes are not accepted.
- Media presence/inline markers without reading or rendering images. Unsupported
  blocks have placeholders; unsupported inline features warn.

Require normal `word/document.xml` and the regular DOCX main-part content type,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml`.
Resolve its effective type from the matching OPC `Override` before the `Default`
for its extension (case-insensitive). An invalid Override never falls back to a
valid Default; ambiguous matching declarations are rejected.
Both Transitional and Strict DOCX use this content type; Strict changes the Word
and relationship namespaces, not the main-part MIME type. Both Word namespaces
are supported; unconventional main-part paths are not. This matches the
[Open XML SDK's document type mapping](https://github.com/dotnet/Open-XML-SDK/blob/main/src/DocumentFormat.OpenXml/Packaging/WordprocessingDocument.cs)
and its [Strict DOCX fixture](https://github.com/dotnet/Open-XML-SDK/blob/main/test/DocumentFormat.OpenXml.Tests.Assets/assets/TestFiles/Strict01.docx).
XML is UTF-8 or BOM-marked UTF-16. Headers, footers, footnotes, endnotes and comments
are omitted, with warnings when present. Main-document internal relationship
types identify these roles even with nonconventional target names, alongside the
existing filename checks. Relationship XML shares the normal XML/node/depth
budgets; targets are not followed and omitted parts are not parsed for content.
Unknown features, fields, drawings and complex revision/layout content require
comparison with the original. The UI
disclaims full Word layout and surfaces media/omitted-content warnings.

All entries, including discarded media, count toward budgets and undergo CRC and
output-size checks. Reject unsafe/duplicate names, encrypted/split/symlink entries,
unsupported compression and ambiguous metadata. Macros/macro-enabled content types
are unsupported. Required XML rejects DTD/entity declarations before DOM parsing.
Relationships, embedded objects/scripts and altChunk content are never executed or
fetched; no parser-produced HTML is injected.

### PDF dependency, worker and fidelity

The only added runtime dependency is **`pdfjs-dist` 6.3.289**, pinned in the web
workspace. Mozilla's PDF.js supplies established browser PDF parsing and text
extraction. Its official `legacy` browser build supplies compatibility shims useful
for the supported Node test baseline. The existing PDF.js worker is bundled inline
by Vite, not fetched after selection or loaded from a CDN. No extra application
worker, OCR engine, competing PDF library or AI dependency is added. Its optional
`@napi-rs/canvas` dependency is Node-side packaging, not browser rendering/OCR.
See the [official PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).

Retain all pages, including blank ones, page dimensions, parser item order,
original item text, direction, transform/coordinates, width/height and line-break
signals. Pages are sequential; text arrives in stream chunks. No positional
sorting, column/table recognition, layout reconstruction, question/answer detection
or font-based correctness inference occurs. PDF.js/source order can differ from
visual order. PDF.js can itself lose whitespace/glyph fidelity; this is not a
raw-text-perfect guarantee. Unusual fonts/CMaps may need unavailable glyph mapping:
external font/CMap/WASM downloads are deliberately disabled, so extraction may fail
instead of fetching a fallback. The parser+inline worker increases initial app
download size (about 665 KB gzip for the total JavaScript bundle in this build).

No canvases, images, actions/JavaScript, annotation layers, forms, attachments or
remote content are rendered/executed. PDF media presence is `unknown`, with a
media-not-extracted warning, rather than falsely `false`. Bytes are copied before
worker transfer so caller buffers are not detached. Tasks/workers are destroyed
on completion, failure and cancellation.

If the document contains no text or fewer than ten non-whitespace text characters
(a tunable implementation heuristic), return typed `no-extractable-text`: "We
couldn't find enough selectable text in this PDF. Scanned PDFs aren't supported
yet." This is not scan classification or a question/content-meaning heuristic;
very short legitimate PDFs can be rejected. Mixed PDFs with enough total text
succeed but retain/count/warn about pages without text. Password requests and encryption that
opens with an empty password are explicitly unsupported. No password prompt,
password cracking, or decryption workflow.

### Document resource limits and errors

Tunable defaults in `apps/web/src/import/limits.ts`:

| Budget | Default |
| --- | ---: |
| Raw DOCX | 20 MiB |
| Raw PDF | 25 MiB |
| DOCX entries (all types) | 1,000 |
| Total uncompressed DOCX content | 50 MiB |
| Single DOCX XML/rels part | 8 MiB |
| DOCX per-entry expansion ratio | 200:1 |
| Required XML nodes/attributes across parts | 200,000 |
| Required XML depth / style inheritance chain | 100 |
| Document blocks (including table rows/cells) | 10,000 |
| Extracted text characters | 2,000,000 |
| PDF pages | 300 |
| PDF text items across all pages | 100,000 |
| Minimum non-whitespace PDF text characters | 10 |

Raw sizes are checked before reading. ZIP declared/streamed sizes are checked
before retaining parts. XML node/depth and output block/text budgets precede
normalization. PDF pages are capped before text extraction; item/text caps apply
per stream chunk. These are not permanent promises or a perfect hostile-input
sandbox: XML DOMs, decompressor chunks and PDF.js internal objects may allocate
before output checks. Byte caps are not heap caps. DOCX parsing runs on the main
thread and cannot interrupt a synchronous DOM parse mid-call; surrounding checks
and UI cancellation prevent stale results. Real mobile performance/memory
profiling remains a follow-up.

New typed errors: `corrupt-docx`, `corrupt-pdf`, `no-extractable-text`,
`unsupported-encrypted-pdf`, `document-resource-limit`,
`unsupported-document-content`, `document-browser-unsupported`. Reuse existing
`file-too-large`, `read-failure`, `unsupported-file-type`. Raw stack traces are never
shown. Stream cleanup preserves original policy failures rather than replacing
them with generic corruption errors.

### Local/privacy and next-stage intent

All paths stay in memory/on-device: no uploads, parser APIs, analytics, AI or
persistence. Libraries load with the application; browser tests block requests
after app load for DOCX, PDF, scanned/encrypted PDF, JSON and ZIP. This is not a
new offline-installable PWA.

Success says **Document extracted / Content ready for review**, not "Questions
found" or a completed import. Counts describe source structure. Shared accessible
status/alerts, reset/cancel and file picker remain; summaries/long names wrap on
the focused app canvas.

Future review must distinguish **existing questions/tests** (faithful mapping)
from **study material/notes** (possible optional generation). No selector is added
because intent does not change extraction. No mapping UX, OCR, legacy DOC,
question/answer detection, generation, canonical StudySet/IDs, storage, Library
entries or study features are implemented.

## Future AI and Jev assistance

Optional assistance may suggest:

- source-field mappings;
- structure classification;
- possible semantic duplicates;
- questions generated from normalized material;
- question-quality concerns.

Jev could later support bounded reviewed decisions such as duplicate versus update versus different question, source-field classification, or quality gates.

Neither AI nor Jev may perform schema migration, JSON validation, document extraction, correct-answer invention, stable-ID generation, or core study behavior. A deterministic or manual path remains available. Provider abstractions are premature until a real assisted use case is selected.

## Future MCP integration

An MCP server might expose operations such as `get_schema`, `validate_study_set`, `create_study_set`, `add_material`, or `create_learning_plan`. MCP and its clients produce or consume data conforming to the open schema. They do not define the schema or bypass validation and lifecycle decisions.

## Open questions

- What exact normalization contract defines an exact duplicate?
- How should a mapping be saved and matched to later files from the same source?
- Is partial import required in V1, and how is skipped content represented?
- Which changes qualify as an update to an existing question rather than a new question?
- What review UI is sufficient before progress is retained or reset?
- How much provenance is mandatory for manually created or transformed questions?
- Should original JSON or ZIP inputs be retained after a successful import?
- What atomic rollback or revision snapshot is required for add/update operations?
- Which ZIP and JSON limits work on the supported mobile device baseline?
