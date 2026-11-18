# Version-3 project fixtures

These are complete v3 data-contract examples. They can be embedded into a built
editor’s `picquine-project` JSON slot. JSON files themselves are not editor HTML or
update packages; do not rename them to HTML.

| Fixture | Intended behavior |
| --- | --- |
| [project-v3-heic-required.json](project-v3-heic-required.json) | HEIC is current content; `org.picquine.heic` v1 is required |
| [project-v3-heic-original.json](project-v3-heic-original.json) | PNG is current content; HEIC is optional original provenance |
| [project-v3-fork-optional.json](project-v3-fork-optional.json) | Unknown optional fork settings and a declared JSON asset survive round-trips |

The HEIC bytes are identical to `tests/orange.heic`. The PNG is a real 16×16
orange image matching the fixture's decoded pixels. The fork's JSON file is
inert preset data, not executable code and not a real ICC color profile.

Validate each example against `../schemas/project-v3.schema.json`; additionally
validate HEIC occurrences against `../schemas/heic-v1.schema.json`. A JSON Schema
2020-12 validator covers structural constraints only. Run the reference,
capability and preservation checks specified in `../PROJECT-V3.md` as well.

Implementation tests compare unknown JSON subtrees semantically and
file bytes exactly before/after save, rather than comparing entire JSON strings.
