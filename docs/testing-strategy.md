# Testing strategy

## Goals

Testing should protect the open data contract, deterministic behavior, progress integrity, and critical user workflows. It should not duplicate every assertion at every layer.

The implemented suites now cover the canonical schema, import/review, Add Material,
Learn, Flashcard and Test transitions, IndexedDB layout upgrades and separate progress integrity, plus focused
browser flows. The remaining items below describe broader V1 goals.

Flashcard unit tests cover category IDs, uncategorized selection, deterministic
count/order, unrevealed content-free state, reveal without progress, rating guards,
automatic advancement, completion/count summaries, immutability, strict counters,
lastRating, malformed records and overflow. Storage tests cover actual v1 → v3 and
v2 → v3 upgrades, retained records and store/index/key layout, reopening, stale and
concurrent writers, cumulative recovery, canonical references, exact-duplicate Add
Material preservation, and atomic four-store deletion/rollback. Learn progress and
canonical content are compared before/after Flashcards for byte-for-byte equality.

Component tests cover setup, hidden DOM answers/explanation/ratings, reveal,
both ratings, next-card reset, summary/Study again, loading errors/retry, warnings,
conflicts, delayed saves, double/competing activations, and keyboard/focus.
Focused Playwright flows exercise happy path/reveal privacy, reload persistence,
real Learn independence, Add Material preservation and deletion. The study journey
and keyboard/double-click regressions run on 320px and desktop; long-content and
200% reflow checks use all existing viewport projects. Lifecycle flows are not
duplicated at every width. Revealed content uses focused accessible headings with
answer/explanation descriptions; hidden content is not mounted or announced.
Manual screen-reader speech testing remains distinct from DOM/keyboard assertions.

Test unit coverage verifies category identity and uncategorized eligibility, count
validation, Fisher–Yates with injected randomness, shuffle-before-count, unique
eligible IDs, unchanged choice order, and stable order through immutable transitions.
Selections use Choice IDs, can change/clear and survive navigation without correctness
fields or canonical text in active state. Submission is guarded, unanswered needs
explicit permission and earns zero credit, scoring uses deterministic integer rounding,
and ordered mistakes include wrong/unanswered only. Submitted sessions reject editing,
navigation and resubmission; malformed inputs and StudySet immutability are checked.

Test component/browser coverage checks setup/category/count/shuffle, hidden setup,
native fieldset/radios, pre-submit DOM and accessible-name privacy, navigation and
retained answers, unanswered confirmation/cancellation, results/review/restart, route
errors, focus and keyboard behavior. Rapid/competing actions and double-click retargeting
must not skip questions, submit twice, restart or leave Test. Before/after snapshots
prove both progress stores, canonical content/revision and Library summary unchanged,
and confirm layout 3 has only its existing four stores. Reload discards active Test,
results and mistake review. Shuffle browser tests control randomness in the test only;
they do not assume any production random sequence.

Detailed Test flows run at 320px and desktop; long-content and 200% reflow screenshots
use every existing viewport. Actual screen-reader speech and device touch comfort
remain separate from automated semantic, focus, target-size and keyboard assertions.

## Unit tests

Fast unit tests should cover rules with small deterministic inputs:

- canonical schema validation and understandable issue codes;
- supported question invariants;
- source-to-canonical field transformations;
- each explicit schema migration step;
- exact-duplicate normalization and fingerprints;
- deterministic near-text similarity when introduced;
- stable identity and revision rules once decided;
- StudySet add/update classification rules;
- Learn, Flashcard, and Test state transitions;
- progress calculations, including first-attempt versus eventual correctness;
- ZIP safety accounting logic independent of a ZIP library where practical.

AI or Jev output must not be needed for deterministic unit suites. Optional assisted features should test their bounded input/output contracts with recorded fixtures, not live model calls in core CI.

## Integration tests

Integration tests should cross real internal boundaries without requiring an entire browser journey:

- JSON source through record detection, mapping, canonical creation, and validation;
- canonical old-version file through migrations and current validation;
- ZIP entries through safety checks and import aggregation;
- import commit into local persistence and reload;
- StudySet and UserProgress persistence independence;
- add-material import preserving stable question IDs and existing progress;
- reviewed update/replacement producing the expected revision result;
- failed or cancelled imports leaving prior content unchanged;
- export and restore when those features exist;
- IndexedDB schema upgrades against retained database fixtures where feasible.

Integration tests should verify transaction boundaries, especially that a partially processed import cannot become a partially persisted StudySet revision.

## End-to-end tests

Playwright should cover a small set of critical user outcomes:

- import canonical JSON;
- map unfamiliar JSON, preview it, correct a mapping, and import;
- see understandable validation problems and navigate to affected records;
- reject unsafe or unsupported ZIP input;
- reload and find local content and progress intact;
- complete key Learn, Flashcard, and Test flows;
- add material, review duplicates, and preserve prior progress;
- cancel an import or update without changing saved content;
- use critical flows at a 320px mobile viewport;
- complete critical controls by keyboard.

E2E tests should not become the primary place for schema edge cases or study-engine combinatorics.

## Manual QA

Human review remains necessary for:

- import-language clarity for non-technical users;
- visual hierarchy and cognitive load before and during study;
- keyboard order, visible focus, and screen-reader announcements;
- touch target comfort and mobile browser behavior;
- long questions, long answers, long filenames, and deep categories;
- Unicode, bidirectional text, emoji, and mixed-language content;
- unusually large but supported datasets;
- malformed and surprising source structures;
- progress implications in add/update decisions;
- reduced motion, zoom, contrast modes, and text resizing;
- recovery messaging when local storage is unavailable or cleared.

## Accessibility testing

Accessibility is a V1 acceptance requirement. Testing should combine:

- semantic HTML and accessible-name review;
- keyboard-only flows with visible focus;
- automated accessibility checks as a baseline, not a complete audit;
- screen-reader checks for import issues, question state, answer feedback, and session progress;
- verification that correctness is not communicated by colour alone;
- contrast checks and forced-colour resilience where supported;
- reduced-motion behavior;
- 200% text zoom and long-content reflow;
- touch targets and 320px layout behavior.

Wrong-answer and correct-answer messages need clear text and programmatic state. Focus movement and announcements should avoid revealing the correct answer prematurely in Learn mode or during Test mode.

## Compatibility fixtures

Fixtures should be small, reviewed, and treated as part of the product contract. Planned groups include:

- valid canonical files for every supported schema version;
- expected input/output pairs for every migration step;
- invalid canonical files with expected issue codes and summaries;
- common custom JSON shapes and saved mappings;
- ZIP archives at and beyond entry, size, and nesting limits;
- path-traversal, malformed, duplicate-name, and compression-ratio cases;
- StudySet revisions representing add, update, remove, and no-op import outcomes;
- duplicate corpora for exact, near, and distinct questions;
- progress records spanning retained, changed, removed, and restored questions;
- future-version files that must fail safely;
- Unicode and long-content datasets.

Large or sensitive real-world sources should not be committed casually. Synthetic fixtures should preserve the relevant structure without copying private material.

## Test ownership by boundary

| Concern | Primary coverage |
| --- | --- |
| Schema and migrations | Unit + compatibility fixtures |
| Mapping and import transformation | Unit + integration |
| Persistence and atomic revision commit | Integration |
| Study-engine state transitions | Unit |
| Critical learner/importer outcomes | Playwright |
| Usability, visual hierarchy, assistive technology | Manual QA + targeted automation |
| Optional external assistants | Contract tests outside core deterministic suites |

## Release confidence

Before a schema release, all supported-version fixtures and migrations should pass. Before a StudySet lifecycle change, progress-preservation and rollback cases should pass. Before a study UX release, critical mobile, keyboard, screen-reader, and no-network flows should be checked.

Performance budgets cannot be fixed in PR 0. Representative lower-memory mobile hardware and realistic dataset sizes are needed before setting thresholds.

## Open questions

- Which browsers, devices, and assistive technologies form the V1 support matrix?
- What dataset sizes define ordinary, large, and rejected inputs?
- Which compatibility fixtures become permanent public examples?
- How should IndexedDB tests balance realistic browsers with fast CI?
- What minimal visual-regression coverage adds value without making layout changes brittle?
- Which add/update and progress-reset decisions require human-reviewed golden fixtures?
