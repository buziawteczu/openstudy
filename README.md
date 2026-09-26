# OpenStudy

A local-first, mobile-friendly study tool. The current application foundation
contains an empty StudySet Library, local JSON/ZIP ingestion, and a not-found page.
Ingestion stops at neutral collection inspection; mapping, canonical import,
persistence, and study modes are not implemented yet. See the
[import pipeline](docs/import-pipeline.md) for supported shapes and safety limits.

## Repository

- `apps/web`: React/TypeScript/Vite/Tailwind CSS frontend, component tests, and Playwright smoke tests.
- `packages/schema`: canonical StudySet validation, migrations, and JSON Schema.
- `packages/import-core`: neutral structured import contracts, record-array discovery, and deterministic inspection; no file APIs or canonical mapping.
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

These commands cover all workspaces. `verify` runs typecheck, schema, import-core,
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
navigation, direct routes, keyboard focus, local JSON/ZIP ingestion, reset/errors,
200% text scaling, and layout at widths
320, 375, 390, 768, 1440, and 1920px. Local visual captures and failure traces are written to
the ignored `apps/web/test-results/` directory.

GitHub CI runs verification and a separate Chromium E2E job on pull requests
and pushes to `main`. No deployment is configured.

## Frontend layout

Pages share a centered canvas with a `45rem` maximum width (about 720px at the
default font size), fluid gutters, and a single column. Desktop space provides
breathing room; the canvas has no device frame.

Tailwind CSS v4 is integrated through the official Vite plugin. Its CSS-first
`@theme` in `apps/web/src/styles/global.css` defines semantic colors, typography,
spacing, and radii (for example, `bg-accent`, `text-muted`, and `rounded-surface`).
Pages use utility classes; shared link treatments and accessible focus styles
live in the stylesheet's component and base layers. Source scanning is scoped
to the frontend `src` directory, independent of the workspace command location.
No separate Tailwind JavaScript or PostCSS configuration is needed.

History routing uses `/`, `/import`, and a fallback for unknown paths. A future
static host must serve `index.html` for application routes so direct links work.
