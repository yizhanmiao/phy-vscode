# Theia-Phy: VS Code extension for phy/Kilosort datasets — Design

Date: 2026-10-03
Status: approved in brainstorming, pending written-spec review

## 1. Goal and scope

A desktop VS Code extension that opens a phy-format spike-sorting dataset (Kilosort/phy output folder) and shows six phy views: **Cluster, Waveform, Feature, Correlogram, Amplitude, Cluster statistics**.

Constraints agreed:

| Topic | Decision |
|---|---|
| Host | Desktop VS Code only (Remote-SSH must work; extension runs where the data is). |
| Runtime | Pure TypeScript. No Python at runtime. |
| Scale | Neuropixels-scale (≈10M spikes, `pc_features` GBs, raw `.bin` tens of GB). Raw-data waveforms required. |
| Layout | Hybrid: Cluster view in a sidebar webview; plot views tiled in one editor tab. |
| Extensibility | One public TS API used by built-in views, other VS Code extensions, and a user plugin folder. |
| Future | Spike curation (merge/split/label, undo, save) — not built in v1, but the architecture must accommodate it. |
| Performance fallback | Approach A (TS compute in workers). If TS is measurably too slow, port hot `compute/` functions to Rust/WASM (approach C). |

Out of scope for v1: Similarity, Trace, Probe, Raster, Template views; any curation code; screenshot tests.

Data specs referenced: https://phy.readthedocs.io/en/latest/dataset/, https://kilosort.readthedocs.io/en/latest/export_files.html, views: https://phy.readthedocs.io/en/latest/visualization/.

## 2. Architecture

```
┌──────────── Extension host (Node) ─────────────┐
│  Dataset      → lazy readers for .npy/.tsv/.bin │
│  Session      → selection, cluster table state  │
│                 (later: curation history)       │
│  ViewRegistry → built-in + mod views            │
│  WorkerPool   → compute/* in worker_threads     │
└───────▲──────────────────────────▲──────────────┘
        │ postMessage (JSON + ArrayBuffers)
┌───────┴────────┐        ┌────────┴──────────────────┐
│ Sidebar webview│        │ Plot editor webview        │
│ Cluster view   │        │ tiled: Waveform, Feature,  │
└────────────────┘        │ Correlogram, Amplitude,    │
                          │ Cluster statistics         │
                          └────────────────────────────┘
```

- Opening: a `CustomReadonlyEditorProvider` registered for `params.py`, plus command `Phy: Open Dataset…` (folder picker).
- The extension host owns all state. Webviews are renderers that send user intents.
- All numeric work lives in `src/compute/` as pure functions over typed arrays, executed in a `worker_threads` pool. This module is the seam for a future WASM port: functions are replaced one at a time with identical signatures. No abstraction layer is added for this up front.

### Repository layout (npm workspaces)

```
packages/
  api/            @theia-phy/api — public types + tiny helpers for mod authors
  extension/
    src/host/       activation, dataset/, session.ts, view registry, plugin loader
    src/compute/    pure numeric functions (WASM seam)
    src/views/      built-in views, each <name>/provider.ts + <name>/renderer.ts
    src/webview/    webview shells (sidebar, plot editor), plot/ layer
    test/           vitest unit tests, benchmarks, fixtures, smoke test
```

Build: esbuild, two bundles (extension host, webviews). Tests: vitest; `@vscode/test-electron` for one smoke test.

## 3. Data layer (`src/host/dataset/`, read-only in v1)

### Readers

- **`params.py`**: restricted parser for literal assignments only (strings incl. `r''`, ints, floats, booleans, lists). Never executes Python. Unsupported syntax → error naming the line. Keys used: `dat_path`, `n_channels_dat`, `dtype`, `offset`, `sample_rate`, `hp_filtered` (if present).
- **`.npy`**: header versions 1–3; little-endian / native `i1 i2 i4 i8 u1 u2 u4 u8 f4 f8 b1`. Big-endian → explicit error.
  - Fortran order (written by MATLAB Kilosort 2/2.5 `writeNPY`): small arrays are loaded and transposed in memory. Large arrays (`pc_features`, `template_features`) are converted once into a C-order cache file under `context.globalStorageUri` (keyed by absolute path + size + mtime), with a progress notification.
- **`.tsv`/`.csv`**: every `cluster_<field>.tsv` (including `cluster_group.tsv`, `cluster_KSLabel.tsv`) becomes a cluster-table column. `cluster_info.tsv` is ignored (phy behaviour).
- **Raw data**: `dat_path` (string or list, concatenated in order), `dtype`, `n_channels_dat`, `offset`; time-major interleaved `(n_samples, n_channels_dat)`. Paths resolved relative to the `params.py` directory.

### Files

Required: `params.py`, `spike_times.npy`, (`spike_clusters.npy` or `spike_templates.npy`), `channel_map.npy`, `channel_positions.npy`.
- If `spike_clusters.npy` is missing, clusters = `spike_templates` (in memory; nothing written in v1).
- Kilosort4's `spike_templates.npy` may be `(n_spikes, 2)` per its docs; use column 0 when 2-D.

Optional: `templates.npy`, `template_ind.npy` (sparse; KS `templates_ind.npy` is ignored and templates treated as dense, per phy), `amplitudes.npy`, `similar_templates.npy`, `whitening_mat.npy`, `whitening_mat_inv.npy` (computed by matrix inversion of `whitening_mat` if missing; identity if both missing), `pc_features.npy` + `pc_feature_ind.npy` (+ `pc_feature_spike_ids.npy`), `template_features.npy` + `template_feature_ind.npy` (+ `template_feature_spike_ids.npy`), `channel_shanks.npy`, `channel_probe.npy`, `_phy_spikes_subset.{waveforms,channels,spikes}.npy`.

`pc_features` on disk is `(n_spikes_subset, n_pcs, n_channels_loc)`; when `*_spike_ids.npy` is present, features cover only those spikes.

### Memory strategy

| Data | Strategy |
|---|---|
| Per-spike 1-D arrays (`spike_times`, `spike_clusters`, `spike_templates`, `amplitudes`) | Fully loaded into `SharedArrayBuffer`s (≈200 MB at 10M spikes); workers read them zero-copy. |
| Small arrays (`templates`, `channel_*`, `*_ind`, `similar_templates`, whitening) | Fully loaded. |
| `pc_features`, `template_features` | Positioned `fs.read` of sampled rows only. |
| Raw `.bin` | One positioned read per spike window across all channels (~82 samples × n_channels_dat). |

Read requests are sorted by file offset and adjacent ranges coalesced. No native mmap module.

### Cluster → spike index

A counting-sort pass over `spike_clusters` builds `spikeOrder: Int32Array` plus per-cluster start offsets. Owned by the **Session** (not Dataset) so curation only rebuilds the index. Cluster IDs may be sparse and large.

### Spike subsampling

Per-view caps (defaults: Waveform 100, Feature 10 000, Amplitude 20 000). Deterministic regular stride within each cluster so views are stable when re-selecting.

### Waveforms (`compute/`, in workers)

1. **Best channels** per cluster: unwhiten its template(s) (`templates × whitening_mat_inv`, sparse or dense), rank channels by peak-to-peak amplitude, take the top channel and its nearest neighbours by `channel_positions` (default 12 channels total). Multi-template clusters use the spike-count-weighted mean template.
2. **Source**, first available:
   1. `_phy_spikes_subset.*` precomputed waveforms;
   2. raw `.bin`: read a padded window, 3rd-order Butterworth high-pass at 150 Hz applied forward-backward (skipped when `hp_filtered = True`), subtract per-channel median; default window 82 samples (−40/+42 around spike time);
   3. template fallback: template × amplitude, labelled "template" in the view.
   
   A missing raw file is **not** an error. When `dat_path` is empty, any listed file does not exist or cannot be opened, or the file size is inconsistent with `n_channels_dat`/`dtype`/`offset`, the dataset still opens, the Waveform view uses the template fallback, and its header shows a short notice with the reason (e.g. "raw data not found: `<path>` — showing templates").

### Errors

- Missing required file → editor shows an error page naming the file.
- Missing optional file → only dependent views show "needs `<file>`"; everything else works.
- Shape inconsistencies (e.g. `spike_times` length ≠ `spike_clusters` length) → error naming both files and shapes.

### Writes

None in v1.

## 4. Session, selection, protocol

### Session (`src/host/session.ts`, one per open dataset)

- Holds: Dataset, cluster→spike index, cluster table, ordered selection.
- Cluster table columns: `id`, `n_spikes`, `group`, `depth` (y of best channel), `amplitude` (mean of `amplitudes.npy`, or template peak-to-peak), `firing_rate` (n_spikes / recording duration), every `cluster_*.tsv` column, mod metrics.
- Events: `onDidChangeSelection`; `onDidChangeClusters` (declared, not fired until curation).
- Colours: assigned by selection order (phy palette); all views use the Session-provided colours.
- The sidebar shows the Session of the active dataset editor.

### Selection data flow

```
Cluster view click ──intent──▶ Session.select(ids)
                                 │ onDidChangeSelection
                                 ▼
       for each visible view: provider(ctx, token)  (workers)
                                 │
            ◀── {viewId, seq, meta(JSON), buffers(ArrayBuffer[])}
Plot webview: drop if stale seq → renderer.update(meta, buffers, selection)
```

- A new selection cancels in-flight requests (`CancellationToken`); results carry `seq` and stale ones are dropped.
- Only visible views compute; a hidden view computes when shown.

### Message protocol (types in `@theia-phy/api`)

- Webview → host: `ready`, `select {ids}`, `viewEvent {viewId, payload}`.
- Host → webview: `clusterTable {columns, rows}`, `selection {ids, colors}`, `viewData {viewId, seq, meta, buffers}`, `viewError {viewId, message}`.

### Commands and keys

Every action is a VS Code command (`phy.openDataset`, `phy.selectNext`, `phy.selectPrevious`, `phy.view.toggle`, `phy.reloadPlugins`, `phy.newPlugin`) with `when` context `phyDatasetActive`, so users and mods can rebind keys.

### Persistence

Plot layout, column order/sort, and per-view settings in `workspaceState`, keyed by absolute `params.py` path. Webviews use `setState` for instant restore.

## 5. Views

Each built-in view is a `{provider, renderer}` pair registered via the public API.

| View | Provider | Renderer |
|---|---|---|
| **Cluster** (sidebar) | Session cluster table. | Virtualized table (10k+ rows), sortable columns, Ctrl/Shift multi-select, ↑/↓ navigation, rows tinted by `group`. Filter box with a safe grammar: `<column> <op> <value>` joined by `and`/`or`, ops `== != < <= > >=`; no code evaluation. |
| **Waveform** | Per selected cluster: ≤100 sampled spike waveforms on best channels (§3) plus mean. | Laid out at `channel_positions`; thin translucent spikes, bold mean; toggles: mean-only, template overlay. |
| **Feature** | PC features of sampled spikes on the top channels of the first selected cluster; background = sampled spikes from all clusters with features on those channels (via `pc_feature_ind`). | phy default 4×4 grid of PC×PC scatters, with time on the first column; background grey; click to change axes (`viewEvent`). |
| **Correlogram** | Auto/cross-correlograms of selected clusters over **all** their spikes; defaults bin 1 ms, window 50 ms; sliding window over the merged sorted spike train. | n×n bar grid, refractory lines at ±2 ms, baseline firing-rate line; bin/window adjustable. |
| **Amplitude** | `amplitudes.npy` vs `spike_times`, ≤20 000 sampled spikes per cluster. | Scatter amplitude-vs-time plus a marginal amplitude histogram. Hidden with "needs `amplitudes.npy`" if absent. |
| **Cluster statistics** | Generic histogram providers; built-in **ISI** (0–50 ms) and **firing rate over time**. | Stacked histogram panels. Mods add panels with `api.registerHistogram`. |

### Shared plot layer (`src/webview/plot/`)

- WebGL2 batches: scatter (per-point colour/alpha), polylines (many lines per draw call), bars.
- Canvas2D overlay for axes, ticks, labels.
- Subplot grid helper.
- Interaction: drag pan, wheel zoom, double-click reset.
- Colours from VS Code theme CSS variables (light/dark).
- Exported to mods via `@theia-phy/api`.

### Tiling

`dockview-core` (framework-free, zero dependencies) for phy-style drag-to-dock tiles, tabs, and splitters. It is the only UI dependency; all other webview code is vanilla TypeScript.

### Performance gate for approach C

vitest benchmarks: correlograms for 10 clusters × 100k spikes; Butterworth filter over 100 raw windows. If computing a typical cluster click exceeds ~200 ms, port that function to WASM.

## 6. Extensibility

### Public API (`@theia-phy/api`, semver; `api.version` checked at mod load)

```ts
interface PhyApi {
  version: string;
  activeSession(): PhySession | undefined;
  onDidOpenSession: Event<PhySession>;
  registerView(def: ViewDefinition): Disposable;
  registerClusterMetric(def: { id: string; label: string;
    compute(clusterId: number, ctx: ComputeContext): number | string }): Disposable;
  registerHistogram(def: { id: string; label: string;
    compute(spikeIds: Int32Array, ctx: ComputeContext): Float64Array }): Disposable;
}

interface PhySession {
  dataset: DatasetReader;             // read-only typed-array accessors and lazy readers
  clusters: ClusterTable;
  selection: readonly number[];
  select(ids: number[]): void;
  spikesOf(clusterId: number): Int32Array;
  onDidChangeSelection: Event<readonly number[]>;
  onDidChangeClusters: Event<ClusterUpdate>;   // fired once curation exists
}

interface ViewDefinition {
  id: string;
  title: string;
  provider(ctx: ViewContext, token: CancellationToken):
    Promise<{ meta: unknown; buffers: ArrayBuffer[] }>;     // runs in host
  rendererScript: Uri;  // webview ES module exporting
                        // { mount(el, plot), update(meta, buffers, selection), dispose() }
}
```

### Delivery channels

1. **VS Code extensions**: declare `extensionDependencies` on this extension and use `vscode.extensions.getExtension(id).exports` (our `activate` returns `PhyApi`). Renderer scripts are served via `asWebviewUri`; the mod's extension folder is added to the plot webview's `localResourceRoots`. CSP allows scripts only from those roots plus a per-load nonce.
2. **Plugin folder**: CommonJS `.js` files in `~/.theia-phy/plugins/` and paths in the `theiaPhy.pluginPaths` setting, each exporting `{ activate(api: PhyApi) }`. Authors write TS against `@theia-phy/api` and compile; `Phy: New Plugin` scaffolds a plugin with an esbuild script. No runtime TS compiler is bundled. Plugins are never loaded from dataset folders. `Phy: Reload Plugins` reloads without restarting VS Code.

## 7. Curation readiness (design only; no code in v1)

- Session gains a `ClusterStore`: mutable copy of `spike_clusters` + append-only operation log (`merge`, `split`, `label`). Undo/redo by replaying the log (phy's approach). Each op fires `onDidChangeClusters` with `{added, deleted, descendants}`; views already recompute on it and the Session rebuilds the cluster→spike index.
- Editor switches from `CustomReadonlyEditorProvider` to `CustomEditorProvider` to get VS Code-native dirty state, undo/redo, Save, and save-on-close.
- Save writes phy-compatible `spike_clusters.npy`, `cluster_group.tsv`, `cluster_<field>.tsv`, after a one-time backup of originals.

## 8. Testing

- **Fixture**: tiny synthetic dataset generated by a checked-in TS script; variants for Fortran order, sparse `template_ind`, feature subsets (`*_spike_ids`), 2-D `spike_templates`, a small raw `.bin`, and no raw `.bin` (asserts the Waveform provider returns template waveforms with the fallback notice).
- **Unit (vitest)**: `.npy` parser, `params.py` parser, filter grammar, cluster index, subsampling, every `compute/` function against golden values. Goldens are produced once by a dev-only phylib script and checked in as JSON; Python is never needed to run tests.
- **Benchmarks**: §5 performance gate.
- **Smoke (`@vscode/test-electron`)**: open the fixture; assert the Session loads and every built-in provider returns data without error.
- **Rendering**: manual in v1.
