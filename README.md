# Theia-Phy

A VS Code extension for browsing [phy](https://phy.readthedocs.io/)/Kilosort spike-sorting datasets, written in pure TypeScript with no Python at runtime.

**Status: Plan 2 of 3.**
- The extension opens a dataset folder and shows the Clusters sidebar view (a sortable, filterable table of the active dataset) and the five tiled plot views (Waveform, Feature, Correlogram, Amplitude, Cluster statistics). An error page still names a missing or bad file.
- Mods and plugins come in Plan 3.

Design: [docs/superpowers/specs/2026-10-03-phy-vscode-extension-design.md](docs/superpowers/specs/2026-10-03-phy-vscode-extension-design.md)

## Requirements

- VS Code 1.95 or newer (desktop, including Remote-SSH)
- Node.js 20 or newer and npm, to build from source

## Install

### Option A: package and install a `.vsix` (recommended)

```bash
git clone <this repo> theia-phy && cd theia-phy
npm install
npm run package          # writes packages/extension/theia-phy-0.0.1.vsix
```

Then install that file in VS Code by either:
- **Extensions view:** open `⋯` → **Install from VSIX…** and pick `packages/extension/theia-phy-0.0.1.vsix`.
- **Command line:** `code --install-extension packages/extension/theia-phy-0.0.1.vsix`

**Remote-SSH:** the extension runs on the machine that has the data. Connect to the remote first, then install the `.vsix` from the Extensions view; VS Code installs it on the remote side.

To update, pull, run `npm run package` again and reinstall the new `.vsix`.

### Option B: run from source (development)

```bash
npm install
```

Open the repo folder in VS Code and press **F5** ("Run Theia-Phy"). It builds first, then starts an Extension Development Host window with the extension loaded.

## Usage

- **Command Palette:** run **Phy: Open Dataset…** and pick the folder that contains `params.py` (the Kilosort/phy output folder).
- **Explorer:** right-click a `params.py` → **Open With…** → **Phy Dataset**. Ordinary Python editing of `params.py` is unaffected.

The **Phy** activity-bar icon opens the **Clusters** view, a sortable, filterable table of the active dataset.
- **Selecting:** click to select, Ctrl/Cmd-click to add, Shift-click for a range; ↑/↓ move through the table and Shift+↑/↓ extend.
- **Next/previous anywhere:** **Alt+↓ / Alt+↑** (`phy.selectNext` / `phy.selectPrevious`) select the next or previous cluster in the table's current order from anywhere in the dataset editor. You can rebind them in Keyboard Shortcuts.
- **Filter syntax:** for example `n_spikes > 100 and group == good`.

The dataset editor tiles the Waveform, Feature, Correlogram, Amplitude and Cluster statistics views.
- **Layout:** drag tabs to re-dock. **Phy: Toggle View…** hides or shows a view.
- **Interaction:** wheel zooms (Shift+wheel zooms x only), dragging pans, double-click resets.
- **Persistence:** layout, table sort and filter, and view settings are remembered per dataset.

Notes:
- **Raw data:** the raw `.bin` is found through `dat_path` in `params.py`; relative paths are resolved against the `params.py` folder. If the raw file is missing or its size doesn't match `n_channels_dat`/`dtype`/`offset`, the dataset still opens. The Waveform view's header shows the reason, and the view falls back to templates.
- **Fortran-ordered files:** large Fortran-ordered `.npy` files (e.g. `pc_features.npy` from MATLAB Kilosort) are converted once into a C-order cache in VS Code's extension storage. The dataset folder is never written to.

## Development

Run from the repo root:

| Command | What it does |
|---|---|
| `npm test` | Unit tests (vitest; generates a synthetic fixture first) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Bundles `dist/extension.cjs` and `dist/worker.cjs` with esbuild |
| `npm run test:smoke -w packages/extension` | Launches a real VS Code (downloaded into `.vscode-test/`) against the fixture |
| `npm run bench -w packages/extension` | Performance-gate benchmarks |
| `npm run check:real -w packages/extension -- <dataset dir> [--dat <raw.bin>]` | Opens a real dataset and times every view (`--dat` overrides `dat_path` without touching the dataset) |

### Python goldens (dev only, optional)

Tests compare against checked-in JSON goldens produced by phylib/scipy. You only need Python to regenerate them. The environment is managed by [uv](https://docs.astral.sh/uv/):

```bash
npm run fixtures -w packages/extension
uv run --project tools/goldens python tools/goldens/make_goldens.py
```
