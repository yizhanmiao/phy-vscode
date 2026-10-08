# taro-cell

A phy-vscode plugin: a **Taro cell** status-bar item opens a panel with the taro-station page of each of the first two selected clusters, side by side (one cluster gives one pane),
`http://taro-station.usc.edu:8000/data-view/cell/<dataset folder name>-C<cluster id, 4 digits>`.

The dataset folder (the one with `params.py`) must be named `<year>-<month>-<day>-R<run><shank>`, e.g. `2026-05-07-R001A`.

    node build.mjs        # from this folder; writes index.js

Then add `<repo>/examples` to `phyVscode.pluginPaths` (or copy this folder to `~/.phy-vscode/plugins/`) and run **Phy: Reload Plugins**.

## Synced scrolling

A framed page is another origin, so the panel cannot read or set its scroll position. Instead the pages cooperate: paste
[`taro-station-snippet.js`](taro-station-snippet.js) into the taro-station cell page (once). Framed here it then reports its
scroll position to the panel, as a fraction of the page, and follows the other pane. Opened on its own, or framed by anything
other than a VS Code webview, it does nothing: it only listens to VS Code webview origins and reports only to the panel that
greeted it. Without the snippet both panes still show, they just scroll independently.

Changing one selected cluster reloads only that pane; the other keeps its page and scroll position.

To check it: select two clusters, scroll one pane, and the other follows to the same fraction of its page. Then select a
different first cluster: the second pane must not reload. (Not yet tried in real VS Code; the web editor's webview origin,
`*.vscode-cdn.net`, is allowed by the snippet but untested.)

## Known limits

- The panel follows selection events, so after you switch to another dataset editor it stays on the previous dataset's page until you next select a cluster.
- After **Phy: Reload Plugins** with several datasets open, only the active one is watched until you toggle the panel.
- The page is `http` inside an `https` webview, so it may be blocked (mixed content) or refuse framing. If the iframe is blank, check **Developer: Open Webview Developer Tools**. If the page loads but looks inert, scripts were disabled (the panel now enables them for the framed page). If it is genuinely blocked, set `EMBED = false` in `src/page.ts` and rebuild.
