# __NAME__

A phy-vscode plugin. It adds a cluster-table column, a Cluster statistics histogram and a plot view.

    npm install
    npm run build        # writes index.js (host) and renderer.js (webview)

Then run **Phy: Reload Plugins** in VS Code. Keep this folder under `~/.phy-vscode/plugins/`, or add its parent to the
`phyVscode.pluginPaths` setting. `npm run watch` rebuilds on save, and `npm run typecheck` checks the types.

`src/index.ts` runs in the extension host. `src/renderer.ts` runs in the plot webview. Details: docs/mods.md in the phy-vscode repo.
