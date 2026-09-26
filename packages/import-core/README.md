# `@openstudy/import-core`

Framework-independent, browser/Node-compatible contracts and inspection for
already-normalized structured source data. No runtime dependencies or coupling
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

The type names are package contracts, not alternate canonical entities. A
mapping candidate is **source data ready to be mapped**, not a StudySet candidate.
Raw bytes and future document block models deliberately have no types here.

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
Mapping will later turn a reviewed collection into a canonical candidate, with
explicit identity/provenance decisions and validation by `@openstudy/schema`.
DOCX/PDF extraction can retain a separate document model and project suitable
tables/records here without changing StudySet or study logic. See
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
toolchain and synthetic in-memory data. No ingestion, mapping, persistence,
canonical construction, study behavior, or AI functionality is implemented.
