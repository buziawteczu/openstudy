# ADR 0002: Use one canonical, versioned StudySet schema

- Status: Proposed
- Date: 2026-09-23

## Context

Learning material can arrive in many shapes. If study behavior understands each source shape, every importer creates new branches in validation, persistence, progress, and UI logic. The serialized format will also evolve independently from the content of a particular StudySet.

Old files need a predictable compatibility path. Runtime interpretation by an LLM would be non-deterministic and unavailable offline.

## Decision

Every accepted source will become one canonical StudySet model before persistence or study. The canonical data will declare `schemaVersion`. That version is separate from the revision of an individual StudySet's content.

The question model will contain an explicit type discriminator. V1 will implement only single-choice behavior; future types require deliberate schema and study-engine evolution.

Supported old schema versions will be read through explicit, deterministic, testable, version-to-version migrations. Unknown or unsupported versions will fail with an understandable compatibility error. AI and Jev will not perform schema migration.

The schema may later be published as `@openstudy/schema`, but it will remain in this repository initially. Package and application release independence is not decided yet.

## Consequences

- Importers, persistence, and study behavior share one contract.
- Compatibility fixtures and migration tests become long-lived public responsibilities.
- Schema changes require version classification and documented reader behavior.
- Source-specific detail that does not belong in canonical content must stay in provenance or upstream artifacts.
- A canonical format improves portability and MCP/tool integration because external tools can target an open contract.
- The first schema should avoid unnecessary fields while preserving stable identity, provenance references, and type evolution.

## Alternatives considered

### Let each importer define its own runtime shape

Rejected because it couples study logic to source formats and multiplies validation and migration paths.

### Convert directly into UI view models

Rejected because UI state is not a portable data contract and would make non-UI consumers difficult.

### Infer old formats with an LLM

Rejected because migration must be deterministic, offline-capable, testable, and safe for answer keys.

### Create a separate schema repository immediately

Rejected as premature coordination and release overhead before external consumers exist.

## Open questions

- What exact ID and media representations belong in schema 1.0?
- What semantic-versioning policy applies to validation changes and new question types?
- How many prior major versions will readers support?
- When, if ever, should the schema package and application version independently?
