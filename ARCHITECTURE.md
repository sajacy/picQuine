# Architecture

- `src/index.html` defines script order and dialog templates. The Python builder inlines scripts, CSS and optional HEIC WASM into one distributable HTML.
- Modules expose `picQuine…` namespaces through classic scripts. Most are singletons; history and operation controllers support separate instances.

| Area | Source modules |
| --- | --- |
| UI and tools | `app.js`, `dom.js`, `shapes.js`, `style.css` |
| Document edits | `document.js`, `history.js`, `operations.js`, `geometry.js` |
| Images and caches | `images.js`, `assets.js`, `heic-worker.js` |
| Rendering and proof | `renderer.js`, `resample.js`, `proof.js` |
| Persistence | `project.js`, `standalone.js`, `archive.js`, `json.js`, `files.js` |
| Editor upgrades | `runtime.js` |
| Limits and sample | `config.js`, `demo.js` |

## Data flow

- Import retains original file bytes and creates a canvas for display/editing. SVG display is sanitized; the original markup stays intact.
- Metadata edits share immutable sources. Painting copies the selected source; history retains shared resources within a memory budget.
- Save serializes composition references and canonical assets into embedded JSON, then compresses the complete editor into a single-entry ZIP.
- Runtime capture starts from a pristine HTML template, so repeated saves replace project data instead of nesting previous files.
- Editor upgrades stage a verified bundle. Opening it creates a new Blob document containing the current project; saves there use the new code.

## Reference

- [Development and checks](CONTRIBUTING.md)
- [Project and bundle contracts](docs/README.md)
- [Agent maintenance instructions](AGENTS.md)
