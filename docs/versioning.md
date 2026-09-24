# Versioning and compatibility

## Two different versions

OpenStudy must keep format evolution separate from content evolution.

| Version | Meaning | Example |
| --- | --- | --- |
| `schemaVersion` | Version of the canonical StudySet file/data format | Study schema `1.2` |
| StudySet `revision` | Version of a particular collection's content | Biology Exam, revision `4` |

Changing a title, adding questions, or replacing a source may create a StudySet revision without changing `schemaVersion`. Adding a new required field or question representation may change `schemaVersion` without implying that a user's content has been revised.

The fields must never be reused for one another.

## Schema version declaration

Every canonical StudySet declares a schema version, conceptually:

```json
{
  "schemaVersion": "1.0"
}
```

This is illustrative, not the schema definition. Unversioned JSON is source data that needs mapping unless a documented legacy import rule says otherwise.

## Compatibility goals

OpenStudy should aim for these guarantees:

- Files written by a supported older schema version remain readable through deterministic migrations.
- A reader never silently treats an unknown major version as the current format.
- Unsupported future versions produce an understandable compatibility error without modifying the source.
- Migration does not depend on network access, AI, Jev, or source-document reprocessing.
- Importing and migrating are non-destructive until the user confirms persistence.
- Exported data declares enough version information for another implementation to choose a compatible reader.
- Test fixtures preserve representative files for every supported schema version.

The number of prior major versions supported at once is not decided in PR 0.

## Deterministic migrations

Migrations are explicit, testable, version-to-version transforms:

```text
1.0 -> 1.1 -> 1.2
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

## Semantic versioning considerations

Semantic versioning is a useful starting vocabulary for the schema:

- **Major:** incompatible canonical representation or semantics that an older reader cannot safely consume.
- **Minor:** backward-compatible additions that conforming readers can ignore or handle according to documented extension rules.
- **Patch:** corrections or clarifications that do not change valid serialized data semantics.

This policy needs precision before publishing schema `1.0`. JSON readers do not automatically gain compatibility merely because a field is optional. Unknown question types, changed validation rules, and tightened constraints can be behaviorally breaking even when the JSON shape remains readable.

The version syntax itself must be defined. The example `"1.0"` may represent major/minor format compatibility rather than a package's full release version.

## StudySet revision semantics

A StudySet revision records an explicitly accepted content change, potentially including:

- initial creation;
- additional material;
- reviewed updates or replacement of a source;
- manual edits;
- question removal or restoration.

Revision identity should support provenance and progress decisions. It should not be incremented merely because the data was migrated to a new schema representation with no content-semantic change, unless the eventual revision policy explicitly says otherwise.

Unresolved choices include:

- monotonic integer versus opaque immutable revision ID;
- full snapshots versus change sets;
- branching or only linear local history;
- number and size of retained revisions;
- rollback behavior for progress created after a revision;
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

- What exact schema-version syntax will version 1 use?
- Which additive changes can older readers safely ignore?
- How many prior major versions will the application support?
- Does a validation-rule tightening require a minor or major schema change?
- What is the StudySet revision identifier and retention model?
- Does representation-only migration create a new StudySet revision?
- When should the schema package and web application version independently?
- Which export round-trip properties can be guaranteed without preserving unknown fields forever?
