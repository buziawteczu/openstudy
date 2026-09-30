# `@openstudy/import-core`

Framework-independent, browser/Node-compatible contracts and inspection for
already-normalized structured source data and extracted document blocks. No runtime dependencies or coupling
to `@openstudy/schema`, React, storage, or file APIs.

## Public API

| API | Purpose |
| --- | --- |
| `SourceValue`, `SourceRecord`, `SourceValueType` | Serializable nested values, record fields, and observed value types |
| `SourceDescriptor` | Upstream source key, label, filename, media type, and format |
| `NormalizedStructuredSource` | Descriptor plus an already-extracted structured value |
| `RecordCollection`, `MappingCandidate` | Explicit neutral collections prepared by an adapter, before mapping |
| `StructuredSourceAdapter` | Pure recognition/projection contract |
| `structuredRecordsAdapter` | Format-neutral discovery of object-only record arrays |
| `inspectMappingCandidate(input)` | Validate a neutral candidate and return detached inspection summaries |
| `ImportInspection`, `CollectionInspection`, `FieldInspection`, `FieldSample` | Collection counts, field presence/types, and original sample values |
| `ImportResult<T>`, `ImportFailure`, `ImportPath` | Discriminated expected failures with machine-readable context |
| `SourceDocument`, `ExtractedDocument`, `NormalizedDocument` | Source metadata, original extraction, detached normalized content |
| `DocumentBlock`, `DocumentRun`, `TextBlock`, `TableBlock`, `TableCell`, `PageTextBlock` | Ordered neutral blocks, formatting, cells and page items |
| `DocumentWarning`, `DocumentSummary` | Extraction caveats and source-structure counts |
| `normalizeDocument(extracted)`, `summarizeDocument(document)` | Pure line-ending normalization and source-role/page counts |

The type names are package contracts, not alternate canonical entities. A
mapping candidate is **source data ready to be mapped**, not a StudySet candidate.
Raw File/Blob/bytes and browser/parser objects deliberately have no types here.

## Document boundary

`SourceDocument` is a serializable ingestion descriptor (SourceDescriptor, format,
byte length), not a file, extracted content, canonical Source or StudySet.
`ExtractedDocument` retains original ordered blocks, media presence (`true`,
`false` or `unknown`), and machine-readable warnings. `NormalizedDocument` is a
detached copy changing only CRLF/CR to LF. Wording, spaces, run marks, order,
tables, coordinates and locators are retained. The web result keeps the original
extracted representation separately; no destructive minification.

Text blocks contain runs and optional heading/style/list metadata. Tables contain
ordered rows/cells, nested blocks, column spans and vertical-merge signals.
Page-text blocks contain 1-based pages, dimensions and ordered items with
coordinates/direction/line breaks. Unsupported blocks may have placeholders.
Temporary keys/locators reference content within the same ingestion result;
no canonical identity is generated.

Normalization accepts valid resource-bounded extractor output, not arbitrary
unknown data or file bytes. Readonly types are not runtime freezing. Safety and
parser budgets belong upstream. No automatic document-to-record adapter,
question inference, mapping or generation is implemented in import-core.

## Adapter contract

```ts
interface StructuredSourceAdapter {
  readonly id: string;
  readonly inspect: (
    source: NormalizedStructuredSource,
  ) => ImportResult<MappingCandidate>;
}
```

An adapter recognizes a normalized structure and exposes its record collections
without deciding question semantics. It returns its own `id` as `adapterId`
and preserves the source descriptor. It must not mutate caller data, generate
canonical IDs, read files, use time/randomness/network/AI, or persist anything.
Calls are synchronous because all ingestion/extraction has already happened.
Expected failures are explicit results; programmer invariant violations may throw.

`structuredRecordsAdapter` is the first production adapter. It accepts already-
normalized source values and discovers object-only arrays, including empty arrays,
at the root or inside nested container objects/arrays. It stops traversing when it
finds a collection: arrays inside records remain nested field data. Mixed arrays
are not filtered into collections; primitives and standalone record objects
without record arrays return `no-record-collection`. No field names have special
meaning. Source order is preserved, and collection keys use escaped JSON-pointer
locators prefixed with `records:` (not canonical IDs).

The adapter returns readonly references to the normalized source records to avoid
another full copy. Callers must provide validated, resource-bounded, acyclic data
and retain ownership of that input. `inspectMappingCandidate` independently
validates the projected candidate and returns detached summaries. The web JSON
ingestion boundary enforces those budgets before calling either API.
There are no dispatch registries or runner/plugin frameworks.

## Inspection behavior

Collections retain their supplied order and unique, non-blank keys. Empty
collections succeed with zero records and fields; no collections returns
`no-record-collection`. Empty records remain records.

Each field reports its name, presence count, sorted observed types, and the first
three present values with their record indexes. Missing differs from explicit
`null`. Field names and type labels are sorted by code units, never locale.
Samples are not stringified, coerced, or deduplicated; nested objects/arrays survive.
Inspection does not select which collection will become questions.

The runtime boundary accepts `unknown` to check malformed neutral candidate
output from JavaScript/adapters. It does not discover collections in arbitrary
source data. Metadata envelopes are closed; record fields are unrestricted data.
Values must be finite numbers, strings, booleans, null, dense arrays, or plain
data objects (including null-prototype objects). Functions, symbols, bigint,
class instances, cycles, accessors, and serialization-losing properties fail.
Source data is inspected without invoking getters. Traversal is iterative;
successful metadata and samples are detached snapshots, with readonly public types.

This is normalized-data validation, **not** a raw-input sandbox or file/archive
safety layer. Resource budgets and parser/extraction safety belong upstream.

## Temporary identity and failures

Descriptor and collection `key` strings are import-local tokens supplied by the
caller/adapter. Collection keys are scoped to one candidate; record indexes
locate rows only within that candidate. Source fields named `id` stay source
values. Keys can contain spaces/paths/Unicode, have no canonical ID constraints,
and are never automatically copied to canonical IDs or used for deduplication.

Expected failure codes:

- `unsupported-source`: adapter does not recognize normalized input; carries adapter ID.
- `no-record-collection`: candidate has no collections; carries source key.
- `invalid-normalized-data`: invalid neutral shape/metadata, duplicate collection
  keys, or non-serializable values; carries a neutral path and machine-readable reason.

There is no UI error copy or parsing error model here.

## Next boundaries and development

Local web JSON/ZIP ingestion delivers normalized structured values to this adapter.
Each JSON input/ZIP entry can have its own source descriptor and candidate.
The separate [`@openstudy/mapping`](../structured-mapping/README.md) package now
turns one explicitly selected structured collection into an all-valid canonical
candidate in memory. It owns serializable object-key mapping paths, explicit
zero/one-based or exact-text answer interpretation, canonical identity/provenance,
sampled preview, and record/whole-set validation using `@openstudy/schema`.
Import-core remains schema-free and does not interpret question semantics.
Local DOCX/PDF extraction supplies the separate document model. The mapping
package's focused `documents/` modules now group existing questions using explicit
source structure, retain temporary candidates/evidence/provenance, apply reviewed
corrections and validate the complete canonical candidate. Notes intent never
runs grouping. Import-core still has no question semantics or schema dependency. See
[the import pipeline](../../docs/import-pipeline.md) for ownership and future flows.

From the repository root, existing workspace commands include this package:

```sh
npm run typecheck
npm test
npm run build
npm run verify
```

The production TypeScript build uses only `ES2022` libraries and no ambient
Node/browser types. Tests use the repository's existing Node test runner/`tsx`
toolchain and synthetic in-memory data. This package implements no file ingestion, mapping, persistence,
canonical construction, study behavior, or AI functionality is implemented.
