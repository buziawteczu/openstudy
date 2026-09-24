# ADR 0006: StudySets can evolve through additional materials

- Status: Proposed
- Date: 2026-09-23

## Context

Real study collections grow. A learner may import chapters 1-5, later add chapters 6-8, and later add revision questions. Treating every import as a replacement would discard provenance and threaten progress. Treating every record as new would create duplicates.

Question identity cannot be derived from array position. Content hashes help detect exact duplicates but make poor primary IDs because legitimate edits change the hash. Fuzzy or semantic similarity cannot safely prove that two questions are the same.

## Decision

The product will distinguish `Add material` from `Update or replace existing material`.

An accepted add/update operation creates an explicit StudySet revision boundary. It will preserve stable internal question IDs and linked progress where identity is sufficiently reliable, label newly added questions, retain source provenance, and avoid silent overwrite.

Duplicate handling is staged:

1. deterministic exact normalization and hashing;
2. deterministic near-text matching as a review candidate;
3. optional future AI, embeddings, or Jev for semantic review assistance.

Only deterministic exact rules or explicit user decisions may drive automatic deduplication behavior. Fuzzy and semantic matches do not automatically merge, overwrite, or transfer progress.

The initial identity direction is an opaque persisted internal question ID plus optional source/external IDs scoped to a Source. The precise ID format, exact normalization contract, semantic-change boundary, and revision retention model remain open.

## Consequences

- The first persisted model must support stable IDs, sources, provenance, and revision metadata even if the full add-material UI ships later.
- Import commits need atomicity so failed or cancelled changes leave the previous revision and progress intact.
- Users may need to review ambiguous updates rather than receiving a fully automatic import.
- Exact deduplication behavior becomes a versioned, tested contract.
- Progress can survive additions, but changed and removed questions need explicit policy.
- Revision history and rollback can increase local storage requirements.

## Alternatives considered

### Replace the entire StudySet on every import

Rejected because it loses identity, provenance, and progress continuity.

### Use array index as question identity

Rejected because ordering changes corrupt progress associations.

### Use normalized content hash as the primary question ID

Rejected because corrections or wording changes would always create a new identity and complicate reviewed updates.

### Automatically merge fuzzy or semantic matches

Rejected because similar questions can have meaningfully different wording, choices, or correct answers.

### Fully event-source every content change from V1

Rejected as premature complexity before rollback and collaboration requirements are known.

## Open questions

- Which stable ID format should V1 use?
- What exact normalization rules define an exact duplicate?
- Which edits retain identity, and when does progress reset?
- What does a StudySet revision contain, and how many are retained?
- How much provenance is stored per question and per source contribution?
- What happens when an update removes a question with progress?
- Does a no-op import create a revision?
- Is a single rollback snapshot sufficient for V1, or is revision history required?
