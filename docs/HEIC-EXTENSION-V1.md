# HEIC: the first example extension

**Status: implemented extension contract.** The base profile preserves optional
HEIC originals; the HEIC profile provides the decoder and handles required content.

| Property | Contract |
| --- | --- |
| Namespace | `org.picquine.heic` |
| Version | `1` |
| Scope | Asset |
| Input MIME types | `image/heic`, `image/heif` |
| Purpose | Decode the first image to the editor's ordinary 8-bit RGBA canvas pixels |
| Schema | [heic-v1.schema.json](schemas/heic-v1.schema.json) |
| Runtime delivery | Embedded decoder and WASM inside the editor bundle; lazy worker initialization |

Every HEIC/HEIF asset carries this asset-scope extension, including optional
original-only assets. A current-content HEIC reference without the required
extension declaration is invalid.

The asset continues to own its one `name`, `type` and `base64` payload. Its
`extensions.org.picquine.heic` occurrence has `data: {"imageIndex": 0}`. Version 1
supports only index 0, matching the current editor's first-image policy; the
first image must not be described as the primary image for every HEIF container.
It has `assetRefs: []`, because the decoder uses only its owning asset.

This contract does not promise HDR preservation in the editable canvas, auxiliary
images/depth, animation, or selection of additional images. Original file bytes,
including embedded metadata and additional images, remain intact in the asset.
A feature that exposes different image selection or HDR semantics needs an
appropriate extension contract, not an undocumented reinterpretation of v1.

## Required when it supplies visible/editable pixels

[project-v3-heic-required.json](examples/project-v3-heic-required.json) contains
a real 16×16 orange HEIC. The layer's `content` and `original` both reference that
asset, whose HEIC extension is `required: true`.

A base editor without this capability cannot faithfully render/edit the layer.
It must explain the missing extension and block editing/ordinary resaving. It
must not substitute a blank image, rewrite the MIME type, or discard the asset.
A user can explicitly choose a compatible HEIC-capable update bundle.

## Optional when retained only as provenance

[project-v3-heic-original.json](examples/project-v3-heic-original.json) contains
the same original HEIC plus a real PNG representing the current layer pixels.
The layer's `content` references PNG; `original` references HEIC. Here the HEIC
extension is `required: false`.

A base editor can edit/render the PNG while preserving the HEIC asset and unknown
extension data exactly. It cannot offer a HEIC-dependent operation such as
restoring/displaying that original until the capability is available.
If an operation later makes HEIC the current content, a supporting editor must
change the relevant requirement to true. If any layer still uses a shared HEIC
asset as current content, that asset's requirement must remain true.

In v1, the requirement is determined by **all** references, not just visibility:
a hidden HEIC-content layer remains editable project content and still requires
the capability. An enabled decoder can be used for optional original operations
when present; optional does not mean prohibited.

## Code upgrades do not become image conversions

The HEIC-capable editor bundle declares support for `org.picquine.heic` version 1.
It includes its decoder, worker, WASM, attribution and licenses inside its runtime
HTML. It does not fetch a WASM sidecar or a library from a CDN when opening files.
Changing the library release does not change the extension's version unless the
data/behavior contract changes.

Upgrading a JPEG/SVG-only project from the base editor to the HEIC-capable editor
adds a code capability. It does **not** create HEIC extension data in that project,
convert existing images, or add decoder binaries to `assets`. HEIC extension data
is created only when there is HEIC material to describe. The current chosen
implementation is libheif-js WASM, but its library name/version is editor build
metadata and must not be duplicated into each project asset.
