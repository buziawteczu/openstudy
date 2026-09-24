# ADR 0003: Decouple source formats from the study engine

- Status: Proposed
- Date: 2026-09-23

## Context

V1 accepts JSON and ZIP files containing JSON. Future sources may include CSV, Moodle, Anki, DOCX, PDFs, scans, and community-defined formats. Document-oriented sources also require extraction into paragraphs, tables, pages, images, or other normalized structures before questions can be created.

A raw source, an extracted document, a canonical StudySet, and a study session are different concepts. Collapsing them would make each new adapter change core study behavior.

## Decision

Source ingestion, mapping, canonical validation, persistence, and study will be separate boundaries.

Structured adapters produce canonical StudySet candidates. Future binary-document processing follows:

```text
binary source -> SourceDocument -> NormalizedDocument
              -> Importer or Generator -> StudySet candidate
```

The study engine consumes only validated canonical questions. It will not read files, inspect source field names, parse archives, or depend on document extraction types.

Source adapters may preserve provenance, but provenance will not be required for answer evaluation. Community adapters should be able to target import contracts and the canonical schema without modifying study logic. No plugin registry is required now.

## Consequences

- New source formats can be added with limited impact on study modes.
- Import errors and uncertainties remain visible before content reaches study.
- Document extraction can evolve without turning document blocks into question fields.
- Some source fidelity will intentionally remain outside the canonical StudySet and needs a provenance/retention decision.
- Boundary-level integration tests are required from source through mapping and validation.
- Contributors need concise adapter contracts when the first non-core adapter is implemented.

## Alternatives considered

### Add source-specific fields to Question

Rejected because canonical content would accumulate adapter concerns and make study logic source-aware.

### Build a universal document model into V1

Rejected because V1 does not parse documents and the necessary fidelity is not yet known.

### Require every importer to output application persistence records

Rejected because it couples adapters to storage and bypasses a shared validation and lifecycle boundary.

### Dynamically loaded plugin system now

Rejected as over-engineering. A clear transformation boundary is sufficient until real third-party loading requirements exist.

## Open questions

- What is the smallest stable adapter contract for V1 JSON mapping?
- How are saved mappings identified and reused?
- How much source provenance belongs in canonical data?
- Are original SourceDocuments retained or disposable?
- What packaging model should community adapters use when they become real?
