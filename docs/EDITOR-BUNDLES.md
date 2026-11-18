# Editor bundles, profiles and GitHub updates

**Status: implemented.** The Python builder emits both profiles by default.
The editor accepts a user-entered HTTP(S) bundle URL and stages its code for a
subsequent Save Project. It does not hot-swap the currently running editor.

## Two independent artifacts

1. An **editor HTML** is directly usable offline. It owns the UI markup, CSS,
   JavaScript, embedded workers/WASM and an empty project slot. Saved projects
   fill that slot with project data and still contain only one HTML file.
2. An **editor bundle JSON** is a passive update package for an existing editor.
   It contains identity/compatibility information and a compressed copy of the
   blank editor HTML. It is fetched as data, never imported/evaluated as code
   during update checking. It is not a separate runtime dependency.

Use `.json`, not `.js`, for the update envelope. The old `runtime-bundle.js` was
a development-only compressed template copy; it has been removed and is not the
update protocol. Publishing an update bundle does not put another copy of the
whole editor inside the distributed HTML. A pending fetched bundle is held in
memory only until Save Project uses its template.

## Profile builds

```sh
npm run build -- base-editor
npm run build -- editor-with-heic
```

`npm` forwards arguments after `--` to the Python builder. With no argument,
`npm run build` emits both profiles and their update packages.

| Profile | HTML download | Update package | Declared extension support |
| --- | --- | --- | --- |
| `base-editor` | `dist/Base-Editor.html` | `dist/base-editor.bundle.json` | None initially |
| `editor-with-heic` | `dist/Editor-With-HEIC.html` | `dist/editor-with-heic.bundle.json` | `org.picquine.heic`: version 1 |

The base profile retains the existing core JPEG, PNG, BMP, SVG, WebP and AVIF
capabilities. The HEIC profile adds HEIC/HEIF through the same extension contract;
it does not introduce an independent project schema. Import menus reflect the
capabilities of the current profile. A fork has its own editor identity/profile
and declares the extension contracts it implements.

For example, a base-editor project with SVG layers can fetch the HEIC profile's
bundle once and open it in a new Blob URL window with the current project. Its SVG
assets remain byte-identical. The HEIC-capable window permits subsequent HEIC
import, and saving there includes the new editor code. The already-open base-editor window does not hot-swap itself.

## Passive bundle envelope

The structural schema is
[editor-bundle-v1.schema.json](schemas/editor-bundle-v1.schema.json).

| Field | Definition |
| --- | --- |
| `format` | Exactly `"picquine-editor-bundle"` |
| `version` | Bundle-envelope version, initially `1` |
| `editor.id` | Stable reverse-DNS editor identity; forks use their own |
| `editor.profile` | Build profile name, such as `base-editor` or `editor-with-heic` |
| `editor.version` | Human-readable editor release version |
| `editor.build` | Immutable source/build identity, such as a commit or reproducible build digest |
| `compatibility.projectVersions` | Explicit supported project format versions; v3 builds declare `3` |
| `compatibility.extensions` | Namespace → exact supported integer extension-version arrays |
| `payload.encoding` | Exactly `"gzip+base64"` |
| `payload.base64` | Base64 of gzip-compressed complete, blank UTF-8 editor HTML |
| `payload.sha256` | Lowercase SHA-256 of the **decompressed blank HTML bytes** |

The decoded template includes exactly one non-executable project slot:

```html
<script type="application/json" id="picquine-project">null</script>
```

It also includes a non-executable `picquine-editor-info` JSON element containing the
same `editor` and `compatibility` objects as the bundle. Validate that these
agree. A standalone build carries this information so that it knows its own
capabilities even when no update package is present.

The template includes **all** required UI, styles, code, codecs, attribution and
licenses. No external scripts, stylesheets, fonts or WASM sidecars are required.
Replacing only JavaScript is insufficient because a new release may need new
DOM structure. The stable exchange boundary is the project slot and bundle
contract, not today's HTML layout or implementation globals.

The digest detects payload corruption. It is not publisher authentication when
supplied alongside the payload by the same server. Do not describe a hash alone
as a signed release. It checks the downloaded blank template, not a subsequently
saved project HTML with different embedded data or DOM serialization.

## One-request update flow

1. The user selects **Load editor URL**, enters an explicit HTTP(S) bundle URL,
   and selects Load. There is no repository picker, hostname allowlist, release
   lookup, URL discovery or automatic update check. The URL may point to a fork,
   a public GitHub-hosted file or another CORS-enabled server. The user chooses
   which executable code to trust. Project data cannot initiate a fetch.
2. Issue one anonymous GET for the bundle JSON at the URL entered by the user.
   Do not first request a release manifest and then a second payload. Do not send
   project metadata, asset bytes, credentials or local file paths to the server.
3. Parse JSON as data. Check supported envelope version, sizes, identity/profile,
   project-version compatibility and every **required** extension at all scopes.
   Unknown optional extensions remain permissible only under the preservation
   rules in [PROJECT-V3.md](PROJECT-V3.md).
4. Decode gzip with bounded output, verify SHA-256 and inspect the blank template's
   project slot and editor-info block. These checks do not execute the new code.
   A compatible bundle is staged; a mismatch leaves the existing editor/data
   intact and explains the incompatibility.
5. Loading succeeds without replacing live code. A dismissible prompt offers
   **Open in New Window**. This embeds the current project into the loaded template
   and opens a Blob URL in a fresh window; Cancel/Escape opens nothing. The old
   editor stays open. The Blob URL is revoked after loading or cancellation. The normal Save Project dialog has an Editor dropdown: Current editor
   (profile/version), or the loaded bundle identified by its entered URL. Loaded
   code is the default when present, but the user can choose Current editor. A
   read-only project cannot select an incompatible current editor.
   Save Project serializes the current project, preserving unknown fields and
   exact asset bytes. Use the selected loaded template or the current editor's own blank source. Escape `<` in serialized JSON to prevent
   project text from terminating the script element. Write a ZIP with one HTML.
6. Opening the Blob URL or saved HTML starts the new code in a fresh document.
   Saving from that document captures the new editor source. The old window
   remains on its original code.

A base editor may open a structurally valid project with a required HEIC extension
in preservation-only/read-only mode. It can still stage a compatible HEIC bundle
and perform an **upgrade-only save** by copying the unchanged project tree; it
must not require the old editor to decode HEIC first. The newly opened editor
then validates the extension-specific data. The manifest's capability declaration
is a compatibility claim, not proof that every opaque extension payload is valid.
Ordinary editing/resaving stays blocked until a supporting editor is running.

If the request fails or the user cancels before staging, ordinary offline saving
continues with the current editor. A failed ZIP write must not mark the document
saved or discard the staged bundle. A successful save does not convert the live
window into the new editor. Closing before saving loses a memory-only pending
upgrade, not project data.

No migration code is executed from a fetched bundle during validation. A target
that cannot interpret the current project version must be rejected, even if it
is a newer release. Format conversion requires a separately specified, explicit
path. Do not invent migrations for unfamiliar fork-owned data.

## Hosting and distribution

Commit selected blank release HTML and bundle JSON files under `dist/` when
publishing built files through the public repository. Sample/user project HTML,
ZIP exports and test evidence should stay ignored. Merely changing `.gitignore`
does not commit or publish anything; release artifacts must be built, tested,
reviewed and committed with the release's source.

The one GET can target a directly readable, CORS-enabled public bundle file on
GitHub-hosted infrastructure. The ordinary github.com file-view page is not the
bundle payload. Avoid an API call that only returns a second download URL. Verify
actual access from `file://` Chrome, including response content, CORS and the
chosen URL's redirects. A strict one-network-request deployment must use a direct
URL and avoid preflight-triggering headers, redirects and subsequent sidecar
fetches. A single application-level fetch is not automatically one HTTP request.

A stable per-profile URL is convenient for the latest tested release; the bundle
must still identify the exact build it contains. The implementation sends no credentials and rejects redirects, so use the direct
CORS-enabled file URL. Bundle JSON and expanded template are each limited to
20 MB; all project/asset budgets still apply. No GitHub credentials are needed
for public releases. Existing downloaded editors continue to work offline
if the repository is renamed, unavailable or deleted; only updating is affected.

Do not commit private project examples or user assets as part of a release. The
blank editor's project slot must remain null. The build does not commit or publish files; upload/commit release artifacts to
the chosen repository yourself. No repository or release URL is hard-coded.

## Required implementation checks

- Base and HEIC builds embed correct identities/capabilities and work from disk.
- The base build excludes the HEIC binary and rejects a required HEIC project
  without silently changing it; it preserves optional HEIC provenance assets.
- A staged HEIC update adds no network request on reopening/importing HEIC.
- Save/extract/reopen retains all asset bytes, core metadata and unknown optional
  fork data; the new editor reports the selected build/profile.
- Missing required capabilities, bad digest, invalid gzip, oversized output,
  duplicate JSON keys, duplicate project slots and template/manifest mismatches
  leave the current editor and project intact.
- Cancelled/failed requests and failed saves do not silently change the chosen
  runtime or saved/dirty state. Code updates are not hidden data migrations.
