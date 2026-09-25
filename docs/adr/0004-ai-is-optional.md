# ADR 0004: AI is optional and outside essential behavior

- Status: Proposed
- Date: 2026-09-23

## Context

AI could help suggest field mappings, identify semantic duplicates, generate questions from documents, classify structure, or review question quality. It can also be unavailable, costly, non-deterministic, privacy-sensitive, and wrong. Answer keys and data migrations require stronger guarantees than unreviewed model output provides.

Jev and MCP are possible future integrations, but neither is needed to validate the core product.

## Decision

All essential V1 functionality will work without AI:

- ingestion;
- mapping through deterministic or manual controls;
- validation;
- schema migration;
- persistence;
- study behavior;
- progress tracking.

Future AI assistance may propose mappings, semantic duplicate candidates, generated questions, structure classifications, or quality concerns. Suggestions must be reviewable and must pass the same canonical validation and lifecycle decisions as manual input.

Jev may later support bounded reviewed decisions such as duplicate versus update versus different question. It will not perform schema migration, JSON validation, document extraction, correct-answer invention, stable-ID generation, or core study behavior.

MCP may expose operations over the open schema. MCP clients and models may produce schema-conforming candidates; they do not define the schema. No provider abstraction, Jev dependency, or MCP server is introduced now.

## Consequences

- The product remains usable offline and by privacy-conscious users.
- Tests for core behavior are deterministic and do not require model credentials.
- AI-generated or classified content needs visible uncertainty, provenance, and review.
- Optional assistance cannot bypass validation or silently overwrite questions.
- Provider-selection and abstraction work is deferred until a concrete assisted workflow proves valuable.
- Some users will perform more manual mapping or duplicate review, which is an accepted trade-off for trust and portability.

## Alternatives considered

### Require an LLM for arbitrary JSON import

Rejected because it would make V1 availability, privacy, cost, and correctness dependent on a model.

### Use an LLM for schema migrations

Rejected because migrations must produce repeatable, testable results for the same input.

### Automatically accept AI-generated questions and answers

Rejected because generated correctness cannot be assumed and answer invention is unsafe.

### Build a general AI provider interface in PR 0

Rejected because no implemented AI use case yet defines the necessary contract.

## Open questions

- Which assisted use case creates enough value to validate first?
- What review and provenance are required for generated questions?
- Which source content, if any, may be sent to an external provider with explicit consent?
- How should optional local models or self-hosted providers be represented without changing the core contract?
