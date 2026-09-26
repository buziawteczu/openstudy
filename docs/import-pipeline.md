# Import pipeline

## Purpose

The import pipeline converts untrusted external material into a validated canonical StudySet candidate. It is separate from persistence and study behavior.

The planned V1 import path is JSON and ZIP files containing JSON. Document extraction, AI-assisted generation, and additional adapters are future concerns that must enter through the same canonical boundary.

## Implemented neutral boundary (`@openstudy/import-core`)

Conceptual PR 4 implements contracts and inspection only. Real ingestion and
mapping are still future work; the web `/import` page remains a placeholder.

| Stage | Representation and owner |
| --- | --- |
| Raw source | User file/binary/archive; ingestion/extraction owns reading and safety. No raw-file API in import-core. |
| Normalized structured source | `NormalizedStructuredSource`: upstream `SourceDescriptor` plus nested serializable `SourceValue`; already read/extracted, not canonical content. |
| Mapping candidate | `MappingCandidate`: source descriptor, adapter ID, and explicit `RecordCollection[]`; source field names/values remain opaque data. |
| Canonical candidate / StudySet | Later mapping and identity decisions produce a canonical candidate; schema validation/migration gates persistence and study. |

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
There is no production adapter or runtime registry in this PR.

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

In conceptual PR 5, JSON and safe ZIP ingestion will read, parse, and normalize
user material before a structured adapter exposes collections. It will own
parser failures and file/archive resource limits; this PR adds none of that code.
Each JSON input or extracted JSON entry can supply its own normalized source;
combining candidates across entries belongs to the later import use case.
Already-declared canonical material still follows the explicit schema-version
validation/migration path, never heuristic mapping by import-core.

Future DOCX/PDF processing can retain separate `SourceDocument` and
`NormalizedDocument` representations, then project suitable tables/records into
this structured boundary. Paragraphs/pages/images need not be forced into record
arrays. Document-specific extraction/projection contracts remain deferred until
a real extractor needs them; study continues to consume validated canonical data.

See [the package README](../packages/import-core/README.md) for the public API.

## V1 structured import

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

Suggested mappings may be deterministic or, later, AI-assisted. Ambiguous mappings are never silently finalized. The user confirms a mapping before import.

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

Partial import of valid records may be useful, but the confirmation, provenance, and retry semantics are unresolved. No invalid record should be silently dropped.

### 6. Commit

Persistence happens only after explicit confirmation. The commit creates a new StudySet or an explicit StudySet revision. Import previews and validation failures must not partially mutate durable content or progress.

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

Conservative starting implementation defaults could be:

| Limit | Starting value |
| --- | ---: |
| Single JSON input | about 10 MB |
| ZIP compressed size | about 20 MB |
| Total uncompressed entries | about 50 MB |
| Entry count | about 100 |
| Nested ZIP | unsupported |

These are tunable implementation defaults, not permanent product guarantees. They must be validated against mobile memory constraints and realistic datasets. Size checks should be applied before and during decompression where possible, rather than trusting archive headers. V1 should process entries in memory or controlled browser storage and must normalize/reject unsafe names even though it does not extract to a server filesystem.

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

## Future document extraction

Document formats follow a longer pipeline:

```text
DOCX / PDF / scan
        |
        v
SourceDocument
        |
        v
paragraphs / tables / pages / images / formatting
        |
        v
NormalizedDocument
        |
        v
Importer or Generator
        |
        v
reviewable StudySet candidate
```

Extraction and question generation are different responsibilities. OCR text or extracted tables are not automatically correct questions. V1 must not encode assumptions that all future inputs are arrays of question records.

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
