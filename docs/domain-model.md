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
| SourceDocument | Original binary or source container before extraction | Future; JSON source metadata may use a lighter representation in V1 |
| NormalizedDocument | Extracted paragraphs, tables, pages, images, and structure | Future |
| StudySetRevision | A committed content state or change boundary | V1 concept; retention mechanics open |
| UserProgress | Learner state keyed by stable content identity | V1 |
| LearningPlan | Optional goals, sequencing, or schedule over existing content | Future |

## StudySet

A StudySet is the canonical aggregate accepted by validation and consumed by study use cases.

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

## Question

A Question is a canonical, typed item. V1 study behavior supports only `single-choice`, but the discriminator should make later schema evolution possible.

Conceptual single-choice content includes:

- stable internal `questionId`;
- explicit question type;
- prompt;
- at least two choices with stable choice identities or another unambiguous answer reference;
- exactly one correct answer;
- optional explanation and category references;
- a minimal provenance reference, subject to the provenance-placement decision.

The study engine reads canonical question fields only. Source names such as `questionText`, `choices`, or `correctIndex` are removed at the mapping boundary.

### Question identity

Progress references `studySetId` and `questionId`, never an array index.

Recommended initial approach:

- Generate an opaque internal ID when a question is first accepted into a StudySet.
- Persist that ID in exports and future revisions.
- Keep optional source/external IDs namespaced by `sourceId`; do not assume they are globally unique or permanent.
- Use deterministic fingerprints for duplicate detection, not as the sole primary identity. A content-derived primary ID would change whenever content changes.
- Reuse an existing internal ID only when evidence is strong: an unchanged imported ID under a trusted StudySet lineage, a stable namespaced source ID with an explicit update workflow, or a reviewed exact-match decision.
- Treat fuzzy or semantic similarity as a review candidate, never proof of identity.

The exact ID representation remains open. UUIDv7, ULID, or another opaque format can be selected with implementation evidence.

### When a question changes

Not every edit should have the same effect:

- Non-semantic metadata changes, such as spelling corrections or category changes, may retain identity and progress.
- Correctness-bearing changes to the prompt, choices, or correct answer may need a new identity or explicit progress reset.
- Reordering choices should not create a new question if choice identity makes the answer stable.
- Source replacement must not silently claim that a changed item is the same question.

The boundary between editorial and semantic change is unresolved. V1 should prefer explicit review over automatic semantic identity.

## Source

A Source identifies imported material and supports provenance and lifecycle decisions. It may record:

- stable `sourceId` within the StudySet lifecycle;
- user-facing filename or label;
- media/input type;
- import time and optional deterministic file/content digest;
- adapter and mapping metadata needed to explain the conversion;
- optional external system identity;
- whether the operation added material or updated/replaced an existing source.

Sources may contribute many questions, and a question may eventually have more than one source. A filename alone is not a reliable identity.

## SourceDocument

`SourceDocument` represents an original binary or document-oriented input, such as DOCX or PDF, before extraction. It may own bytes or a reference to bytes plus basic metadata.

It is a future concept because V1 accepts JSON and ZIP of JSON, not general document parsing. Whether original source bytes should be retained after a successful import is unresolved and has privacy, storage, reprocessing, and portability consequences.

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

PR 0 does not decide whether every revision is a complete immutable snapshot, a change set plus a current snapshot, or only a monotonic revision number. Rollback and retention costs must be evaluated before implementation.

## UserProgress

UserProgress is separate local state that references content identity. A minimal conceptual record may include:

- `studySetId`;
- `questionId`;
- attempts;
- first-attempt correctness;
- eventual correctness or completion;
- `needsReview`;
- `lastStudied`;
- a deliberately simple `masteryState`, if one is needed.

Mode-specific session state may exist separately from durable per-question progress. V1 should not hide a complex mastery algorithm inside storage records.

When content is unavailable or retired, progress should not be silently reassigned to a similar question. Whether orphaned progress is retained, archived, or removed is an open lifecycle decision.

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

- Which opaque ID representation should V1 use, and can importers ever propose internal IDs?
- What exact changes retain question identity and progress?
- Are choice IDs required for V1 portability and safe reordering?
- Is StudySet revision a number, an immutable snapshot ID, or both?
- How much provenance belongs directly on `Question` versus in a separate contribution record?
- Can one canonical question cite multiple source locations in V1?
- Are SourceDocuments disposable by default, retained by default, or a per-import choice?
- How should media assets be identified and packaged without breaking portability?
- What happens to progress for removed questions, replaced sources, and rolled-back revisions?
