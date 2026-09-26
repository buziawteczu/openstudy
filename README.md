# OpenStudy

A local-first, mobile-friendly study tool. The current application foundation
contains an empty StudySet Library, an Import placeholder, and a not-found page.
Importing, persistence, and study modes are not implemented yet.

## Repository

- `apps/web`: React/TypeScript/Vite frontend, component tests, and Playwright smoke tests.
- `packages/schema`: canonical StudySet validation, migrations, and JSON Schema.
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

These commands cover both workspaces. `verify` runs typecheck, schema and
frontend tests, both builds, and JSON Schema freshness checking.
`npm run check:json-schema` and `npm run generate:json-schema` still target the
schema package.

To install the Chromium test browser and run the smoke suite against the built app:

```sh
npm exec --workspace @openstudy/web -- playwright install chromium
npm run build
npm run test:e2e
```

The suite starts and stops its own preview server on port 4173. It checks
navigation, direct routes, keyboard focus, 200% text scaling, and layout at widths
320, 375, 390, 768, 1440, and 1920px. Local visual captures and failure traces are written to
the ignored `apps/web/test-results/` directory.

GitHub CI runs verification and a separate Chromium E2E job on pull requests
and pushes to `main`. No deployment is configured.

## Frontend layout

Pages share a centered canvas with a `45rem` maximum width (about 720px at the
default font size), fluid gutters, and a single column. Desktop space provides
breathing room; the canvas has no device frame. CSS tokens in
`apps/web/src/styles/global.css` define the small styling foundation.

History routing uses `/`, `/import`, and a fallback for unknown paths. A future
static host must serve `index.html` for application routes so direct links work.
