# Writing phy-vscode mods

> **Proof of concept.** The API (`@phy-vscode/api`, version in `packages/api/package.json`) follows semver but is `0.x`: the minor version may break it.

A mod can add three things:

| You register | You get |
|---|---|
| `registerClusterMetric({ id, label, compute(clusterId, ctx) })` | A column in the Clusters table, filterable (`spike_share > 0.1`) and sortable like the built-in columns. `label` is the column header's tooltip. |
| `registerHistogram({ id, label, unit?, range?, compute(spikeIds, ctx) })` | A panel in the Cluster statistics view, one curve per selected cluster. |
| `registerView({ id, title, provider, rendererScript })` | A new view in the dataset editor. |

All ids contain only letters, digits, `_`, `.` and `-`, start with a letter or `_`, and must be unique.

`ctx.session` is the open dataset: `session.dataset` (typed arrays, read-only), `session.spikesOf(clusterId)`, `session.selection`, `session.clusters`.

## Way 1: a plugin folder (no VS Code extension needed)

1. Run **Phy: New Plugin…**. It creates `~/.phy-vscode/plugins/<name>/` with a working sample (a metric, a histogram and a view) and opens `src/index.ts`.
2. In that folder run `npm install && npm run build`. The build writes `index.js` (runs in the extension host) and `renderer.js` (runs in the plot webview).
3. Run **Phy: Reload Plugins**. Edit, rebuild and reload as often as you like; VS Code does not restart.

How plugins are found:
- `~/.phy-vscode/plugins/` and the paths in the `phyVscode.pluginPaths` setting (absolute, or starting with `~/`; relative paths are ignored).
- Each `*.js` file, and each subfolder with an `index.js`, is one plugin. A path in the setting may also point straight at one plugin file.
- A plugin exports `activate(api)`, optionally `deactivate()` and `apiVersion` (a range such as `^0.2.0`; the plugin is refused if it does not match). `activate` may return a `Disposable`.
- Everything a plugin registers through `api` is removed when it is unloaded.
- A plugin that throws is skipped and reported in the **phy-vscode** output channel; the others still load.
- Plugins are plain CommonJS. No TypeScript is compiled at runtime, so build first. A plugin's `tsconfig.json` needs the `DOM` lib, because `ViewRenderer` mentions `HTMLElement` (the scaffold's already has it).
- A reload re-reads a plugin file. For a folder plugin it clears everything under that folder from Node's module cache; for a single-file plugin only the file itself. A plugin made of several files must therefore be a folder (`<dir>/index.js`).

**Security and limits:**
- A plugin runs in the extension host with full access to your machine. There is no sandbox. Only load code you trust.
- For that reason `phyVscode.pluginPaths` is a machine-scope setting, and plugins are never loaded from dataset folders or workspace settings.
- After a plugin is unloaded or fails to activate, its `api` object throws `plugin unloaded` if used again (for example from a leftover timer).
- Subscriptions are removed automatically only for sessions you get from `api.activeSession()` or `api.onDidOpenSession`. The `ctx.session` passed to a metric, histogram or view provider is the raw session: a listener you add on it you must dispose yourself.
- A plugin whose `activate()` never settles stalls plugin loading, and the plot pages wait for the first load before they start. There is no timeout yet.

## Way 2: from another VS Code extension

```jsonc
// your package.json
"extensionDependencies": ["phy-vscode.phy-vscode"]
```
```ts
const phy = await vscode.extensions.getExtension<PhyApi>('phy-vscode.phy-vscode')!.activate();
if (!satisfiesApi('^0.2.0', phy.version)) return; // from '@phy-vscode/api'
context.subscriptions.push(phy.registerClusterMetric({ … }));
```

## Views

A view has two halves:
- **`provider(ctx, token)`** runs in the extension host whenever the selection changes while the view is visible. It returns `{ meta, buffers }`: `meta` is JSON, `buffers` are `ArrayBuffer`s. Check `token.isCancellationRequested` in long loops; a newer selection cancels the run. `ctx.settings` holds the view's settings.
- **`rendererScript`** is the path (`{ fsPath }`, which a `vscode.Uri` satisfies) of an ES module that runs in the plot webview and exports `mount(el, plot, host)`, `update(meta, buffers, selection)` and `dispose()`, or a default function returning them. `update` turns the data into a `Scene` and calls `plot.setScene(scene)`. `plot` is the same WebGL2 layer the built-in views use, with pan, zoom and theme colours. `host.settings`/`host.setSettings` pass settings to the provider; `host.getState`/`host.setState` persist renderer-only state per dataset.

Rules for renderer scripts:
- Bundle everything into **one file**. Only its own folder is served to the webview, and only the extension's own bundle plus scripts from there may run.
- A module that fails to load, or lacks the three exports, shows its error in the view's header. Other views are unaffected.
- When the set of registered views changes (a plugin loads, reloads or is removed), the plot page reloads once. Layout, settings and selection are restored.
- A newly registered view opens as a new column at the edge of the grid, not as a tab, so it does not hide another view. A view you closed stays closed.

## Cluster metrics

`compute` runs synchronously in the extension host, once per cluster, when the table is first built after the metric is registered and for each dataset you open; a slow one blocks the host. Return a finite number or a string. A throw, or any other return value (`NaN`, `Infinity`, `undefined`, an object), leaves the cell empty; one warning per metric is shown, not one per cluster.

The id is the column name, so it cannot contain spaces. It cannot reuse a built-in column (`id`, `n_spikes`, `group`, `depth`, `amplitude`, `firing_rate`), which is refused at registration, nor a `cluster_*.tsv` column of the dataset; in that case the metric is skipped with one warning.

## Commands

`phy.reloadPlugins` and `phy.newPlugin` work without a dataset open, unlike the dataset commands, which require `phyDatasetActive`.
