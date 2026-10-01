# Storage and privacy

## V1 position

OpenStudy is local-first in V1:

- no user account;
- no authentication;
- no backend database;
- no cloud storage;
- no required network call for import, validation, migration, study, or progress;
- imported StudySets and UserProgress stay on the device.

This is both a product choice and an architectural boundary. Local-first reduces disclosure and service dependency, but it does not make browser storage permanent or automatically secure.

## Local persistence direction

IndexedDB now stores canonical StudySets through a small web storage module.
Database `openstudy-library` uses layout version `1`, with `studySets` and
`libraryEntries` stores keyed by the canonical StudySet ID. The layout version
is independent of canonical `StudySet.schemaVersion` (`1.0.0`). Save and delete
update both stores in one transaction; list reads summaries only. Entries sort
by title using code-unit order, then ID for ties. Reads use the existing schema
migration and final validation path without automatically writing back migrated
data. The original JSON/ZIP/DOCX/PDF files, extracted blocks, mapping and review
sessions, and UserProgress are not stored. There is no localStorage fallback.

Persistence should keep separable records for:

- canonical StudySet content and revision metadata;
- source and provenance metadata required after import;
- UserProgress;
- active session state, if crash recovery requires it;
- future LearningPlans;
- optional source documents or media only if the retention policy permits them.

Logical separation matters even if V1 uses one physical IndexedDB database. Deleting progress should not require deleting content, and exporting content should not accidentally include private learning history unless requested.

## Local data safety

Browser storage can be cleared by the user, browser, operating system, privacy settings, storage pressure, or site-data policy. Private browsing may provide weaker or temporary persistence. OpenStudy must not describe local storage as a backup.

Likely lightweight recovery enhancements before cloud sync are:

- export a canonical StudySet;
- export progress separately or as an explicitly combined backup;
- restore a validated backup;
- show when data was last exported, without implying that an export exists if the application cannot verify it.

The minimum backup/restore experience required for V1 remains a product question. Any restore path must use the same schema-version and validation rules as import.

## Source-file handling

V1 should read user-selected JSON and ZIP data locally. Source data should not leave the device for essential processing.

The current local Library retains only canonical StudySet content and its summary.
Raw source files and extraction/review state are discarded after the import
session. A future feature would need a separate retention decision to keep them.

Broader retention choices include:

- keeping only canonical content minimizes storage and exposure but limits reprocessing and provenance detail;
- retaining original files enables future remapping or auditing but increases storage, privacy, and lifecycle obligations;
- retaining a digest and locator metadata without the full source may be a useful middle ground.

The import UI does not retain source bytes invisibly.

Temporary buffers and failed imports should be released after the workflow unless needed for a user-visible retry. Debug logs must not casually include full questions, source documents, answer keys, or filenames that may reveal sensitive subjects.

## Privacy expectations

V1 should make these expectations understandable:

- content and progress are stored for the current browser profile and origin;
- another person or process with access to that browser profile may access local data;
- clearing site data can remove StudySets and progress;
- no OpenStudy account can recover local data;
- essential functionality does not send source material to an AI provider or backend;
- choosing a future external assistant would require separate, explicit disclosure and consent.

Analytics, telemetry, and crash reporting are not assumed. If added later, they require a separate decision covering opt-in behavior, content redaction, data minimization, retention, and self-hosting expectations.

## Future optional cloud storage

Hosted collections or sync may later add:

- Postgres for users, ownership, sharing metadata, revision indexes, and synchronization state;
- S3-compatible object storage for source binaries, media assets, large exports, and immutable content objects;
- explicit local/remote reconciliation over the same canonical identities and schema versions.

Cloud support must be optional and must not turn the canonical format into a provider-specific API object.

### Why S3-compatible rather than one provider

An S3-compatible storage boundary offers a widely implemented object model while avoiding domain coupling to one vendor. Provider SDK objects, signed-URL formats, bucket naming, lifecycle configuration, encryption options, and access policies should stay in infrastructure code.

This supports commercial hosting, self-hosting, and community deployments with fewer domain changes. Compatibility is not perfect across providers, so any later adapter should depend only on the subset OpenStudy actually needs and test provider-specific behavior. No storage adapter is required in V1.

## Confidential and private sharing

Future private sharing is not simply "upload local data." It requires decisions about:

- authentication and authorization boundaries;
- encryption in transit and at rest, and possibly end-to-end encryption;
- access revocation and signed-link leakage;
- tenant isolation;
- logs, backups, deletion, retention, and data residency;
- whether source documents, answer keys, and progress have different sensitivity;
- abuse handling and contributor-operated instances.

These concerns must be threat-modeled before a hosted feature is promised. They are outside V1.

## Capacity and performance

Local limits must be explicit and tested. Unknowns include:

- maximum StudySet and question count;
- total canonical JSON size;
- retained revision count;
- media and original-source storage budget;
- peak memory during ZIP decompression, mapping, and migration;
- IndexedDB quota and eviction behavior across supported browsers;
- performance on lower-memory mobile devices.

Import safety limits are starting guardrails, not proof that a dataset will provide a responsive study experience.

## Open questions

- Which IndexedDB wrapper, if any, offers the simplest reliable migrations and transactions?
- What local dataset and asset sizes will V1 support?
- Must V1 ship StudySet export, progress export, and restore, or may some follow immediately after launch?
- Are original inputs retained, discarded, or controlled per import?
- How many StudySet revisions can be retained locally, and how is rollback exposed?
- What does deleting a StudySet do to progress, sources, revisions, and assets?
- Which browsers and storage-eviction behaviors are in the V1 support matrix?
- If sync arrives, what conflict semantics preserve local-first ownership and offline edits?
