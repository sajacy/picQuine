# PicQuine project format

The implemented format is **version 3**: one ZIP entry containing one complete,
offline HTML editor and a non-executable `picquine-project` JSON element. Its project
data is `{ format: "picquine-project", version: 3, composition, assets, extensions? }`.
Composition references contain stable asset IDs; filenames, MIME types and exact
Base64 bytes appear only in the canonical asset table. Versions 2, old multi-file
ZIPs, `.html.gz` and `.still` are not supported or automatically migrated.

The authoritative contracts are:

- [Project v3](docs/PROJECT-V3.md): core fields, stable IDs, extension scopes,
  reference integrity, unknown-data preservation and resource policy.
- [HEIC extension v1](docs/HEIC-EXTENSION-V1.md): required content versus optional
  original provenance, with actual HEIC/PNG examples.
- [Editor bundles and profiles](docs/EDITOR-BUNDLES.md): code identity, integrity,
  user-entered URL loading and save-time replacement of the complete editor.
- [JSON Schemas](docs/schemas/) and [complete examples](docs/examples/README.md).

`content` and `original` may share one asset. Pixel edits allocate a new PNG asset
and retain the exact original; SVG remains markup and HEIC remains HEIC. The
editor's sanitized/raster display cache is not substituted for original bytes.
Unknown optional fork fields and declared assets survive saves. Unknown required
extensions make the project read-only; an upgrade-only save is allowed with a
loaded bundle that declares the missing capabilities.

Assets are data, not executable plugins. Core support includes JPEG, PNG, BMP,
SVG, WebP and AVIF. The HEIC profile adds HEIC/HEIF with a lazy, embedded WASM
worker. Extension-owned files can have other MIME types without adding an image
import format. No external assets, fonts, workers or WASM files are required.

The current policy remains 100 layers, 200 assets, 300 MB decoded file bytes,
1 MB composition metadata, 420 MB HTML, 250 MB ZIP and the existing image/pixel
limits. Undo history, active tool, zoom, interface theme and proofs are not saved.
Project files are unencrypted; preserving originals also preserves their metadata.

The picquine identifiers replace the previous names; older project and bundle
identifiers are rejected rather than migrated.
