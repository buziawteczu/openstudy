# OpenStudy product brief

## Problem

People often already have useful study material, question banks, or structured records, but turning that material into a clear, mobile-friendly study experience takes substantial manual work. Existing tools commonly expect a proprietary format, assume that content starts inside the tool, or hide uncertain conversions behind opaque automation.

OpenStudy should make the conversion explicit and reusable: bring structured material, map it into an open canonical format, validate it, keep it locally, and study it through focused learning modes.

A raw document is not a StudySet. Documents may eventually be extracted and normalized before questions can be generated, but document interpretation is outside V1.

## Target users

- Learners who already have a question bank or structured study material.
- Educators and subject-matter experts who want a portable study set without adopting a hosted platform.
- Maintainers converting an existing domain-specific question bank into a usable learning experience.
- Open-source contributors building import adapters, validation tools, or study experiences around a stable format.

V1 assumes that a user can inspect a mapping and resolve ambiguous input. It does not assume that every user understands JSON schemas or JSONPath.

## Jobs to be done

- When I have structured questions, help me convert them into a reliable study set without hand-rewriting every record.
- When source fields do not match OpenStudy's format, let me map and preview them before anything is accepted.
- When records are invalid or ambiguous, explain what needs attention in ordinary language.
- When I return to study, preserve my material and progress on this device.
- When I add more material, preserve existing questions and progress where identity is reliable, and show me conflicts instead of silently overwriting content.
- When I want to leave or recover from local storage loss, give me a portable format and, in a later release, backup and restore tools.
- When I contribute a new source adapter, let me target the canonical format without changing study logic.

## Core value proposition

OpenStudy turns user-owned structured learning material into a validated, portable StudySet and provides a simple study experience without requiring an account, backend, cloud storage, or AI.

The value is not "any file becomes perfect questions automatically." The value is a trustworthy path from supported inputs to a stable study format, with ambiguity and invalid data made visible.

## Core user journeys

### Create a StudySet from structured data

1. Choose a JSON file or a ZIP containing JSON files.
2. Let OpenStudy detect candidate record collections.
3. Map source fields to supported StudySet fields when the source is not already canonical.
4. Preview representative records and correct the mapping.
5. Validate the result and review understandable issue summaries.
6. Import valid content into local storage.
7. Start a study session.

### Study with low cognitive load

1. Choose a StudySet, optional category, mode, and question count.
2. Start the session.
3. Hide configuration and focus on the question, answers, progress, and feedback.
4. Save progress separately from the StudySet.

Intended modes are:

- Learn: show one question and allow answer selection. A wrong answer never reveals the correct answer or explanation; the learner can clear or change the selection and retry until correct. The first wrong attempt marks the question for review; a later first-try correct encounter clears that flag. First-attempt correctness is tracked separately from eventual correctness. The session is temporary, while checked-answer progress persists locally.
- Flashcards (implemented): question → Reveal answer → `Again` / `Know it` → next card. The correct answer and optional explanation are hidden before reveal; alternative choices are not rendered. Configuration disappears during study. All topics includes uncategorized questions; one category uses canonical IDs. Cards follow saved order, with a default of up to 20 and a validated count. Both ratings persist separate FlashcardProgress and advance immediately. Again requests future review without requeueing in this session; Know it records current recall without removing content. No correctness grade or spaced repetition is created. Sessions are temporary; the summary shows only reviewed, Know it, and Again counts.
- Test (future, not implemented): configure question count and optional category selection, shuffle questions, withhold correctness feedback until the end, show results, then review mistakes.

Complex confidence scales and mastery algorithms are not required for V1.

### Add material to an existing StudySet

1. Choose `Add material`, not `Update or replace`.
2. Import and validate the additional source.
3. Detect exact duplicates deterministically.
4. Present possible duplicates or changed questions for review.
5. Commit an explicit StudySet revision.
6. Preserve Learn UserProgress and FlashcardProgress for questions whose identity is retained, including exact duplicates; new questions have neither. Deleting a StudySet removes both progress types.

The workflow must not silently overwrite existing questions. Exact revision and question-change semantics remain open design questions.

## Product principles

- **Local-first:** core use works on one device without a service dependency.
- **Privacy-friendly:** no account, backend, authentication, or cloud upload is required in V1.
- **Deterministic at the core:** ingestion, validation, migrations, persistence, study, and progress work without AI.
- **Portable:** the canonical format is open, versioned, and exportable; there is no intentional lock-in.
- **Explicit about uncertainty:** ambiguous mappings, possible duplicates, and invalid records require review.
- **Low cognitive load:** configuration happens before studying; active sessions emphasize the learning task.
- **Mobile-first and accessible:** 320px layouts, semantic HTML, keyboard use, visible focus, large touch targets, screen-reader labels, good contrast, reduced motion, and non-colour feedback are V1 quality requirements.
- **Extensible without speculative machinery:** establish boundaries for adapters and future services, but add abstractions only when a real implementation needs them.
- **Contributor-friendly:** one canonical contract prevents import adapters and study modes from becoming coupled.

## V1 scope

- Import `.json` and `.zip` files containing JSON files.
- Accept canonical StudySet JSON and support mapping unfamiliar structured JSON into the canonical shape.
- Preview mappings and validate before persistence.
- Report validation failures in actionable, non-technical summaries.
- Use an explicitly versioned canonical StudySet format.
- Support single-choice questions in the implemented interaction model, while keeping the question type explicit for future evolution.
- Store StudySets and progress locally, with IndexedDB as the likely persistence technology.
- Keep StudySet content and UserProgress separate.
- Provide focused Learn, Flashcard, and Test experiences for supported questions.
- Preserve an explicit path for adding material without array-position identity or silent overwrites. Whether the complete add-material workflow ships in the initial V1 milestone remains open, but the first persisted model must not make it impossible.
- Work without an account, backend, cloud storage, AI, Jev, or MCP.

## Explicit non-goals

- DOCX, PDF, OCR, CSV/TSV, Anki, Moodle, or community adapters in V1.
- Automatic question generation from prose or documents.
- A promise to import arbitrary JSON without mapping or review.
- Multiple-choice, true/false, or other new interaction types in the first implementation.
- LearningPlan generation or execution in V1.
- A complex mastery or spaced-repetition algorithm.
- Cloud sync, hosted collections, private sharing, accounts, authentication, or a backend database.
- AI, embeddings, or Jev as a dependency for any essential operation.
- MCP server implementation.
- A plugin registry, generalized workflow engine, or separate schema repository.
- Silent fuzzy matching or automatic replacement of similar questions.

## Success criteria

V1 is successful when:

- A user can import supported structured data through an understandable map, preview, validate, and import flow.
- Invalid or ambiguous input is not silently accepted, and issue summaries help a non-technical user decide what to fix.
- Every accepted record reaches the study engine as canonical, schema-versioned data rather than source-specific fields.
- A user can study supported questions on a 320px-wide screen with keyboard and assistive-technology fundamentals intact.
- Progress survives reloads and references stable question identities, not array positions.
- The persisted model has stable identity, source, and revision boundaries that allow a later add-material workflow without resetting unrelated progress. If that workflow is included in V1, it does not silently overwrite questions.
- The essential product remains usable offline after initial load and without AI or a user account.
- A contributor can understand where to add an importer without modifying study-engine behavior.
- Canonical StudySets can be exported and read by other tools from the documented open format. Progress backup and restore may follow as a lightweight recovery enhancement.

No adoption, retention, or learning-outcome target is set in PR 0; those require product validation rather than architectural assumption.

## Open product questions

- Is add-material a V1 launch requirement or an early follow-up that the V1 data model must support?
- Should V1 allow partial import of valid records, and what confirmation is required when invalid records are skipped?
- What minimum export and restore capability is required before local-first storage is responsible enough for real users?
- Which study mode should be validated first with learners before all three modes are built?
- What local dataset sizes and older/mobile browser targets represent the intended V1 operating envelope?
