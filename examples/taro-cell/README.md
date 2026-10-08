# taro-cell

A phy-vscode plugin: a **Taro cell** status-bar item opens a panel with the taro-station page of each of the first two selected clusters, side by side (one cluster gives one pane),
`http://taro-station.usc.edu/dataview/cell/<dataset folder name>-C<cluster id, 4 digits>`.

The dataset folder (the one with `params.py`) must be named `<year>-<month>-<day>-R<run><shank>`, e.g. `2026-05-07-R001A`.

    node build.mjs        # from this folder; writes index.js

Then add `<repo>/examples` to `phyVscode.pluginPaths` (or copy this folder to `~/.phy-vscode/plugins/`) and run **Phy: Reload Plugins**.

## Synced scrolling

A framed page is another origin, so the panel cannot read or set its scroll position. Instead the pages cooperate: paste
[`taro-station-snippet.js`](taro-station-snippet.js) into the taro-station cell page (once). Framed here it then reports its
scroll position to the panel, as a fraction of the page, and follows the other pane; opened on its own it does nothing.
Without the snippet both panes still show, they just scroll independently.

To check it: select two clusters, scroll one pane, and the other follows to the same fraction of its page.

## Known limits

- The panel follows selection events, so after you switch to another dataset editor it stays on the previous dataset's page until you next select a cluster.
- After **Phy: Reload Plugins** with several datasets open, only the active one is watched until you toggle the panel.
- The page is `http` inside an `https` webview, so it may be blocked (mixed content) or refuse framing. If the iframe is blank, check **Developer: Open Webview Developer Tools**. If the page loads but looks inert, scripts were disabled (the panel now enables them for the framed page). If it is genuinely blocked, set `EMBED = false` in `src/index.ts` and rebuild.
