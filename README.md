# PicQuine Image Editor

- Offline, layered image editor distributed as one HTML file. Open it in Chrome.
- Supports JPG, PNG, BMP, SVG, WebP, AVIF and optional HEIC/HEIF.
- Crop, resize, rotate, paint, add text/shapes, and preview with bicubic or Lanczos resampling.

## Run

- Open [`dist/Base-Editor.html`](dist/Base-Editor.html) in Chrome.
- **Save Project** downloads a ZIP containing the editor and composition. Extract and open the HTML to resume.
- Original images, SVG markup and text metadata are preserved.
- **Edit** in layer properties updates text settings or raw SVG markup.
- Export PNG, JPEG or WebP with None, Bicubic (graphics) or Lanczos (photos) resampling.
- Dynamic upgrade functionality: **Load editor URL** accepts a direct, CORS-enabled bundle JSON URL. Try it with [dist/editor-with-heic.bundle.json](dist/editor-with-heic.bundle.json).

## Develop

- Requires Node.js 20+, npm and Python 3 (`python3`). No dependency installation for build or unit tests.

```sh
npm run build
npm test
npm run serve
```

- Open <http://127.0.0.1:5173/dist/Base-Editor.html>.
- Edit `src/`, then rebuild. `src/index.html` is a template, not the runnable app.
- Build one profile: `npm run build -- base-editor` or `npm run build -- editor-with-heic`.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for tests and release files.

## Reference

- [Architecture](ARCHITECTURE.md)
- [Project format, extensions and editor bundles](docs/README.md)
- [HEIC license](src/vendor/libheif.LICENSE) and [third-party notices](src/vendor/libheif.NOTICE)
