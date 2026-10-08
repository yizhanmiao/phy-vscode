# phy-vscode user guide

How to browse a spike-sorting dataset with phy-vscode. To extend it with your own columns, histograms or views, see [Writing mods](mods.md).

> **Proof of concept, read-only.** You can look at clusters and select them. Nothing is merged, split, relabelled or saved, and nothing is written to your dataset folder. Check anything important against phy.

## 1. Install

Download `phy-vscode-<version>.vsix` from the [latest release](https://github.com/yizhanmiao/phy-vscode/releases/latest) and install it: Extensions view → `⋯` → **Install from VSIX…**, or `code --install-extension phy-vscode-<version>.vsix`. Other ways (build from source, run from source) are in the [README](https://github.com/yizhanmiao/phy-vscode#install).

Over **Remote-SSH**, connect to the remote machine first and install the `.vsix` from the Extensions view; the extension then runs where your data is.

## 2. Open a dataset

A dataset is the folder that contains `params.py`: a [phy](https://phy.readthedocs.io/en/latest/dataset/) or Kilosort output folder, for example `2026-05-07-R001A/`.

- **Command Palette** (Cmd/Ctrl+Shift+P) → **Phy: Open Dataset…** → pick the folder.
- **Explorer:** right-click `params.py` → **Open With…** → **Phy Dataset**. Normal editing of `params.py` is unaffected.

The dataset opens as an editor tab with the plot views. Click the **Phy** icon in the activity bar to see the **Clusters** table for the active dataset.

**Files.** `params.py`, `spike_times.npy`, `spike_clusters.npy` (or `spike_templates.npy`), `channel_map.npy` and `channel_positions.npy` are required; a dataset missing one shows an error page naming the file. Everything else is optional, and a view that needs a missing file says so in its header instead of failing:

| View | Needs |
|---|---|
| Waveform | `templates.npy` and `spike_templates.npy`; the raw `.bin` (found through `dat_path` in `params.py`) for real waveforms, otherwise it draws templates |
| Feature | `pc_features.npy` and `pc_feature_ind.npy` |
| Amplitude | `amplitudes.npy` |
| Correlogram, Cluster statistics | only the required files |

If the raw file is missing, or its size does not match `n_channels_dat`/`dtype`/`offset`, the dataset still opens: the Waveform header says why and shows templates. Large Fortran-ordered `.npy` files (typical of MATLAB Kilosort) are converted once into a cache in VS Code's extension storage; the dataset folder is never written to.

## 3. The Clusters table

One row per cluster. The columns are `id`, `n_spikes`, `group`, `depth`, `amplitude`, `firing_rate`, then one column for every `cluster_*.tsv` file in the folder (`cluster_KSLabel.tsv` gives a `KSLabel` column), then any columns added by [mods](mods.md). The line above the table summarises the dataset: spikes, clusters, channels, duration and whether the raw data was found.

**Selecting.** Selected clusters get a colour (shown as a coloured edge on the row), and every plot view uses the same colours.

| Action | Result |
|---|---|
| Click | select one cluster |
| Ctrl/Cmd-click | add or remove a cluster |
| Shift-click | select a range |
| ↑ / ↓ | move through the table; Shift+↑/↓ extends |
| **Alt+↓ / Alt+↑** | select the next or previous cluster in the table's current order, from anywhere in the dataset editor |

**Sorting.** Click a column header; click again to reverse. The arrow shows the direction. Empty cells sort last.

**Filtering.** Type in the box above the table. A filter is one or more terms `<column> <op> <value>`, joined with `and` / `or` (`and` binds tighter), with the operators `==  !=  <  <=  >  >=`:

```
n_spikes > 100 and group == good
KSLabel == good or amplitude >= 60
group != noise and depth < 1500 and firing_rate > 0.5
```

- Column names are the headers, exactly as written.
- Numbers compare as numbers; anything else compares as text. Put a value in quotes if it contains spaces: `group == "not sure"`.
- An empty cell only matches `!=`.
- A filter is never evaluated as code. A typo marks the box as an error, its tooltip says why, and the table stays unfiltered.
- Alt+↑/↓ follow the filtered, sorted order you see.

Unselected rows are tinted by `group` (for example good, mua, noise). Hover a column header for a tooltip; columns from mods use it to describe themselves.

## 4. The plot views

The dataset editor tiles five views. They show the **selected** clusters, one colour per cluster, and recompute when the selection changes. A hidden view does not compute until you show it.

| View | What it shows | Controls |
|---|---|---|
| **Waveform** | Up to 100 sampled spikes per cluster at their probe positions, with a bold mean. From the raw data, or from templates when the raw file is unavailable (the header says so). | **mean only** hides individual spikes; **template** overlays the template |
| **Feature** | PC features of the first selected cluster's best channels, as a grid of scatter plots; other spikes in grey. | Click a plot to change its y feature to the next PC; Shift-click to change its channel |
| **Correlogram** | Auto-correlograms on the diagonal and cross-correlograms off it, over all spikes of the selected clusters. | **bin ms** and **window ms** (default 1 and 50) |
| **Amplitude** | Amplitude against time, with a histogram of amplitudes beside it. | none |
| **Cluster statistics** | One panel per statistic, one curve per cluster: the ISI histogram and firing rate over time. | none |

With nothing selected the views show "Select a cluster".

**Zoom and pan** work the same in every plot: mouse wheel zooms, Shift+wheel zooms the x axis only, drag pans, double-click resets.

## 5. Layout

- **Rearrange.** Drag a tab to dock it somewhere else, drag the splitters to resize.
- **Hide or show a view.** **Phy: Toggle View…** lists every view; pick one to close or reopen it.
- **Remembered per dataset.** Layout, table sort and filter, correlogram bin/window, waveform checkboxes and feature grid come back when you reopen the same dataset.

## 6. Commands, keys and settings

| Command | What it does |
|---|---|
| **Phy: Open Dataset…** | open a dataset folder |
| **Phy: Select Next Cluster** / **Previous Cluster** | Alt+↓ / Alt+↑ (rebindable in Keyboard Shortcuts) |
| **Phy: Toggle View…** | show or hide a plot view |
| **Phy: Reload Plugins** | re-read your [plugins](mods.md) without restarting VS Code |
| **Phy: New Plugin…** | create a plugin from a working template |

The dataset commands appear in the Palette while a dataset editor is active. The plugin commands always do.

| Setting | Meaning |
|---|---|
| `phyVscode.pluginPaths` | extra folders (or `.js` files) to load plugins from, besides `~/.phy-vscode/plugins`. Absolute paths or `~/…`. User-level only: a workspace cannot set it, because plugins run with full access to your machine. |

## 7. When something looks wrong

| You see | Why | What to do |
|---|---|---|
| A view header says `needs <file>` | an optional file is missing (see the table in section 2) | nothing is broken; the other views still work |
| Waveform header says `raw data not found … showing templates` | `dat_path` in `params.py` is empty, missing, or the file size does not match | fix `dat_path` (relative paths resolve against the `params.py` folder) or use a `.bin` of the right size |
| Error page when opening | a required file is missing, or two files disagree (the message names both) | fix the dataset |
| A view header is red: `render error …` | a bug in a view | the other views are unaffected; please report it |
| A warning popup about plugins | a plugin failed to load | **View → Output → phy-vscode** has the details |
| A column from a plugin is empty for some clusters | the plugin's code threw or returned something unusable for those clusters | the same output channel says which plugin |
| Plot area is blank after GPU trouble | the WebGL context was lost | the view recovers by itself; if not, reopen the dataset |

For long-running or large datasets, the first open can take a while (a progress notification shows what it is doing); sampled plots use at most 100 waveforms, 10 000 feature points and 20 000 amplitude points per cluster so selecting stays quick.
