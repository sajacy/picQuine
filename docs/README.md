# Project data, extensions and editor upgrades

**Status: implemented contracts.**

The editor saves v3 projects, builds base/HEIC profiles, loads passive update
bundles from an explicit user-entered HTTP(S) URL, and offers current/loaded code
in Save Project. The [format summary](../FORMAT.md) links the detailed contracts.
Old project formats are rejected; no automatic schema migration is implemented.

| Document | Contract |
| --- | --- |
| [PROJECT-V3.md](PROJECT-V3.md) | Canonical composition/asset model, extension scopes, preservation and validation |
| [HEIC-EXTENSION-V1.md](HEIC-EXTENSION-V1.md) | First example extension: optional HEIC decoder capability |
| [EDITOR-BUNDLES.md](EDITOR-BUNDLES.md) | Build profiles, passive update bundle, publishing and save-time code replacement |
| [schemas/](schemas/) | JSON Schema draft 2020-12 definitions of the implemented structures |
| [examples/README.md](examples/README.md) | Complete fixtures with real HEIC/PNG bytes and a fork-owned payload |

There are three independent version numbers: project format, editor bundle
format, and each extension's data contract. The editor's release version is a
fourth, descriptive identity. A new decoder build need not change project data.

The schemas validate JSON structure. The prose additionally defines reference
integrity, codec capabilities, resource limits and lossless preservation; passing
a JSON Schema validator alone does not make a project safe or editable.

## Checking the contracts

The build and ordinary `npm test` still need no third-party Python packages.
The separate `npm run test:contracts` command requires the optional developer
package `jsonschema` in the active Python environment. Install it in a virtual
environment, not in the editor or its distributions, then run:

```sh
npm run test:contracts
```

It validates all three JSON Schema 2020-12 definitions, complete project fixtures,
reference reachability, HEIC required/optional declarations, real Base64 payloads,
PNG/HEIC fixture pixel identity, negative cases, bundle envelope/hash rules,
documentation links and the release-artifact Git allowlist. It does not exercise
the browser-level upgrade flow; `npm run test:browser` verifies that separately.
