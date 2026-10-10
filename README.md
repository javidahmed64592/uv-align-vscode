# uv-align for VS Code

Underlines dependencies in `pyproject.toml` whose version constraint has drifted from what `uv.lock` resolved using the [`uv-align`](https://pypi.org/project/uv-align/) CLI.
Hover the yellow squiggle to see the mismatch:

> Bump bandit>=1.9.3 to >=1.9.4.

## How it decides what to check

A folder is treated as a `uv`-managed project only if it contains **both** `pyproject.toml` and `uv.lock`.
Nested projects and multi-root workspaces work, and `.venv`, `node_modules`, `.git` and similar folders are skipped.

The check re-runs (debounced) whenever either file is created, changed or deleted, for example after `uv lock`, `uv add`, or saving `pyproject.toml`.
Squiggles clear as soon as the folder is back in sync.

## Requirements

Nothing to install: the extension ships with a matching `uv-align` binary for your platform.

To use a different build, set `uvAlign.executablePath` (user settings only).
If the extension was installed without a bundled binary (e.g. a universal VSIX), it falls back to `uv-align` on your `PATH`:

```sh
uv tool install uv-align
```

## Commands

- **uv-align: Re-check workspace**: rescans and re-runs every check.
- **uv-align: Show output**: log of what was checked and any errors.

## Develop

```sh
npm install
```

Open this folder in VS Code and press **F5**.
A second window opens on `sample-workspace/`, which has one folder for each behaviour:

## Test

```sh
npm test
```

Parser and locator tests run on real captured `uv-align` output (`test-fixtures/`).
Tests that need the actual CLI use `uv-align` from your `PATH` (or `UV_ALIGN_BIN`) and are skipped if it is missing.
The controller tests run against a small in-memory mock of the VS Code API rather than a real VS Code window.

## QA

```sh
npm run type-check
npm run lint:fix
npm run format:fix
```

The codebase uses TypeScript, ESLint, and Prettier for type checking, linting, and code formatting, respectively.

## Package

Bundle the CLI for one platform, then build a platform-specific VSIX:

```sh
npm run fetch-binary -- linux-x64
npm run package:target -- linux-x64
code --install-extension uv-align-vscode-linux-x64-0.0.1.vsix
```

The bundled CLI version is `uvAlignVersion` in `package.json` (pass a version as a second argument to override).
Targets: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`.
`npm run package` without a binary builds a universal VSIX that relies on `PATH`.

## Release

Pushing a `v*` tag (or running the **Publish** workflow manually) builds one VSIX per platform, each with the `uv-align` version from `uvAlignVersion` bundled, then publishes them all to the Marketplace.
It needs a `VSCE_PAT` repository secret (a Marketplace personal access token).
