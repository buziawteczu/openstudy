# ADR 0001: Local-first V1

- Status: Proposed
- Date: 2026-09-23

## Context

OpenStudy handles user-owned learning material, answer keys, and learning progress. The essential product does not require collaboration or server coordination. Requiring an account or backend would add privacy, availability, hosting, and contributor burden before those capabilities provide V1 value.

Browser-local data is not permanent: it may be cleared, evicted, or isolated by browser profile. Local-first therefore cannot be presented as automatic backup.

## Decision

V1 will store imported StudySets and UserProgress on-device, with IndexedDB as the likely persistence technology. V1 will require no account, authentication, backend database, cloud storage, or network service for ingestion, validation, schema migration, persistence, study, or progress.

Study content and progress will be stored as separable logical records. The implementation should leave a persistence boundary where optional hosted adapters can be added later, but PR 0 does not define an adapter framework or select Dexie.

Export and restore are the preferred early recovery direction before cloud sync. Their exact V1 scope remains open.

## Consequences

- Core use can remain private, offline-capable, and inexpensive to self-host.
- Contributors can run and test the product without provisioning services.
- Users must be told that clearing browser data can remove content and progress.
- Local capacity, IndexedDB migrations, quota behavior, and transactional imports become important engineering concerns.
- Multi-device sync, shared collections, and account recovery are unavailable in V1.
- Future hosted storage must be additive and preserve the canonical format rather than replacing it with a service-specific model.
- If cloud storage is added, Postgres is a plausible metadata store and S3-compatible storage a plausible object boundary, but neither is selected or implemented now.

## Alternatives considered

### Cloud-first with required accounts

Rejected for V1 because it adds authentication, backend operations, privacy obligations, and network dependency before validating the core import-and-study value.

### Local cache backed by mandatory cloud storage

Rejected because a cache is not user-owned local-first data and would make service availability part of essential study behavior.

### Filesystem-only persistence

Not selected as the primary browser model because routine study progress and atomic updates need structured local persistence. Portable file export remains desirable.

### In-memory sessions only

Rejected because losing StudySets and progress on reload would not satisfy the product.

## Open questions

- What backup and restore capability is required for V1?
- What data sizes and browsers are supported?
- Which original source files, if any, persist after import?
- What is the retention and rollback model for StudySet revisions?
