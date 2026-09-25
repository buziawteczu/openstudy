# Versioning and compatibility

## Two different versions

OpenStudy must keep format evolution separate from content evolution.

| Version | Meaning | Example |
| --- | --- | --- |
| `schemaVersion` | Version of the canonical StudySet file/data format | Study schema `1.0.0` |
| StudySet `revision` | Version of a particular collection's content | Biology Exam, revision `4` |

Changing a title, adding questions, or replacing a source may create a StudySet revision without changing `schemaVersion`. Adding a new required field or question representation may change `schemaVersion` without implying that a user's content has been revised.

The fields must never be reused for one another.

## Schema version declaration

Every canonical StudySet declares a schema version, conceptually:

```json
{
  "schemaVersion": "1.0.0"
}
```

Schema `1.0.0` uses a full semantic-version string and the current validator accepts exactly `"1.0.0"`. Unversioned JSON is source data that needs mapping unless a documented legacy import rule says otherwise. PR 1 implements no migration or version negotiation.

## Compatibility contract

Schema `1.0.0` is the first canonical OpenStudy schema version.

OpenStudy guarantees backward compatibility for supported historical versions: newer versions must be able to read them through an explicit parser or deterministic migration path. A historical version is supported only when that path exists and has compatibility fixtures.

Forward compatibility is not guaranteed. An older OpenStudy reader does not have to understand a future schema version. Canonical objects are strict, so a `1.0.0` reader may reject a future `1.1.0` document containing an optional field it does not know. This is intentional.

Unknown future schema versions are rejected explicitly. They are never treated as the current schema or interpreted heuristically. Migration does not depend on network access, AI, Jev, or source-document reprocessing.

Importing and migrating must remain non-destructive until the user confirms persistence. PR 1 implements no migration or version-dispatch machinery; that belongs to PR 2.

## Deterministic migrations

Migrations are explicit, testable, version-to-version transforms:

```text
1.0.0 -> 1.1.0 -> 1.2.0
```

Each step should:

- accept one declared input version;
- produce one declared output version;
- preserve stable StudySet and question identities unless the migration contract explicitly requires otherwise;
- report data it cannot transform safely;
- avoid environmental inputs such as time, randomness, locale, network responses, or model output;
- have fixtures for valid, invalid, and edge-case data.

Direct shortcuts such as `1.0 -> 1.2` may be added for performance only if they are behaviorally equivalent and tested. An LLM must never interpret an old schema at runtime.

Migration changes representation. It does not decide whether newly imported source content is the same question or whether progress should transfer; those are StudySet lifecycle decisions.

## Schema version changes

The canonical schema uses full `major.minor.patch` syntax. This version is independent from the npm package version and any future application version.

- **Major:** required for a breaking serialized-contract change. Breaking changes include removing or renaming serialized fields, making an optional field required, tightening validation so previously valid canonical files become invalid, changing field semantics, changing identity semantics, or changing reference semantics.
- **Minor:** may be used for a backward-compatible additive change, such as adding an optional field. Newer readers must still accept supported older files. Older readers may reject the new document because forward compatibility is not guaranteed.
- **Patch:** must not intentionally change the serialized data contract. Documentation, implementation, or error-message corrections may use a patch only when the accepted canonical data set and its semantics remain unchanged.

Adding a new question discriminator or changing how an existing discriminator behaves requires explicit compatibility analysis. A JSON shape that remains parseable can still be semantically breaking.

## StudySet revision semantics

A StudySet revision records an explicitly accepted content change, potentially including:

- initial creation;
- additional material;
- reviewed updates or replacement of a source;
- manual edits;
- question removal or restoration.

Revision identity should support provenance and progress decisions. It should not be incremented merely because the data was migrated to a new schema representation with no content-semantic change, unless the eventual revision policy explicitly says otherwise.

Schema 1.0.0 represents the current content revision as a positive JavaScript-safe integer, beginning at `1`. A representation-only schema migration does not increment the content revision. The schema validates only the value's structure; it does not compare revisions or implement increment, history, or rollback behavior.

Unresolved choices include:

- full snapshots versus change sets around the positive revision number;
- branching or only linear local history;
- number and size of retained revisions;
- rollback behavior for progress created after a revision;
- which content and metadata operations increment the number;
- whether imports that contain only exact duplicates create a revision.

## Package and application versions

The future `@openstudy/schema` package, web application, and canonical schema may have different release cadences:

- application version describes a deployed product build;
- package version describes a distributable implementation artifact;
- `schemaVersion` describes serialized data compatibility.

They should not be assumed equal. Whether the schema package is released independently from the app remains open until external consumers or multiple internal packages create a concrete need. It should remain in this repository initially.

## Compatibility fixtures

The future test suite should retain:

- smallest valid file for each schema version;
- representative full files;
- files for each supported question type;
- boundary and Unicode cases;
- invalid files with expected issue codes;
- every migration input and expected output;
- round-trip examples where export stability is promised;
- future-version and unknown-question-type failures.

Fixtures should be reviewed as public compatibility contracts, not incidental test data.

## Open questions

- How will PR 2 dispatch exact historical versions and chain deterministic migrations?
- Which historical versions will each application release support?
- What error contract will distinguish unknown future versions from known but unsupported historical versions?
- What snapshot or change-set retention model accompanies the positive revision number?
- Which content operations increment revision, including no-op imports?
- When should the schema package and web application version independently?
- Which export round-trip properties can be guaranteed without preserving unknown fields forever?
