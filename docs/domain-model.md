# Domain model

## Purpose

This is a conceptual model. It establishes names, ownership, and relationships without selecting database tables, TypeScript types, or a persistence library.

## Domain separation

```text
StudySet content  +  LearningPlan  +  UserProgress
       |                   |                |
       +------ referenced, never merged ---+
```

- A StudySet describes what can be studied.
- UserProgress describes what a learner has done.
- A LearningPlan may later describe what should be studied and in what sequence.

Changing progress must not mutate canonical questions. Generating a learning plan must not rewrite a StudySet.

## Entity overview

| Concept | Purpose | V1 status |
| --- | --- | --- |
| StudySet | Canonical, portable collection of study content | V1 |
| Question | Typed study interaction content within a StudySet | V1; single-choice only |
| Source | Identity and metadata for material that contributed content | V1 minimum |
| SourceDocument | Metadata describing an original document-oriented source | DOCX/text-PDF ingestion descriptor; not retained binary bytes |
| NormalizedDocument | Extracted paragraphs, tables, pages and formatting | DOCX/text-PDF neutral blocks; not canonical study content |
| StudySetRevision | A committed content state or change boundary | V1 concept; retention mechanics open |
| UserProgress | Learner state keyed by stable content identity | V1 |
| FlashcardProgress | Separate durable recall ratings keyed by stable content identity | Implemented |
| FlashcardSession | Temporary ordered card/reveal/result state | Memory only |
| TestSession | Temporary ordered questions, answer selections and navigation state | Memory only |
| TestResult | Submitted correctness and mistake-review data | Memory only |
| LearningPlan | Optional goals, sequencing, or schedule over existing content | Future |

## StudySet

A StudySet is the canonical aggregate accepted by validation and consumed by study use cases.

The local Library persists this aggregate under its canonical `id`, with a separate
derived summary for list rendering. It does not persist source file bytes, import
workflow state, or UserProgress. Duplicate titles are valid.

Conceptual properties include:

- `schemaVersion`: version of the canonical file/data format.
- `id`: stable StudySet identity, independent of title and storage location.
- `revision`: identity or number for this content state, distinct from `schemaVersion`.
- title and optional description.
- explicit supported question records.
- categories or topic references where needed.
- source and provenance metadata sufficient to explain origin.
- creation and content-revision metadata where useful for portability.

A StudySet is not a source file, import mapping, study session, progress record, or learning plan.

Add Material evolves this aggregate under the same `id`, title and description.
Existing Source, Category, Question and Choice IDs remain stable. Exact duplicate
questions keep their saved Question and Choice IDs while gaining new provenance
and category membership. New questions retain their incoming canonical IDs after
collision checks. The accepted merged aggregate advances `revision` by one;
preview, cancellation, conflict and failed persistence do not advance it.

### Canonical schema 1.0.0

PR 1 defines the serialized V1 StudySet as:

```text
StudySet
  schemaVersion: "1.0.0"
  id: PortableId
  revision: positive safe integer
  title: non-blank string
  description?: non-blank string
  sources: Source[]              (at least one)
  categories: Category[]         (flat, may be empty)
  questions: Question[]          (at least one)
```

The canonical schema intentionally contains no UserProgress, LearningPlan, import mapping, raw source document, storage identifier, or generic metadata bag.

`sources` and `questions` each require at least one item. A canonical StudySet is therefore completed, importable, and studiable content, not an empty draft. Import and mapping interfaces should use separate candidate models for incomplete state.

## Question

A Question is a canonical, typed item. V1 study behavior supports only `single-choice`, but the discriminator should make later schema evolution possible.

Conceptual single-choice content includes:

- stable internal `id`, used as the question ID;
- explicit question type;
- prompt;
- at least two choices with stable choice identities or another unambiguous answer reference;
- exactly one correct answer;
- optional explanation and category references;
- a minimal provenance reference, subject to the provenance-placement decision.

The study engine reads canonical question fields only. Source names such as `questionText`, `choices`, or `correctIndex` are removed at the mapping boundary.

Schema 1.0.0 requires stable choice IDs and a `correctChoiceId` reference. Choice IDs are unique within their question, and the correct reference must resolve within that same question. Correctness is therefore independent of array order.

### Question identity

Progress references `studySetId` and `questionId`, never an array index.

Recommended initial approach:

- Generate an opaque internal ID when a question is first accepted into a StudySet.
- Persist that ID in exports and future revisions.
- Keep optional source/external IDs namespaced by `sourceId`; do not assume they are globally unique or permanent.
- Use deterministic fingerprints for duplicate detection, not as the sole primary identity. A content-derived primary ID would change whenever content changes.
- Reuse an existing internal ID only when evidence is strong: an unchanged imported ID under a trusted StudySet lineage, a stable namespaced source ID with an explicit update workflow, or a reviewed exact-match decision.
- Treat fuzzy or semantic similarity as a review candidate, never proof of identity.

PR 1 defines the portable representation without selecting a generator. Internal IDs are 1-128 ASCII characters, start with a letter or digit, and otherwise contain only letters, digits, `.`, `_`, `:`, or `-`. This admits UUIDs, ULIDs, and prefixed IDs while rejecting whitespace, paths, and blank values. The schema validates but never generates IDs.

Structured mapping now creates new candidate identity with a browser-generated
128-bit cryptographic namespace and portable entity/record/choice suffixes.
The opaque namespace makes record indexes insufficient as identity on their own;
IDs are stable within the candidate, independent of question text or provenance
external IDs. Exact category labels share a generated first-occurrence registry
ID, not a text-derived identity. Separate imports intentionally get new IDs.
This resolves new-content generation only: preservation and trust across future
Add Material, re-import, and update/merge workflows remain separate decisions.

### When a question changes

Not every edit should have the same effect:

- Non-semantic metadata changes, such as spelling corrections or category changes, may retain identity and progress.
- Correctness-bearing changes to the prompt, choices, or correct answer may need a new identity or explicit progress reset.
- Reordering choices should not create a new question if choice identity makes the answer stable.
- Source replacement must not silently claim that a changed item is the same question.

The boundary between editorial and semantic change is unresolved. V1 should prefer explicit review over automatic semantic identity.

## Source

A Source identifies contributing material and supports provenance and lifecycle decisions. Schema 1.0.0 stores only:

- stable canonical `id` within the StudySet lifecycle;
- human-readable `label`;
- optional `originalFilename`;
- optional source-defined `externalId`.

Sources may contribute many questions, and a question may eventually have more than one source. A filename alone is not a reliable identity.

Schema 1.0.0 deliberately has no Source kind or format enum. JSON, ZIP, DOCX, PDF, CSV, Anki, Moodle, generated material, and external integrations are importer concerns. Their format and adapter metadata remain outside the canonical StudySet. The Source does not retain imported bytes, timestamps, mappings, or digests.

Question provenance is an optional array so one question can cite multiple sources. Each entry contains a referentially validated canonical `sourceId` plus optional source-defined `externalId` and opaque source-local `locator`. Neither `externalId` nor `locator` becomes canonical question identity, and the study engine must never interpret `locator`. Richer document page, block, or OCR provenance can evolve later without changing core question identity.

## SourceDocument

`SourceDocument` describes an original document-oriented input, such as DOCX or PDF,
before extraction. The implemented import-core contract holds only an import-local
source descriptor, format and byte count; File/Blob and bytes stay in the web layer.

Local extraction now supports DOCX and text-based PDF as well as structured JSON/ZIP.
Raw document bytes are not retained in successful ingestion data or persisted.
Future retention remains unresolved and has privacy/reprocessing/portability costs.

## NormalizedDocument

`NormalizedDocument` represents deterministic extraction output where possible:

- ordered blocks such as paragraphs and tables;
- page, section, or block locators;
- images and formatting references;
- extraction warnings and confidence where applicable.

It is upstream of question generation and is not a StudySet. OCR and generated questions may be uncertain; their outputs require review before becoming canonical content.

## StudySetRevision

A StudySet revision marks an explicit accepted content change, such as adding a source, applying reviewed updates, or editing questions.

The model should be able to answer:

- which StudySet this revision belongs to;
- which schema version encodes it;
- which sources contributed to it;
- which questions were added, retained, changed, or removed;
- whether progress can remain attached to each question identity.

Schema 1.0.0 represents the current StudySet revision as a positive JavaScript-safe integer. Initial content uses revision `1`. A content revision is distinct from `schemaVersion`, and a representation-only schema migration does not by itself change content revision. Validation does not compare revisions or increment them, and the package does not retain history. Whether persistence keeps complete immutable snapshots, change sets, or a smaller rollback buffer remains unresolved.

## Category

Schema 1.0.0 uses a flat category registry. A Category has a stable internal `id` and non-blank `label`; questions may reference zero or more category IDs. This supports filtering and preserves imported sections without introducing hierarchy, ordering, taxonomy, or category behavior.

## UserProgress

UserProgress is separate local state that references content identity. Learn now stores:

- `studySetId`;
- `questionId`;
- cumulative checked-answer `attempts`;
- `firstAttemptCorrect` for the most recent Learn encounter;
- `eventualCorrect` for that encounter;
- `needsReview`, set by a first wrong check and cleared by a later first-try correct encounter.

The active Learn session is separate, memory-only state. Wrong answers keep the question active and never reveal the correct answer or explanation; the learner retries until correct. Learn does not change StudySet content or revision. No timestamp, mastery algorithm, or session resume is stored.

When content is unavailable or retired, progress should not be silently reassigned to a similar question. Whether orphaned progress is retained, archived, or removed is an open lifecycle decision.

## FlashcardProgress and FlashcardSession

Flashcards keep three distinct objects: canonical StudySet content, durable
FlashcardProgress, and a temporary FlashcardSession. FlashcardProgress contains only:

- PortableId `studySetId` and `questionId`;
- positive safe-integer `reviews`;
- non-negative safe-integer `againCount` and `knowItCount`;
- `lastRating`: `again` or `know-it`.

`reviews === againCount + knowItCount`; the pure update sets lastRating to the
latest applied rating. There are no timestamps, scheduling fields, mastery, or
shared needsReview semantics. Again is not a wrong answer and Know it is not a
correct Learn answer. Flashcards never fabricate or change Learn attempts,
firstAttemptCorrect, eventualCorrect, or needsReview.

The session holds ordered Question IDs, currentIndex, revealed, rating results,
completed, and StudySet ID. It holds no answer/explanation content. Reveal changes
only temporary state; only a rating updates durable progress. Both ratings advance
immediately, with no same-session requeue. Neither the active nor completed session
is persisted. Reload returns to setup. Studying changes neither StudySet content,
revision, nor schemaVersion 1.0.0.

Add Material retains both progress types through stable Question IDs, including
exact duplicates. New questions have no progress. Deletion removes both progress
types with the StudySet and its summary atomically.

## TestSession and TestResult

StudySet content, Learn UserProgress, FlashcardProgress and TestSession are distinct.
The Test engine consumes validated canonical content without mutating it or producing
either mode's progress events. Test introduces no durable progress/history model.

TestSession holds PortableId studySetId, ordered questionIds, currentIndex, submitted,
and an array of answers containing questionId and selectedChoiceId (PortableId or
null). Stable IDs associate selections with their question independently of order.
It copies no prompt, choices, explanation or correctness into active session state.
Answers can change or clear before submission and remain selected during navigation.

Creation filters by one canonical category (or All topics), optionally shuffles the
entire eligible pool using Fisher–Yates and an injected random source, then takes
the requested count. The chosen order stays fixed; choice order never changes.

Only submission evaluates correctness. By default it rejects unanswered questions;
an explicit confirmed submission can accept them. Submission locks further active
selection/navigation and returns a separate TestResult with StudySet ID and ordered
questionId, selectedChoiceId and correct records. Unanswered has selectedChoiceId
null and correct false, but is presented separately from answered-incorrect.
Summary counts total/correct/incorrect/unanswered and uses Math.round(correct /
total * 100). Mistakes comprise wrong and unanswered in the original Test order.

The web layer reads canonical content for post-submission answers/explanations.
Neither session nor result contains timestamps, attempt IDs, best/average scores or
history. Configuration, selections, order, results and review position are discarded
on reload. Test changes neither StudySet revision/schema nor either progress model.

## LearningPlan

A LearningPlan is a future, optional layer that can reference StudySets, categories, and questions to express sequencing, goals, or schedules. It may be manually created or suggested by an optional LLM later.

It never owns canonical questions. Regenerating or deleting a plan must not change StudySet content or erase UserProgress.

## Relationships

```text
StudySet 1 --- many StudySetRevision
StudySet 1 --- many Question
StudySet many --- many Source (through provenance/contribution)
Source 0..1 --- 1 SourceDocument
SourceDocument 1 --- 0..many NormalizedDocument artifacts
Question many --- many Source locators (future-capable provenance)
UserProgress many --- 1 StudySet
UserProgress many --- 1 Question
FlashcardProgress many --- 1 StudySet/Question
LearningPlan many --- many StudySet/Question references
```

Cardinality is conceptual. In particular, the provenance relation may be simplified for V1 if it retains an extension path.

## Invariants to protect

- `schemaVersion` and StudySet `revision` are never interchangeable.
- A persisted question has stable identity independent of array order.
- A question consumed by the study engine has passed canonical validation.
- UserProgress does not contain or own canonical question text.
- A LearningPlan does not mutate StudySet content.
- Adding material creates an explicit lifecycle decision and never silently overwrites a question.
- Source-specific fields stop at the import boundary.
- Detailed provenance does not become required input to core answer-evaluation logic.

## Open questions

- New structured candidates use session-scoped opaque IDs; can future canonical re-import/update workflows ever propose trusted existing IDs?
- What exact changes retain question identity and progress?
- How should revision snapshots and rollback be stored around the positive revision number?
- When does a content operation increment revision, including no-op imports and metadata-only edits?
- When does provenance need a structured locator beyond the V1 opaque string?
- Are SourceDocuments disposable by default, retained by default, or a per-import choice?
- How should media assets be identified and packaged without breaking portability?
- What happens to progress for removed questions, replaced sources, and rolled-back revisions?
