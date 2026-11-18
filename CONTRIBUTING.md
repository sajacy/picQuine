# Contributing

## Setup

- Install Node.js 20+, npm, Python 3 and Chrome.
- No `npm install` needed for normal development.

```sh
npm run build
npm test
npm run serve
```

- Open <http://127.0.0.1:5173/dist/Editor-With-HEIC.html>.
- Edit `src/` and rebuild; refresh the browser after changes.

## Layout

- `src/`: editor, styles, workers and vendored decoder.
- `scripts/`: build, test and benchmark tools.
- `tests/`: suites and fixtures; generated evidence goes in `tests/artifacts/`.
- `docs/`: format contracts, schemas and examples.
- `dist/`: distributable HTML and bundle JSON.

## Checks

- `npm test`: builds, checks runtime syntax and runs all Node suites.
- `npm run benchmark`: resampling benchmark.
- `npm run example`: builds and generates a sample project ZIP.
- Browser tests currently require macOS (`ditto`), Chrome and a running `npm run serve`:

```sh
npm install --no-save --package-lock=false playwright-core
npm run test:browser
```

- Set `CHROME_PATH` if Chrome is outside its standard macOS location.
- Browser tests cover ZIP round trips, Blob-window upgrades and original asset preservation; they use downloads, not the native Save As dialog.
- Schema checks need the optional Python `jsonschema` package:

```sh
python3 -m venv /tmp/picquine-contracts
/tmp/picquine-contracts/bin/pip install jsonschema
PATH="/tmp/picquine-contracts/bin:$PATH" npm run test:contracts
```

## Changes and releases

- Follow [Google JavaScript style](https://google.github.io/styleguide/jsguide.html): two-space blocks, four-space continuations, 80 columns, single quotes and braces.
- `.clang-format` provides the formatting baseline. Leave `src/vendor/` untouched.
- Keep modules readable and use existing `picQuine…` namespaces and shared helpers.
- Preserve offline operation, original file bytes and unknown optional project data.
- Update the [format contracts](docs/README.md) and relevant tests when changing persisted data.
- Run `npm run build` for both profiles, or append `-- base-editor` / `-- editor-with-heic` for one.
- Include rebuilt release HTML and `.bundle.json` files in `dist/`; ZIPs and sample outputs stay ignored.
- Publish bundle JSON at a direct, CORS-enabled URL. Builds do not upload anything.
- Describe behavior changes and checks in the PR.
