# PicQuine project format, version 3

**Status: implemented.** The current editor reads/writes this contract. Older
formats are rejected; no automatic conversion is included.

## Separation of responsibilities

A project is JSON data. An editor is replaceable executable code. Assets are
immutable file bytes referenced by the project. Replacing editor code must not
replace, re-encode, rasterize or otherwise change asset bytes.

Version 3 removes duplicate file metadata from composition references:

| Location | Owns |
| --- | --- |
| Project envelope | Format/version and project-wide extensions |
| `composition` | Name, dimensions, selection and ordered layers |
| Layer | Display name, geometry, opacity, blend, text provenance and asset IDs |
| `assets[id]` | One original filename, MIME type and Base64 file payload |
| `extensions[namespace]` | Fork/feature-owned data and its explicit dependencies |

A layer's `name` is its editable display label, not the asset filename. Those two
names have different meanings and need not match. `content` and `original` are
IDs, not copies of a file's metadata and not filesystem paths.

## Envelope and core fields

The structural schema is [project-v3.schema.json](schemas/project-v3.schema.json).
Complete, valid examples are under [examples/](examples/README.md).

| Field | Meaning |
| --- | --- |
| `format` | Exactly `"picquine-project"` |
| `version` | Exactly `3`; versions describe data contracts, not editor releases |
| `composition` | Core composition object below |
| `assets` | Object mapping stable asset IDs to file records |
| `extensions` | Optional project-wide extension map |

All numeric values must be finite and representable by the reader; enforce
resource bounds before using them for allocations.

Composition fields are `name` (string), positive integer `w`/`h` (canvas pixels),
`selected` (a layer ID or null), and `layers` (bottom-to-top ordered array).
Layer IDs must be unique. A non-null selection must identify an existing layer.

Each layer requires:

- `id`: stable layer ID; independent of asset IDs and array position.
- `name`: editable display label.
- `content`: asset ID supplying current pixels.
- `original`: original imported asset ID, or null for generated artwork.
- `x`, `y`: position in canvas pixels; off-canvas coordinates are permitted.
- `w`, `h`: positive displayed dimensions in pixels, before rotation.
- `rotation`: integer clockwise degrees 0–359, about the layer center.
- `opacity`: number from 0 to 1; `visible`: boolean.
- `blend`: one of `source-over`, `multiply`, `screen`, `overlay`, `darken`, `lighten`.

Optional `text` retains the original wording and typography, independent of
raster appearance and the layer name. It has `content` and nonempty `runs`.
Each run has `content`, `fontFamily`, positive `fontSize` in **source pixels**,
`color` as `#RRGGBB`, and source-canvas baseline `x`/`y` coordinates. Thus Georgia
42 pt is recorded as 56 source pixels. Font files are not implicitly embedded;
a fork can define an extension with explicit font asset references.

Layers and assets may each have an optional `extensions` map. Composition-wide
extension settings belong on the project envelope; there is no separate
composition-scope extension map in this version. Declaring extension maps at
new scopes requires an explicitly specified format change; an old reader cannot
safely discover required features in arbitrary opaque subtrees.

## Canonical assets and references

An asset record requires `name`, `type` and `base64`. `type` is the file's MIME
type without parameters. `base64` is canonical RFC 4648 Base64, with padding and
without whitespace, representing the **exact file bytes**. MIME type appears
once, here. The object key is the ID; there is no duplicate `id` field.

IDs match `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. Allocate them once on import/creation
and preserve them across save, layer reordering and code upgrades. Their spelling
has no rendering meaning. The prefixes used in fixtures are descriptive only.
A writer may deduplicate identical files, but deduplication is not required.

Multiple layers may reference the same asset. Unedited imported artwork usually
has identical `content` and `original` IDs. Painting creates a **new** PNG asset
and changes `content`; `original` continues to identify the imported file. Do
not overwrite bytes under an existing ID: an ID identifies immutable bytes.
Replacing asset bytes intentionally allocates a new ID and updates references.

SVG remains SVG markup encoded as Base64, not a saved PNG. Rasterizing a sanitized
copy for display does not replace its stored bytes. Unknown MIME types can occur
in extension-owned payloads such as profiles or fonts; the core asset table is
not restricted to the editor's image-import menu. A codec's presence, not a MIME
label alone, determines whether it can render current layer content.

## Extension envelopes

Extension maps are keyed by stable, lowercase reverse-DNS namespaces. Reserve
`org.picquine.*` for upstream contracts. Forks should choose a namespace they control,
for example `io.github.example.print-editor`; changing repository location need
not change a published namespace.

Every extension occurrence has:

| Field | Meaning |
| --- | --- |
| `version` | Positive integer version of that extension's data contract |
| `required` | Whether understanding this occurrence is necessary for faithful editing/saving |
| `assetRefs` | Unique asset-ID array declaring additional dependencies in opaque `data` |
| `data` | Extension-owned JSON object; its extension schema defines its contents |

The same envelope structure is allowed at project, layer and asset scope. Each
occurrence is independently versioned and required/optional. An editor must
inspect **all three scopes** before deciding it can edit a document.

Do not put executable code, decoder binaries, repository locations or library
release versions into extension `data`. Those belong to the editor bundle.
Projects describe meaning and source material; editor builds provide behavior.
An extension may use asset files as inert data, but asset files must never be
automatically executed as plugins or treated as update instructions.

`assetRefs` is a dependency declaration, not duplicate storage. If opaque `data`
contains an asset ID, list it in `assetRefs`. This lets an unfamiliar editor retain
and validate dependencies without knowing the extension's private schema.
The asset to which an asset-scope extension is attached is already reachable;
it need not list itself. Ordinary core `content`/`original` references need not
be repeated in extension dependency arrays.

## Preservation and unsupported features

1. Parse and retain the complete JSON tree, including unknown object properties.
2. Update known fields in that retained tree; do not reconstruct it from a fixed
   list of fields and discard everything else.
3. Unknown optional extensions and their assets survive save **unchanged as JSON
   values and decoded bytes**. JSON whitespace and object-key ordering may differ.
4. An unknown required extension, or unsupported version of a required extension,
   prevents editing and ordinary resaving. Explain which capability is missing.
   A core-only preview may be offered only if explicitly labeled incomplete.
   An explicit upgrade-only save may copy the untouched project into a staged
   bundle that declares every required capability. This does not permit editing,
   dropping data, or guessing extension migrations in the old editor.
5. Do not automatically download code because a project names an unfamiliar
   extension. Loading and saving remain offline. Upgrading is a separate user action.
6. Unsupported optional data cannot be silently removed as part of an unrelated
   edit. If an operation deletes a layer/asset that owns unknown data, disclose
   that deletion; use a conservative refusal when dependent unknown data could
   become invalid. Unsupported optional data is not a promise that every edit is safe.

Additional unknown fields are deliberately allowed by the structural schema for
future additive information. Meaning that changes rendering or editing must be
expressed by a **required extension** or a new project format version, not by an
unmarked unknown field. Unknown fields outside extensions must not introduce
undeclared asset dependencies: use an extension with `assetRefs` for those. This
prevents an old editor from assuming a new effect is harmless metadata.

## Validation, reachability and resource policy

Before allocating decoded image buffers:

1. Check format/version and the typed core fields; do not silently repair invalid
   core geometry, opacity, selection or references.
2. Check unique layer IDs and asset IDs, canonical Base64 and valid extension
   envelopes. Parse objects with a duplicate-key-detecting JSON parser: a plain
   `JSON.parse` has already discarded duplicate object keys and is insufficient
   to detect them after the fact.
3. Resolve every core reference and every declared extension `assetRefs` entry.
   All must exist. Inspect required capabilities before attempting rendering.
4. Compute reachable assets from all layer `content`/`original` references and
   project/layer extension dependencies. Follow asset-scope extension dependencies
   transitively, using a visited set so cycles terminate. Attached asset extension
   data participates when its owning asset is reached.
5. Reject undeclared/unreachable asset records rather than loading and silently
   dropping them. Dependency declarations for opaque extension data must be complete.
6. Apply the current editor's resource limits, then decode only the content needed
   by supported operations. An optional original can be retained without decoding.

The format schema defines structure, not permanent hardware limits. The current
editor's policy is 100 layers, 200 asset files, 300 MB decoded file bytes, 1 MB core
composition metadata, 420 MB HTML, 250 MB ZIP, and existing image/pixel budgets.
A future build can revise budgets without renumbering a structurally identical
schema. It must reject oversized input before expensive allocations. Layer extensions count toward the composition metadata budget. All extension
metadata counts toward the HTML budget; declared extension files count toward
asset budgets. Project/asset-scope metadata is bounded by the HTML budget, not
the 1 MB composition-only limit. Unknown data has no exemption from these caps.

## Documentation and compatibility fixtures

The JSON Schema files identify the JSON Schema dialect, not a runtime download.
Ship validation knowledge with an editor build; opening a project must not fetch
schemas from their `$schema` URI or resolve extension contracts over the network.
An extension can publish its own schema alongside its code/docs in its public
repository; a supporting editor vendors that contract at build time.

## Version changes

`version: 3` is a new envelope, not an extra version inside `composition`.
Do not carry the old nested `format`/`version` or `{path,name,type}` references
forward. Conversion from the current format is a separate, explicit operation;
the editor does not provide an old-format reader or automatic migration.

Within v3, additive optional information can be preserved. Breaking changes to
core meaning require a new project version. Extension meaning is versioned by
its namespace/version independently. Unknown optional extension versions are
preserved; unknown required ones block editing. Never guess how to migrate them.
