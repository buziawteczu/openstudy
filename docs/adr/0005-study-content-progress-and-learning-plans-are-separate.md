# ADR 0005: Separate study content, progress, and learning plans

- Status: Proposed
- Date: 2026-09-23

## Context

Canonical questions describe learning material. Progress records a learner's interaction with that material. A future learning plan may describe sequence, goals, or timing. These concepts change for different reasons and have different portability and privacy concerns.

Embedding progress in StudySet files would make shared content user-specific. Embedding plans in questions would let scheduling or AI output mutate canonical material.

## Decision

StudySet, UserProgress, and LearningPlan are separate domains linked by stable identifiers.

UserProgress will reference at least `studySetId` and `questionId`, never array position. It may track attempts, first-attempt correctness, eventual correctness, review need, last-studied time, and a deliberately simple mastery state.

LearningPlan is outside V1. A future manual or generated plan may reference StudySets, categories, and questions, but it will not own or modify canonical questions. Deleting or regenerating a plan will not erase progress.

Exports and deletion workflows must make clear whether they operate on content, progress, plans, or an explicitly combined backup.

## Consequences

- StudySets remain portable and shareable without leaking learning history by default.
- Progress can evolve without changing the canonical schema on every algorithm change.
- Stable question identity and question-change semantics become essential.
- Persistence needs explicit joins or lookups across content and progress.
- Removed or materially changed questions can leave orphaned or stale progress, requiring a lifecycle policy.
- An optional LLM can generate a plan without rewriting trusted questions.

## Alternatives considered

### Embed progress on each canonical Question

Rejected because content would become learner-specific, harder to share, and harder to revise safely.

### Derive progress from array position

Rejected because imports, sorting, additions, and removals would attach history to the wrong question.

### Store LearningPlan as annotations inside StudySet

Rejected because plans can be user-specific, temporary, or generated and should not alter canonical content revisions.

### Design a full mastery model now

Rejected because the learning behavior has not been validated and a complex model would create premature persistence commitments.

## Open questions

- Which question changes retain, reset, archive, or invalidate progress?
- What happens to progress for removed questions and rolled-back revisions?
- Which progress fields are durable versus session-specific?
- How are combined backups represented without merging the domains?
- When LearningPlan arrives, which references survive StudySet revision changes?
