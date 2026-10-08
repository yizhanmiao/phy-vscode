---
layout: home
hero:
  name: phy-vscode
  text: Spike-sorting datasets in VS Code
  tagline: Browse phy / Kilosort output with the Clusters table and five plot views, and extend it with small plugins.
  actions:
    - theme: brand
      text: User guide
      link: /user-guide
    - theme: alt
      text: Write a plugin
      link: /mods
    - theme: alt
      text: API reference
      link: /api/
features:
  - title: Clusters table
    details: Sortable, filterable (`n_spikes > 100 and group == good`), with multi-select. Selected clusters get colours that every plot reuses.
  - title: Five plot views
    details: Waveform, Feature, Correlogram, Amplitude and Cluster statistics, drawn with WebGL, tiled and remembered per dataset.
  - title: Plugins
    details: Add a table column, a statistics panel or a whole view with a single pasted JavaScript file. Reload without restarting VS Code.
---

![phy-vscode showing the Clusters table and the five plot views on a Kilosort 4 dataset](./screenshots/phy-vscode-ui.png)

::: warning Proof of concept
phy-vscode is read-only: you can browse and select clusters, but nothing is merged, split, relabelled or written back. Phy's Similarity, Trace, Probe and Raster views are missing. Expect bugs and API changes, and check results against phy before you rely on them.
:::

## Get started

1. Download `phy-vscode-<version>.vsix` from the [latest release](https://github.com/yizhanmiao/phy-vscode/releases/latest) and install it (Extensions view → `⋯` → **Install from VSIX…**).
2. Run **Phy: Open Dataset…** from the Command Palette and pick the folder that contains `params.py`.
3. Click clusters in the **Phy** panel in the activity bar. **Alt+↓ / Alt+↑** steps through them.

The [user guide](/user-guide) covers every view and control. To add your own column or view, start with the three pasteable plugins in [Writing mods](/mods).
