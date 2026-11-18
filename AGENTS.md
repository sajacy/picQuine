# Agent maintenance guide

Keep README.md and CONTRIBUTING.md short, bulleted and useful to an experienced
software engineer. Put agent-specific constraints here. Keep persisted-format
contracts in docs/; link to them rather than repeating them in onboarding docs.

## Workflow

- Edit src/, not generated dist/ files. src/index.html is a build template.
- npm run build uses Python standard-library scripts and builds both profiles.
- npm test rebuilds, checks runtime syntax and runs the Node suites.
- For UI, persistence or runtime changes, run the relevant real Chrome flows;
  see CONTRIBUTING.md for optional dependencies and current macOS restriction.
- Browser tests disable the native save picker. Do not claim OS picker coverage.
- Rebuild release HTML and bundle JSON after runtime changes. Respect the
  .gitignore release allowlist; do not add generated project ZIPs or test evidence.
- Do not publish or commit without a user request.

## Naming

- The app is picQuine. Use picQuine… for JavaScript namespaces and lowercase
  picquine for format IDs, HTML data slots, storage keys and org.picquine.*
  extension/editor IDs. Keep source assets and vendored code unchanged.

## Runtime constraints

- The distributable must work as one offline HTML opened directly in Chrome.
  Keep classic inline scripts and local Blob workers; no CDN or asset requests.
- HEIC uses embedded compressed libheif-js WASM, decoded lazily in a worker.
  Preserve vendored license and notice text in distributions and saved projects.
- The only deliberate external request is a user-entered editor bundle URL.
  Keep fetching credential-free, redirect-rejecting and bounded; verify bundle
  SHA-256, identity and required capabilities before staging it.
- Never execute imported project HTML or staged bundle code in the live editor.
  The optional Open in New Window action materializes the project into loaded
  HTML and opens a Blob URL. Keep the old window; revoke the URL after load or
  cancellation. Saving in the new window must capture the new code.
- Blob documents opened from file:// may lack crypto.randomUUID and
  crypto.subtle. Preserve the getRandomValues ID and SHA-256 fallbacks.
- Capture pristine editor HTML before UI initialization. Clear its data slot;
  replace exactly one escaped JSON payload on save. Do not nest old projects.
- Keep Save Project's current/loaded editor dropdown, with the loaded URL label.

## Editing and data invariants

- Route edits through history transactions. Continuous gestures begin, commit
  once, or cancel. Copy source canvases before painting; invalidate draft caches.
- Treat nested metadata, original Blobs and committed canvases as immutable.
  Snapshots share resources. Saved revisions, not a separate boolean, track dirtiness.
- Preserve operation ownership across async work. Select a native save destination
  before encoding to retain user activation; propagate write failures.
- Project v3 stores composition references as stable asset IDs and file metadata
  and Base64 bytes once in assets. Follow docs/PROJECT-V3.md and its schema.
- Preserve original SVG markup, HEIC bytes, text provenance, unknown optional
  fields and transitive extension asset dependencies. Pixel edits add PNG content
  while retaining the original. Do not re-encode unchanged assets unnecessarily.
- Missing required capabilities mean read-only preservation. Permit opening or
  saving unchanged data with a compatible editor; do not silently drop data.
- Support only single-HTML ZIP projects and extracted HTML. Do not restore legacy
  .still, multi-file ZIP, HTML.gz, launchers, signing or folder-access code.
- Do not add image formats without a user request. Limits live in src/config.js;
  assetFiles counts asset records, not ZIP entries. A ZIP has one HTML entry.
- Proofs use explicit premultiplied-alpha bicubic/Lanczos filtering. Preserve
  golden pixels, exact quarter-turn copies, cancellation and immutable sources.

## Code style

- Follow Google JavaScript formatting: two-space blocks, four-space continuation
  indentation, 80 columns, single quotes, braces and one variable per declaration.
  Use .clang-format as a baseline; do not format vendored code. Keep classic
  scripts for offline file loading. Add terse intent comments for ownership,
  non-obvious side effects and ambiguous positional arguments.

- Use existing singleton picQuine… modules and direct named dependencies. Avoid
  factories, dependency injection and callback plumbing without a concrete need.
- Use $ for document.querySelector and _ for ignored callback arguments.
- Prefer concise, distinguishable role names. Conventional coordinates and local
  math indices are fine; do not shorten unrelated names into near-identical ones.
- Keep generated application code readable; no application minification.
- Keep detailed protocol documentation precise. Avoid implementation histories,
  abandoned approaches and exhaustive test narration in human onboarding docs.
