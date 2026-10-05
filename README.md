# OpenStudy

A local-first, mobile-friendly study tool. The current application foundation
contains a local StudySet Library, local DOCX/text-PDF/JSON/ZIP ingestion,
explicit structured mapping/validation, document-question review, Learn, Flashcards and Test modes, and a not-found page.
JSON/ZIP field mapping and DOCX/text-PDF existing-question review produce an
all-valid canonical candidate that can be saved to IndexedDB. Document notes stop
at extracted content: creating questions from notes is not supported. A saved
StudySet can also receive new material through an exact-match merge preview and
an explicit update. See the
[import pipeline](docs/import-pipeline.md) for supported shapes and safety limits.

## Repository

- `apps/web`: React/TypeScript/Vite/Tailwind CSS frontend, component tests, and Playwright smoke tests.
- `packages/schema`: canonical StudySet validation, migrations, and JSON Schema.
- `packages/import-core`: neutral structured/document contracts, record-array discovery, document normalization, and inspection; no file APIs or canonical mapping.
- `packages/structured-mapping`: `@openstudy/mapping`, pure explicit field mapping, document-question grouping/review transformations, issues, and canonical candidate validation.
- `packages/study`: `@openstudy/study`, pure Learn/Flashcard/Test session transitions and separate validated Learn/Flashcard progress rules.
- `docs`: product and architecture contracts.

## Development

Use Node **24 LTS** (recommended) or Node **22.22+** and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).
On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## Tests and verification

```sh
npm run typecheck
npm test
npm run build
npm run verify
```

These commands cover all workspaces. `verify` runs typecheck, schema, import-core, mapping,
study and frontend tests, all builds, and JSON Schema freshness checking.
`npm run check:json-schema` and `npm run generate:json-schema` still target the
schema package.

To install the Chromium test browser and run the smoke suite against the built app:

```sh
npm exec --workspace @openstudy/web -- playwright install chromium
npm run build
npm run test:e2e
```

The suite starts and stops its own preview server on port 4173. It checks
navigation, direct routes, keyboard focus, local DOCX/PDF/JSON/ZIP ingestion,
structured mapping/validation/issue inspection, existing-question document review,
notes intent, inline corrections/exclusion, local Library save/reload/delete, Learn answer/retry,
Flashcard reveal/rating, Test navigation/submission/mistake review, separate progress persistence and cleanup, reset/errors, 200% text scaling, and layout at widths
320, 375, 390, 768, 1440, and 1920px. Local visual captures and failure traces are written to
the ignored `apps/web/test-results/` directory.

Supported inputs are DOCX, PDF with selectable text, JSON, and ZIP containing
JSON. Scanned/image-only PDFs, OCR and legacy DOC are unsupported. Processing
stays on-device. A validated canonical StudySet, its Library summary, and separate
per-question Learn UserProgress and FlashcardProgress are saved. Active study sessions, raw files, source rows,
extraction blocks and review state are not retained. Deterministic document grouping recognizes narrow
existing-question structures; users check source wording and correct ambiguity.
No AI, semantic answer inference or generated questions. Extraction limitations
and safety budgets are in the import pipeline.

GitHub CI runs verification and a separate Chromium E2E job on pull requests
and pushes to `main`. No deployment is configured.

## Flashcards

Open a saved StudySet and choose Flashcards, one optional topic, and a card count.
Cards use saved order, with a default of up to 20. Each card shows only the question
until Reveal answer; the correct answer and optional explanation are absent from
the rendered content before reveal. Again or Know it records a self-rating and
immediately advances. Again means future review, with no current-session requeue
or spaced repetition; neither rating creates a Learn attempt or correctness result.
The summary counts cards reviewed, Know it, and Again, without a score.

FlashcardProgress stores only stable StudySet/Question IDs, review counters, and
the last rating in a separate IndexedDB store. Layout v3 preserves v1/v2 data;
StudySet schemaVersion stays 1.0.0 and studying never changes its revision.
Active sessions and configuration are temporary; reload returns to setup.
Add Material preserves both progress types through stable Question IDs, and
deleting a StudySet atomically removes both. Failed writes show a warning while
study remains usable; stale writes cannot overwrite newer progress.

## Test

Open a saved StudySet and choose Test, one optional topic, a question count, and
question shuffle (on by default). The initial count is up to 20. All topics includes
uncategorized questions. Shuffle uses Fisher–Yates over eligible questions before
taking the count; disabling it preserves saved order. Choices always retain their
canonical order, and navigating never reshuffles the session.

Select, change or clear answers and use Previous / Next, including while unanswered.
No option is identified as correct, and no explanation or correctness feedback is
rendered before submission. Finish test submits answered tests; unanswered questions
require explicit confirmation and earn zero points within the full denominator.
Results show correct / total, the percentage rounded to the nearest integer, and
separate correct, incorrect and unanswered counts. Review mistakes shows only wrong
and unanswered questions, one at a time, with canonical answers and explanations.
Take another test returns to setup rather than starting automatically.

Test sessions, results and review position exist only in memory. Reload returns to
setup. Test never writes Learn UserProgress, FlashcardProgress, Test history or
canonical content. IndexedDB stays at layout 3, schemaVersion stays 1.0.0, and Test
never increments StudySet.revision. No timer, grading bands or pass/fail is provided.

## Frontend layout

Pages share a centered canvas with a `45rem` maximum width (about 720px at the
default font size), fluid gutters, and a single column. Desktop space provides
breathing room; the canvas has no device frame.

Only an active structured mapping workflow widens the canvas to `78rem` (about
1248px). Source, mapping controls, and preview form a desktop workspace above
`68rem`; narrower screens use an ordered vertical flow. Document question review
widens to `72rem`, with source/edit columns above `68rem` and a sequential mobile
editor with expandable original source. The Library, intent selection and notes
extraction, saved Library and StudySet details retain the focused shell.

Tailwind CSS v4 is integrated through the official Vite plugin. Its CSS-first
`@theme` in `apps/web/src/styles/global.css` defines semantic colors, typography,
spacing, and radii (for example, `bg-accent`, `text-muted`, and `rounded-surface`).
Pages use utility classes; shared link treatments and accessible focus styles
live in the stylesheet's component and base layers. Source scanning is scoped
to the frontend `src` directory, independent of the workspace command location.
No separate Tailwind JavaScript or PostCSS configuration is needed.

History routing uses `/`, `/import`, `/study-sets/:id`, `/study-sets/:id/add-material`, `/study-sets/:id/learn`, `/study-sets/:id/flashcards`, `/study-sets/:id/test`, and a fallback for unknown paths. A future
static host must serve `index.html` for application routes so direct links work.
