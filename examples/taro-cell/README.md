# taro-cell

A phy-vscode plugin: a **Taro cell** status-bar item opens a panel with the taro-station page of the first selected cluster,
`http://taro-station.usc.edu/dataview/cell/<dataset folder name>-C<cluster id, 4 digits>`.

The dataset folder (the one with `params.py`) must be named `<year>-<month>-<day>-R<run><shank>`, e.g. `2026-05-07-R001A`.

    node build.mjs        # from this folder; writes index.js

Then add `<repo>/examples` to `phyVscode.pluginPaths` (or copy this folder to `~/.phy-vscode/plugins/`) and run **Phy: Reload Plugins**.
