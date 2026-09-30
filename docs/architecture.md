# Architecture

## Purpose

This document defines boundaries and dependency direction for OpenStudy before implementation. It is a constraint on future code, not a request to create every package or interface now.

## Architectural principles

1. One canonical, explicitly versioned StudySet format sits between imports and study behavior.
2. The study engine never reads source-specific fields or parses source files.
3. Study content, user progress, and learning plans are separate domains.
4. Essential behavior is local, deterministic, and usable without AI.
5. External inputs are untrusted and become trusted only after mapping, migration where applicable, and validation.
6. Ambiguity is surfaced for human review; it is not silently resolved.
7. Infrastructure depends on domain contracts. The domain does not depend on IndexedDB, a framework, an AI provider, MCP, Postgres, or an object-storage vendor.
8. Extension points are documented at boundaries and implemented only when needed.

## Major system boundaries

| Boundary | Responsibility | Explicitly does not own |
| --- | --- | --- |
| Source ingestion | Read supported user-selected inputs and enforce input safety limits | Study behavior, semantic question identity |
| Document extraction | Local DOCX/text-PDF conversion into neutral ordered document blocks | Question generation, schema migration |
| Neutral import boundary | Describe normalized structured input, expose neutral record collections through adapter contracts, and inspect counts/fields/sample values | File parsing, question semantics, canonical IDs, mapping decisions, persistence |
| Mapping | Map reviewed neutral record collections, normalize canonical values, and produce a canonical candidate | File parsing, persistence, study sessions |
| Schema and migration | Define canonical data, validate it, and deterministically migrate supported old schema versions | Source parsing, AI inference |
| StudySet lifecycle | Create revisions, add or replace material, preserve provenance, and resolve identity decisions | User mastery algorithms |
| Study engine | Select questions and apply Learn, Flashcard, and Test rules to canonical questions | Import formats, file access, UI rendering |
| Progress | Record attempts and learning state against stable StudySet and question IDs | Canonical question content |
| Learning plans | Future sequencing or goals that refer to content without modifying it | Canonical questions |
| Persistence | Store and retrieve domain records locally; later, adapt to optional hosted storage | Domain rules |
| Presentation | Import guidance, validation review, session configuration, and accessible study UI | Canonical truth or migration logic |

## Core pipelines

Structured V1 input:

```text
JSON or ZIP of JSON
        |
        v
source ingestion and safety checks
        |
        v
normalized structured source
        |
        v
adapter projection to neutral mapping candidate and inspection
        |
        v
reviewed field mapping and canonical candidate creation
        |
        v
mapped candidate, or declared canonical data
        |
        v
declared-version validation and deterministic migration
for supported older canonical data
        |
        v
current-schema validation and issue reporting
        |
        v
explicit import or revision decision
        |
        v
local persistence
        |
        v
study engine ----> Learn / Flashcards / Test
```

Document input (existing-question review implemented; generation remains future):

```text
binary source
    |
    v
SourceDocument
    |
    v
deterministic extraction where possible
    |
    v
NormalizedDocument
    |
    v
explicit intent: existing questions/tests OR notes
    |
    v
existing questions -> deterministic candidates -> human review/correction
                   -> schema-validated StudySet candidate -> STOP in memory
notes -> extracted content only (future generation, not implemented)
```

`SourceDocument` and `NormalizedDocument` are not alternative StudySet shapes. They belong upstream and may contain paragraphs, tables, pages, images, formatting, and extraction metadata that the study engine should never see.

## Canonical boundary

All import paths converge on the same StudySet schema before persistence and study. The schema is implemented in `@openstudy/schema`. `@openstudy/import-core` owns upstream structured source/collection and neutral document contracts, deterministic inspection and normalization; it does not produce StudySets or depend on the schema. `@openstudy/mapping` (in `packages/structured-mapping`) consumes neutral structured records or normalized documents and the canonical schema. Its separate `documents/` modules own conservative existing-question grouping, temporary candidates, pure review transformations and final validation. The structured transformer is unchanged apart from extracting its ID formatter into a shared utility. React coordinates intent, a scoped reducer, navigation and presentation. Both implemented question flows stop at an all-valid candidate in memory, not persistence. See [the import pipeline](import-pipeline.md).

This extends the existing focused mapping boundary instead of creating another
workspace: neutral reviewed content becoming canonical content is already its
responsibility. Import-core remains schema/semantic-free, document parsers stay
in the web layer, and document rules do not enter canonical schema 1.0.0.

The canonical model makes the question type explicit. V1 implements only single-choice behavior. Future question variants may be added through schema evolution and corresponding study-engine support; adapters cannot invent a new runtime shape and pass it directly to the engine.

The canonical boundary includes validation results and schema-version handling, but it does not erase provenance. Schema 1.0.0 keeps a minimal provenance array on each Question: a canonical source reference plus optional source-defined external ID and opaque source-local locator. Detailed source and document metadata remains upstream, and the study engine never interprets the locator.

## Dependency direction

The intended dependency direction is inward:

```text
UI and external integrations
        |
        v
application use cases
        |
        +----> import pipeline ----> canonical schema
        |
        +----> StudySet lifecycle -> canonical schema
        |
        +----> study engine -------> canonical schema + progress contract
        |
        v
storage boundary <---- IndexedDB adapter now / hosted adapters later
```

- Structured source adapters depend on import-core contracts, not the canonical schema or study engine. The later mapping and canonical validation boundary depends on the schema.
- The study engine depends on canonical content and small progress-facing contracts, not on source adapters or storage technology.
- Persistence adapters implement storage boundaries defined by application needs.
- UI coordinates use cases and renders state; it does not become the only place where validation or study rules exist.
- MCP clients, LLMs, Jev, and community tools are outside producers or assistants. They may produce schema-conforming candidates, but they do not define or bypass the schema.

This direction may later be reflected in folders such as:

```text
apps/web/
packages/schema/
packages/import-core/
packages/study-engine/
docs/
examples/
tests/
```

That is a likely destination, not scaffolding required before the first implementation demonstrates a real separation need.

## Local-first V1

V1 has no account, authentication, backend database, or cloud storage. StudySets, source metadata needed after import, and UserProgress remain on-device. IndexedDB is the likely storage mechanism, potentially through Dexie, but the choice of library belongs to implementation planning.

Local-first means:

- core study remains available without a network connection after the application is available locally;
- a failed optional external service cannot block import, validation, migration, or study;
- local storage loss is a known risk, not hidden behind a durability promise;
- export and restore are the likely first recovery tools before sync exists.

## Future hosted architecture

Hosted collections or sync must be additive. A plausible later split is:

- relational metadata, ownership, sharing state, and revision indexes in Postgres;
- source binaries, media, and export artifacts in S3-compatible object storage;
- clients continuing to consume the same versioned canonical StudySet contract.

An S3-compatible boundary avoids placing provider-specific bucket URLs, SDK types, lifecycle rules, or access-control concepts in domain entities. It leaves room for self-hosted and community deployments as well as multiple cloud providers. No object-storage interface or backend service is needed in V1.

Confidential or private sharing would require a separate threat model covering authorization, encryption, link leakage, retention, deletion, logs, and processor responsibilities. Local-first behavior alone is not a claim that future hosted sharing is secure.

## Extension points

The architecture needs seams for the following without implementing registries now:

- **Structured source adapters:** normalized structured inputs to neutral record collections ready for later mapping.
- **Mapping:** `@openstudy/mapping` transforms explicit structured field paths or reviewed document-question candidates into all-valid canonical candidates. Document grouping/review is a separate focused module, not a structured-record adapter or a question generator.
- **Document extractors:** binary sources to `NormalizedDocument`.
- **Question generators:** normalized content to reviewable candidates; deterministic/manual operation must remain possible.
- **Schema migrations:** explicit version-to-version transforms.
- **Question interaction handlers:** later question types paired with schema and study behavior.
- **Persistence adapters:** IndexedDB now, optional hosted storage later.
- **Optional assistants:** mapping suggestions, semantic duplicate candidates, quality checks, and learning-plan suggestions.
- **MCP:** operations such as `get_schema` or `validate_study_set` that consume the open contract rather than define it.

An extension point means stable input/output responsibility. It does not yet imply a public plugin API, dynamic loading, or dependency-injection framework.

## Cross-cutting safety and UX constraints

- ZIP and JSON input are untrusted; conservative, tunable limits and archive validation precede parsing.
- Schema validation and migrations are deterministic and testable.
- Validation output has machine-readable locations and user-readable grouped summaries.
- Possible duplicates never trigger automatic replacement.
- Study-session configuration happens before a session; active study emphasizes the current task.
- Accessibility is part of acceptance criteria, not a later presentation-layer repair.

## Canonical schema 1.0.0 decisions

PR 1 resolves the first serialized boundary without implementing its consumers:

- `schemaVersion` is the exact string `"1.0.0"`.
- StudySet, source, category, question, and choice IDs use the same portable opaque string constraint. The schema validates but does not generate IDs.
- `revision` is a positive JavaScript-safe integer representing the current content revision within a StudySet. Validation does not compare or increment it; history and rollback storage remain outside the schema.
- V1 `Question` is a discriminated union containing only `single-choice`.
- Choices have stable IDs and `correctChoiceId` references one of those IDs.
- Categories are a flat optional-use registry represented by a required array that may be empty; questions reference category IDs.
- Questions may carry a minimal array of provenance entries. Each entry references a declared source and may include a source-scoped external ID and opaque locator.
- Source has no format or kind enum. Source-format and adapter classification remains outside the canonical schema.
- Every canonical object is strict. Unknown fields are rejected intentionally because OpenStudy guarantees backward compatibility for supported older files, not forward compatibility for future files.
- `sources` and `questions` require at least one item, so canonical StudySets represent completed content rather than draft import state.
- UserProgress, LearningPlan, raw SourceDocuments, import mappings, and source-specific fields are not part of the StudySet schema.

## Open questions register

These are intentionally unresolved in PR 0:

1. **ID generation and trust:** new structured imports now use a browser CSPRNG 128-bit namespace plus portable entity/record/choice suffixes, independent of mutable text or imported IDs. The namespace is stable only within that import session. Trust and identity preservation for canonical re-import/update remain unresolved.
2. **Revision history:** when revision numbers increment, how snapshots are retained, and how rollback affects later progress.
3. **Richer provenance:** whether future document locators need a structured extension beyond the V1 opaque locator.
4. **SourceDocument retention:** disposable after import, retained by user choice, or retained by default.
5. **Exact duplicate normalization:** whitespace, Unicode, case, answer ordering, punctuation, and category treatment.
6. **Progress after question changes:** which editorial changes retain identity and which correctness-bearing changes reset or archive progress.
7. **Media representation:** asset IDs, portable relative references, embedding rules, MIME metadata, and offline limits.
8. **Version ownership:** whether the schema package and web application eventually release independently.
9. **Local dataset limits:** supported question count, total bytes, asset budget, and browser/device baseline.
10. **Rollback strategy:** whether V1 needs a single pre-import snapshot, multiple retained revisions, or export-based recovery.

Additional product validation is needed for partial imports, add-material launch scope, and the minimum backup experience.
