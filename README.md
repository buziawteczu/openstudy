# OpenStudy

A local-first, mobile-friendly study tool. The current application foundation
contains a local StudySet Library, local DOCX/text-PDF/JSON/ZIP ingestion,
explicit structured mapping/validation, document-question review, and a not-found page.
JSON/ZIP field mapping and DOCX/text-PDF existing-question review produce an
all-valid canonical candidate that can be saved to IndexedDB. Document notes stop
at extracted content: creating questions from notes is not supported. A saved
StudySet can also receive new material through an exact-match merge preview and
an explicit update. Study modes
are not implemented yet. See the
[import pipeline](docs/import-pipeline.md) for supported shapes and safety limits.

## Repository

- `apps/web`: React/TypeScript/Vite/Tailwind CSS frontend, component tests, and Playwright smoke tests.
- `packages/schema`: canonical StudySet validation, migrations, and JSON Schema.
- `packages/import-core`: neutral structured/document contracts, record-array discovery, document normalization, and inspection; no file APIs or canonical mapping.
- `packages/structured-mapping`: `@openstudy/mapping`, pure explicit field mapping, document-question grouping/review transformations, issues, and canonical candidate validation.
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
and frontend tests, all builds, and JSON Schema freshness checking.
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
notes intent, inline corrections/exclusion, local Library save/reload/delete, reset/errors,
200% text scaling, and layout at widths
320, 375, 390, 768, 1440, and 1920px. Local visual captures and failure traces are written to
the ignored `apps/web/test-results/` directory.

Supported inputs are DOCX, PDF with selectable text, JSON, and ZIP containing
JSON. Scanned/image-only PDFs, OCR and legacy DOC are unsupported. Processing
stays on-device. Only a validated canonical StudySet and its derived Library
summary are saved; raw files, source rows, extraction blocks and review state are
not retained. Deterministic document grouping recognizes narrow
existing-question structures; users check source wording and correct ambiguity.
No AI, semantic answer inference or generated questions. Extraction limitations
and safety budgets are in the import pipeline.

GitHub CI runs verification and a separate Chromium E2E job on pull requests
and pushes to `main`. No deployment is configured.

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

History routing uses `/`, `/import`, `/study-sets/:id`, `/study-sets/:id/add-material`, and a fallback for unknown paths. A future
static host must serve `index.html` for application routes so direct links work.
