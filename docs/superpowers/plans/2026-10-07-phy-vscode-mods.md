# phy-vscode Mods (Plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let other people extend phy-vscode. A public `PhyApi` registers views, cluster-table metrics and histograms. It reaches mods three ways: the `exports` of the extension, `.js` plugins in a plugin folder, and a `Phy: New Plugin` scaffold. `Phy: Reload Plugins` reloads plugins without restarting VS Code. The last task builds a real plugin on top of it: a panel that shows the selected cluster's taro-station page.

**Architecture:**
- **Host.** One `ModRegistry` (vscode-free, unit-tested) holds the built-in and mod views, cluster metrics and histograms. `PlotPanel`, the `Session` and the Cluster sidebar read it and react to its change events.
- **Mod views.** A mod view's provider runs in the extension host, as a built-in's does. Its renderer is an ES module that the plot webview loads with `import()`. The module's folder is added to the webview's `localResourceRoots` and the CSP allows scripts from them. A change to the view list reloads the plot page, and the persisted layout, settings and selection bring it back.
- **Plugins.** A `PluginHost` (vscode-free, unit-tested) discovers CommonJS plugins, hands each a scoped `PhyApi` that tracks its registrations, and undoes them on reload.

**Tech Stack:** TypeScript, VS Code extension host API, `import()` of ES modules in the webview, esbuild (also used by the plugin template), vitest, `@vscode/test-electron`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-phy-vscode-extension-design.md` (§6 Extensibility, §2 Repository layout, §4 Commands). Builds on Plans 1 and 2, both merged on `main`. The spec says "theia-phy"; the code was renamed to `phy-vscode` / `phyVscode` / `@phy-vscode/api` after it was written, and this plan uses the new names.

## Global Constraints

- "One public TS API used by built-in views, other VS Code extensions, and a user plugin folder."
- "`api.version` checked at mod load" and "`@theia-phy/api`, semver". Ruling: `API_VERSION` is a constant in `@phy-vscode/api` and must equal that package's `version`. This plan bumps it from `0.1.0` to `0.2.0`.
- "**VS Code extensions**: declare `extensionDependencies` on this extension and use `vscode.extensions.getExtension(id).exports` (our `activate` returns `PhyApi`). Renderer scripts are served via `asWebviewUri`; the mod's extension folder is added to the plot webview's `localResourceRoots`. CSP allows scripts only from those roots plus a per-load nonce."
  - Ruling: the root added is the folder that contains the view's `rendererScript` (an extension cannot be identified from the call). A renderer must be one self-contained file.
- "**Plugin folder**: CommonJS `.js` files in `~/.theia-phy/plugins/` and paths in the `theiaPhy.pluginPaths` setting, each exporting `{ activate(api: PhyApi) }`. … No runtime TS compiler is bundled. Plugins are never loaded from dataset folders. `Phy: Reload Plugins` reloads without restarting VS Code."
  - Ruling: renamed to `~/.phy-vscode/plugins/` and `phyVscode.pluginPaths`.
  - Ruling: the setting has `"scope": "machine"`, so a workspace's `.vscode/settings.json` cannot make the extension run code. Relative paths in it are ignored.
- "`Phy: New Plugin` scaffolds a plugin with an esbuild script."
- "registerView(def: ViewDefinition) … registerClusterMetric(def: { id; label; compute(clusterId, ctx): number | string }) … registerHistogram(def: { id; label; compute(spikeIds, ctx): Float64Array })".
- "`dockview-core` … is the only UI dependency; all other webview code is vanilla TypeScript." Adding a dependency to the extension is a defect.
- Carried from Plan 2:
  - The extension host owns all state.
  - Webview buffers are plain `ArrayBuffer`s.
  - Webview scripts only come from `dist/webview` or a mod renderer folder, plus a per-load nonce. There is no `unsafe-eval`.
- Commands: `phy.reloadPlugins` and `phy.newPlugin` have no `phyDatasetActive` condition, unlike the dataset commands. You scaffold a plugin before you open any data. Record this ruling in `docs/mods.md`.
- **Lanes:** none. The tasks share `modRegistry.ts`, `plotPanel.ts` and `extension.ts`, so run them in order.
- Commit messages: a `type: subject` line, then the attribution lines the session specifies. The commit steps below show the subject only.
- All commands run from the repo root. Unit tests: `npm test -w packages/extension -- <filter>`. Typecheck: `npm run typecheck`.
- Work on a new branch: `git switch -c phy-vscode-mods`.

## Review Focus

1. **A plugin that throws** at load, in `activate`, or after registering half of its things. Every other plugin and every built-in view still works, and the failed plugin's partial registrations are undone. *Pinned:* Task 7, "isolates a failing plugin".
2. **A cluster metric that throws, returns `NaN`/`Infinity`/an object, or reuses a column name** (`n_spikes`, a `cluster_*.tsv` column). The cell is empty, the table still renders, and there is one warning, not one per cluster. *Pinned:* Task 3.
3. **Two mods registering the same view, metric or histogram id**, or an id that collides with a built-in. The second registration fails with a message naming the id. The first keeps working. *Pinned:* Task 2.
4. **Reloading plugins with a dataset open.** The dock layout (including views the user closed), table sort, settings and selection survive. A removed plugin's tab disappears, and a changed renderer is fetched afresh, not served from the module cache. *Pinned:* Task 5 layout tests, Task 10 smoke reload.
5. **A mod renderer that is missing, throws on load, or lacks `mount`/`update`/`dispose`.** That view's header shows the error. The other views are unaffected and nothing stays blank without a message. *Pinned:* Task 5 `moduleRenderer` tests.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/api/src/plot.ts` (new) | Scene, `Plot`, `ViewRenderer`, `RendererHost` types, moved out of the extension | 1 |
| `packages/api/src/helpers.ts` (new) | `parseColor`, `withAlpha`, `colorOf`, `emptyScene`, moved or added | 1 |
| `packages/api/src/mods.ts` (new) | `PhyApi`, `ViewDefinition`, `ClusterMetricDefinition`, `UriLike`, `API_VERSION`, `satisfiesApi` | 1 |
| `packages/extension/src/host/modRegistry.ts` (new) | Views, metrics and histograms, built-in and mod; change events; `hold()` | 2 |
| `packages/extension/src/host/session.ts` | Metric columns on the cluster table | 3 |
| `packages/extension/src/host/viewScheduler.ts` | `viewChanged`, `reset` | 4 |
| `packages/extension/src/webview/plot/layout.ts` (new) | Versioned layout and "known views" bookkeeping | 5 |
| `packages/extension/src/webview/plot/moduleRenderer.ts` (new) | Loads a mod renderer module | 5 |
| `packages/extension/src/host/phyApi.ts` (new) | Builds the `PhyApi` object | 6 |
| `packages/extension/src/host/plotPanel.ts`, `clusterView.ts`, `editor.ts`, `src/extension.ts` | Use the registry; reload the page when the view list changes | 6 |
| `packages/extension/src/host/plugins.ts` (new) | Plugin discovery, loading, scoped API, reload | 7 |
| `packages/extension/src/host/scaffold.ts` (new), `templates/plugin/**` (new) | `Phy: New Plugin` | 8 |
| `packages/extension/package.json`, `esbuild.mjs`, `.vscodeignore`, `src/extension.ts` | Commands, setting, packaging, glue | 9 |
| `packages/extension/test/smoke/index.ts` | End-to-end in real VS Code | 10 |
| `docs/mods.md` (new), `README.md` | Author guide | 11 |
| `examples/taro-cell/**` (new), `packages/extension/test/taroCell.test.ts` | Example plugin: taro-station cell page for the selected cluster | 12 |

---

### Task 1: Move the renderer contract into `@phy-vscode/api`; add `PhyApi` types and the version check

The spec exports the plot layer's types to mods through the API. They live in the extension today. Move them, leave re-exports behind so no other file changes, and add the new public types.

**Files:**
- Create: `packages/api/src/plot.ts`, `packages/api/src/helpers.ts`, `packages/api/src/mods.ts`
- Modify: `packages/api/src/index.ts`, `packages/api/package.json`, `packages/extension/package.json`
- Modify: `packages/extension/src/webview/plot/scene.ts`, `geometry.ts`, `renderer.ts`, `plot.ts`, `view.ts`
- Test: `packages/extension/test/api.test.ts`

**Interfaces:**
- Consumes: the existing definitions in the files above.
- Produces (from `@phy-vscode/api`):
  - Types: `Rgba`, `Range`, `ScatterLayer`, `LinesLayer`, `BarsLayer`, `Layer`, `Panel`, `Scene`, `Theme`, `PlotClick`, `Plot`, `RendererHost`, `ViewRenderer`, `UriLike`, `ViewDefinition`, `ClusterMetricDefinition`, `PhyApi`.
  - Functions: `parseColor(css: string, alpha?: number): Rgba`, `withAlpha(c: Rgba, a: number): Rgba`, `colorOf(selection: SelectionMsg, id: number, alpha?: number): Rgba`, `emptyScene(message: string): Scene`, `satisfiesApi(range: string, version?: string): boolean`.
  - Constant: `API_VERSION: string` (`'0.2.0'`).

- [ ] **Step 1: Write the failing test** — `packages/extension/test/api.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { API_VERSION, colorOf, emptyScene, satisfiesApi } from '@phy-vscode/api';
import { describe, expect, it } from 'vitest';

describe('API_VERSION', () => {
  it('matches the api package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../api/package.json', import.meta.url), 'utf8'));
    expect(API_VERSION).toBe(pkg.version);
  });
});

describe('satisfiesApi', () => {
  it('caret on 0.x pins the minor', () => {
    expect(satisfiesApi('^0.2.0', '0.2.0')).toBe(true);
    expect(satisfiesApi('^0.2.0', '0.2.7')).toBe(true);
    expect(satisfiesApi('^0.2.3', '0.2.1')).toBe(false);
    expect(satisfiesApi('^0.2.0', '0.3.0')).toBe(false);
    expect(satisfiesApi('^0.2.0', '0.1.9')).toBe(false);
  });
  it('caret from 1.0 pins the major', () => {
    expect(satisfiesApi('^1.2.0', '1.3.0')).toBe(true);
    expect(satisfiesApi('^1.2.0', '1.1.9')).toBe(false);
    expect(satisfiesApi('^1.2.0', '2.0.0')).toBe(false);
  });
  it('accepts an exact version and rejects anything it cannot read', () => {
    expect(satisfiesApi('0.2.0', '0.2.0')).toBe(true);
    expect(satisfiesApi('0.2.0', '0.2.1')).toBe(false);
    expect(satisfiesApi('latest', '0.2.0')).toBe(false);
    expect(satisfiesApi('^0.2.0', 'x')).toBe(false);
  });
  it('defaults to the running API version', () => {
    expect(satisfiesApi(`^${API_VERSION}`)).toBe(true);
  });
});

describe('helpers', () => {
  it('emptyScene is a message scene', () => {
    expect(emptyScene('Select a cluster')).toEqual({ rows: 1, cols: 1, panels: [], message: 'Select a cluster' });
  });
  it('colorOf is the selection colour, grey when not selected', () => {
    const sel = { ids: [5], colors: ['#ff0000'] };
    expect(colorOf(sel, 5)).toEqual([1, 0, 0, 1]);
    expect(colorOf(sel, 5, 0.25)).toEqual([1, 0, 0, 0.25]);
    expect(colorOf(sel, 6)).toEqual([0.5, 0.5, 0.5, 1]);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `npm test -w packages/extension -- api`
Expected: FAIL (`API_VERSION`/`satisfiesApi` are not exported).

- [ ] **Step 3: Create `packages/api/src/plot.ts`**

```ts
import type { SelectionMsg } from './protocol';

export type Rgba = readonly [number, number, number, number];
export interface Range {
  min: number;
  max: number;
}

export interface ScatterLayer {
  kind: 'scatter';
  x: Float32Array;
  y: Float32Array;
  color: Rgba;
  size: number; // CSS px
}
/** Polylines; consecutive polylines are separated by a NaN vertex. `width` is in CSS px (default 1); widths above 1 are approximated by repeated passes at pixel offsets, are capped at 8, and look uniform only when the colour is opaque, so use them on opaque lines. */
export interface LinesLayer {
  kind: 'lines';
  x: Float32Array;
  y: Float32Array;
  color: Rgba;
  width?: number;
}
/** Bars starting at x0 with width dx; `horizontal` swaps axes (bars grow along x). */
export interface BarsLayer {
  kind: 'bars';
  x0: number;
  dx: number;
  heights: Float32Array;
  color: Rgba;
  horizontal?: boolean;
}
export type Layer = ScatterLayer | LinesLayer | BarsLayer;

export interface Panel {
  row: number;
  col: number;
  x: Range;
  y: Range;
  layers: Layer[];
  axes?: boolean; // default true
  title?: string;
  xLabel?: string;
  yLabel?: string;
  vlines?: number[]; // dashed guides at these x (data units)
  hlines?: number[]; // dashed guides at these y
}

export interface Scene {
  rows: number;
  cols: number;
  panels: Panel[];
  colWeights?: number[];
  rowWeights?: number[];
  message?: string; // centred text, e.g. "Select a cluster"
}

export interface Theme {
  fg: Rgba;
  muted: Rgba;
  bg: Rgba;
}
export interface PlotClick {
  panel: number;
  x: number;
  y: number;
  shift: boolean;
  button: number;
}
/** The shared WebGL2 + Canvas2D plot layer a renderer draws a `Scene` with. */
export interface Plot {
  setScene(scene: Scene): void;
  onClick(listener: (e: PlotClick) => void): void;
  theme(): Theme;
  dispose(): void;
}

/** What a renderer can ask of its host (the plot webview shell). */
export interface RendererHost {
  /** Provider settings for this view; `setSettings` recomputes the view on the host. */
  readonly settings: Readonly<Record<string, unknown>>;
  setSettings(settings: Record<string, unknown>): void;
  /** Renderer-only UI state, persisted per dataset; no recompute. */
  getState<T>(): T | undefined;
  setState(state: unknown): void;
}

/** Webview half of a view: a mod's renderer module exports `mount`, `update` and `dispose` (or a default factory returning them). */
export interface ViewRenderer {
  mount(el: HTMLElement, plot: Plot, host: RendererHost): void;
  update(meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg): void;
  dispose(): void;
}
```

- [ ] **Step 4: Create `packages/api/src/helpers.ts`**

```ts
import type { Rgba, Scene } from './plot';
import type { SelectionMsg } from './protocol';

const GREY: Rgba = [0.5, 0.5, 0.5, 1];

export const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

/** `#rgb`, `#rrggbb[aa]` or `rgb[a](…)` to 0–1 components; anything else is grey. */
export function parseColor(css: string, alpha?: number): Rgba {
  const s = css.trim();
  let c: Rgba = GREY;
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) c = [...m[1].split('').map((h) => parseInt(h + h, 16) / 255), 1] as unknown as Rgba;
  else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) {
    const v = (i: number) => parseInt(m![1].slice(i, i + 2), 16) / 255;
    c = [v(0), v(2), v(4), m[2] ? parseInt(m[2], 16) / 255 : 1];
  } else if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s))) {
    c = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] === undefined ? 1 : Number(m[4])];
  }
  return alpha === undefined ? c : withAlpha(c, alpha);
}

/** The Session colour of `id` within this selection (grey when not selected). */
export function colorOf(selection: SelectionMsg, id: number, alpha?: number): Rgba {
  const i = selection.ids.indexOf(id);
  return parseColor(i < 0 ? '#808080' : selection.colors[i], alpha);
}

/** A scene that shows only a centred message, e.g. "Select a cluster". */
export const emptyScene = (message: string): Scene => ({ rows: 1, cols: 1, panels: [], message });
```

- [ ] **Step 5: Create `packages/api/src/mods.ts`**

```ts
import type { CancellationToken, ComputeContext, Disposable, Event, HistogramDefinition, PhySession, ViewContext, ViewResult } from './index';

/** The semver of this API. A plugin may declare `apiVersion` (see `satisfiesApi`); a VS Code extension compares it to `PhyApi.version` itself. */
export const API_VERSION = '0.2.0';

const parse = (v: string): [number, number, number] | undefined => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

/**
 * Does `version` satisfy `range`? Only an exact `x.y.z` or a caret range `^x.y.z` is understood: for 0.x the minor must
 * match and the patch be at least the range's; from 1.0 the major must match and the rest be at least the range's.
 */
export function satisfiesApi(range: string, version: string = API_VERSION): boolean {
  const caret = range.trim().startsWith('^');
  const want = parse(caret ? range.trim().slice(1) : range);
  const have = parse(version);
  if (!want || !have) return false;
  const [wM, wm, wp] = want;
  const [hM, hm, hp] = have;
  if (!caret) return wM === hM && wm === hm && wp === hp;
  if (hM !== wM) return false;
  if (wM === 0) return hm === wm && hp >= wp;
  return hm > wm || (hm === wm && hp >= wp);
}

/** Anything with a file-system path; a `vscode.Uri` qualifies. */
export interface UriLike {
  readonly fsPath: string;
}

export interface ViewDefinition {
  /** Letters, digits, `_`, `.` and `-`, starting with a letter or `_`. Must be unique. */
  id: string;
  title: string;
  /** Runs in the extension host on every selection change while the view is visible. */
  provider(ctx: ViewContext, token: CancellationToken): Promise<ViewResult>;
  /**
   * Path of an ES module that runs in the plot webview and exports `{ mount(el, plot, host), update(meta, buffers, selection),
   * dispose() }` (or a default function returning that). Bundle it into one file: only its own folder is served.
   */
  rendererScript: UriLike;
}

export interface ClusterMetricDefinition {
  /** The table column's name, so it must be usable in the filter box: no spaces. Cannot reuse a built-in column. */
  id: string;
  /** Shown as the column header's tooltip. */
  label: string;
  /** Runs synchronously in the extension host, once per cluster. A non-finite number, a throw or any other type leaves the cell empty. */
  compute(clusterId: number, ctx: ComputeContext): number | string;
}

export interface PhyApi {
  /** `API_VERSION`. */
  readonly version: string;
  activeSession(): PhySession | undefined;
  readonly onDidOpenSession: Event<PhySession>;
  registerView(def: ViewDefinition): Disposable;
  registerClusterMetric(def: ClusterMetricDefinition): Disposable;
  /** Adds a panel to the Cluster statistics view. */
  registerHistogram(def: HistogramDefinition): Disposable;
}
```

- [ ] **Step 6: Export them from `packages/api/src/index.ts`**

Replace the last line, `export type * from './protocol';`, with:

```ts
export type * from './protocol';
export type * from './plot';
export * from './helpers';
export * from './mods';
```

- [ ] **Step 7: Bump the versions**

Run:
```bash
sed -i '' 's/"version": "0.1.0"/"version": "0.2.0"/' packages/api/package.json
sed -i '' 's#"@phy-vscode/api": "0.1.0"#"@phy-vscode/api": "0.2.0"#' packages/extension/package.json
npm install
```
Expected: `package-lock.json` changes only the api package's version lines.

- [ ] **Step 8: Replace the extension's definitions with re-exports**

`packages/extension/src/webview/plot/scene.ts` becomes the whole file:

```ts
import { emptyScene } from '@phy-vscode/api';

export type { BarsLayer, Layer, LinesLayer, Panel, Rgba, ScatterLayer, Scene } from '@phy-vscode/api';
export const EMPTY = emptyScene;
```

`packages/extension/src/webview/plot/view.ts`: delete the `export interface Range { … }` block at the top and add, as its first lines:

```ts
import type { Range } from '@phy-vscode/api';
export type { Range };
```

`packages/extension/src/webview/plot/geometry.ts`: delete `const GREY…`, the whole `parseColor` function with its doc comment, and the `export const withAlpha…` line (the 107–124 region; `grep -n "GREY\|withAlpha\|parseColor" src/webview/plot/geometry.ts` to find them). Replace the first line `import type { Rgba } from './scene';` with:

```ts
import { parseColor, withAlpha } from '@phy-vscode/api';
import type { Rgba } from './scene';

export { parseColor, withAlpha };
```

`packages/extension/src/webview/plot/plot.ts`: delete the `export interface Theme`, `PlotClick` and `Plot` blocks (lines 6–23). Add after the imports:

```ts
import type { Plot, PlotClick, Theme } from '@phy-vscode/api';
export type { Plot, PlotClick, Theme };
```

`packages/extension/src/webview/plot/renderer.ts`: delete the `RendererHost` and `ViewRenderer` interfaces and the `colorOf` function at the bottom, and replace all four import lines at the top with:

```ts
import type { Plot, SelectionMsg, Theme, ViewRenderer } from '@phy-vscode/api';
import type { Scene } from './scene';

export type { RendererHost, ViewRenderer } from '@phy-vscode/api';
export { colorOf } from '@phy-vscode/api';
```
(`sceneRenderer` and `addToolbar` stay as they are.)

- [ ] **Step 9: Run the checks**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS, including the new `api.test.ts` and the untouched `plot.test.ts` (which imports `parseColor`/`withAlpha` from `geometry`).

- [ ] **Step 10: Commit**

```bash
git add packages/api packages/extension package-lock.json
git commit -m "feat(api): export the renderer contract, PhyApi types and a version check"
```

---

### Task 2: `ModRegistry`

One vscode-free object owns every view, metric and histogram. Everything later reads it.

**Files:**
- Create: `packages/extension/src/host/modRegistry.ts`
- Modify: `packages/extension/src/views/index.ts`, `packages/extension/src/views/stats/provider.ts`
- Test: `packages/extension/test/modRegistry.test.ts`

**Interfaces:**
- Consumes: `Emitter` (`src/host/emitter.ts`), `builtinHistograms`/`clusterStatsView` (`views/stats/provider.ts`), `HostViewContext` (`views/types.ts`).
- Produces:
  - `makeBuiltinViews(histograms: () => readonly HistogramDefinition[]): BuiltinView[]` (`views/index.ts`). `builtinViews` stays.
  - `clusterStatsView(histograms: readonly HistogramDefinition[] | (() => readonly HistogramDefinition[])): BuiltinView`.
  - `BASE_COLUMNS: readonly string[]`.
  - `interface ViewEntry { id: string; title: string; provider(ctx: HostViewContext, token: CancellationToken): Promise<ViewResult>; rendererScript?: UriLike; generation: number }`.
  - `interface RegistryChange { views: boolean; metrics: boolean; histograms: boolean }`.
  - `class ModRegistry`:
    - `onDidChange: Event<RegistryChange>`
    - `views(): readonly ViewEntry[]` (built-ins first)
    - `view(id: string): ViewEntry | undefined`
    - `metrics(): readonly ClusterMetricDefinition[]`
    - `histograms(): readonly HistogramDefinition[]`
    - `registerView(def: ViewDefinition): Disposable`
    - `registerClusterMetric(def: ClusterMetricDefinition): Disposable`
    - `registerHistogram(def: HistogramDefinition): Disposable`
    - `hold(): () => void`
  - `metrics()` and `histograms()` return the same array object until the set changes; Task 3 relies on that.

- [ ] **Step 1: Write the failing tests** — `packages/extension/test/modRegistry.test.ts`

```ts
import type { ViewDefinition } from '@phy-vscode/api';
import { describe, expect, it } from 'vitest';
import { inlineCompute } from '../src/compute';
import { ModRegistry, type RegistryChange } from '../src/host/modRegistry';
import type { StatsMeta } from '../src/views/stats/provider';
import { live, openSession } from './helpers';

const view = (id: string, extra: Partial<ViewDefinition> = {}): ViewDefinition => ({
  id,
  title: id,
  rendererScript: { fsPath: `/mods/${id}/renderer.js` },
  provider: async () => ({ meta: { id }, buffers: [] }),
  ...extra,
});
const metric = (id: string) => ({ id, label: id, compute: () => 1 });
const histogram = (id: string) => ({ id, label: id, compute: () => new Float64Array(3) });
const collect = (r: ModRegistry) => {
  const events: RegistryChange[] = [];
  r.onDidChange((c) => events.push(c));
  return events;
};

describe('ModRegistry views', () => {
  it('lists built-in views first, then mod views in registration order', () => {
    const r = new ModRegistry();
    r.registerView(view('a'));
    r.registerView(view('b'));
    expect(r.views().map((v) => v.id)).toEqual(['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics', 'a', 'b']);
    expect(r.view('a')?.rendererScript?.fsPath).toBe('/mods/a/renderer.js');
    expect(r.view('waveform')?.rendererScript).toBeUndefined();
  });

  it('removes a view on dispose, and dispose is idempotent', () => {
    const r = new ModRegistry();
    const events = collect(r);
    const d = r.registerView(view('a'));
    d.dispose();
    d.dispose();
    expect(r.view('a')).toBeUndefined();
    expect(events).toHaveLength(2);
  });

  it('rejects duplicate, built-in and malformed ids and a missing renderer, keeping the first registration', async () => {
    const r = new ModRegistry();
    r.registerView(view('a'));
    expect(() => r.registerView(view('a'))).toThrow(/view 'a' is already registered/);
    expect(() => r.registerView(view('waveform'))).toThrow(/already registered/);
    expect(() => r.registerView(view('has space'))).toThrow(/view id must match/);
    expect(() => r.registerView(view('x', { rendererScript: undefined as never }))).toThrow(/needs a rendererScript/);
    expect((await r.view('a')!.provider({} as never, live)).meta).toEqual({ id: 'a' });
  });

  it('gives each registration a new generation', () => {
    const r = new ModRegistry();
    r.registerView(view('a')).dispose();
    r.registerView(view('a'));
    expect(r.view('a')!.generation).toBe(2);
  });

  it('hands a mod provider the session and settings only', async () => {
    const r = new ModRegistry();
    let seen: Record<string, unknown> | undefined;
    r.registerView(view('a', { provider: async (ctx) => ((seen = { ...ctx }), { meta: null, buffers: [] }) }));
    await r.view('a')!.provider({ session: 'S' as never, compute: 'C' as never, settings: { k: 1 } }, live);
    expect(seen).toEqual({ session: 'S', settings: { k: 1 } });
  });

  it('turns a synchronous throw in a mod provider into a rejection', async () => {
    const r = new ModRegistry();
    r.registerView(
      view('a', {
        provider: () => {
          throw new Error('boom');
        },
      }),
    );
    await expect(r.view('a')!.provider({} as never, live)).rejects.toThrow('boom');
  });
});

describe('ModRegistry metrics and histograms', () => {
  it('rejects duplicate ids, built-in columns and a missing compute', () => {
    const r = new ModRegistry();
    r.registerClusterMetric(metric('m'));
    expect(() => r.registerClusterMetric(metric('m'))).toThrow(/cluster metric 'm' is already registered/);
    expect(() => r.registerClusterMetric(metric('n_spikes'))).toThrow(/built-in table column/);
    expect(() => r.registerClusterMetric({ id: 'z', label: 'z' } as never)).toThrow(/needs a compute function/);
    r.registerHistogram(histogram('h'));
    expect(() => r.registerHistogram(histogram('h'))).toThrow(/histogram 'h' is already registered/);
    expect(() => r.registerHistogram(histogram('isi'))).toThrow(/already registered/);
  });

  it('changes the identity of metrics() and histograms() only when the set changes', () => {
    const r = new ModRegistry();
    const m0 = r.metrics();
    expect(r.metrics()).toBe(m0);
    const d = r.registerClusterMetric(metric('m'));
    expect(r.metrics()).not.toBe(m0);
    expect(r.metrics().map((m) => m.id)).toEqual(['m']);
    d.dispose();
    expect(r.metrics()).toEqual([]);
    const h0 = r.histograms();
    expect(r.histograms().map((h) => h.id)).toEqual(['isi', 'firing_rate']);
    r.registerHistogram(histogram('h'));
    expect(r.histograms()).not.toBe(h0);
  });

  it('the Cluster statistics view follows the registered histograms', async () => {
    const { session } = await openSession('base', [2]);
    const r = new ModRegistry();
    const ids = async () =>
      ((await r.view('cluster_statistics')!.provider({ session, compute: inlineCompute, settings: {} }, live)).meta as StatsMeta).histograms.map((h) => h.id);
    expect(await ids()).toEqual(['isi', 'firing_rate']);
    const d = r.registerHistogram(histogram('mine'));
    expect(await ids()).toEqual(['isi', 'firing_rate', 'mine']);
    d.dispose();
    expect(await ids()).toEqual(['isi', 'firing_rate']);
  });
});

describe('ModRegistry change events', () => {
  it('says which collections changed', () => {
    const r = new ModRegistry();
    const events = collect(r);
    r.registerHistogram(histogram('h'));
    expect(events).toEqual([{ views: false, metrics: false, histograms: true }]);
  });

  it('defers events while held and fires one merged event on release', () => {
    const r = new ModRegistry();
    const events = collect(r);
    const release = r.hold();
    const a = r.registerView(view('a'));
    r.registerClusterMetric(metric('m'));
    a.dispose();
    expect(events).toEqual([]);
    release();
    release();
    expect(events).toEqual([{ views: true, metrics: true, histograms: false }]);
  });

  it('fires nothing on release when nothing changed', () => {
    const r = new ModRegistry();
    const events = collect(r);
    r.hold()();
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `npm test -w packages/extension -- modRegistry`
Expected: FAIL (module `../src/host/modRegistry` not found).

- [ ] **Step 3: Let the statistics view take a live list** — `packages/extension/src/views/stats/provider.ts`

Replace `clusterStatsView` with:

```ts
export function clusterStatsView(histograms: readonly HistogramDefinition[] | (() => readonly HistogramDefinition[])): BuiltinView {
  const current = typeof histograms === 'function' ? histograms : () => histograms;
  return {
    id: 'cluster_statistics',
    title: 'Cluster statistics',
    async provider({ session }, token) {
      const ctx = { session };
      const list = current(); // one snapshot per run, so meta and buffers agree
      const buffers: ArrayBufferLike[] = [];
      for (const h of list) {
        for (const id of session.selection) {
          checkCancel(token);
          buffers.push(h.compute(session.spikesOf(id), ctx).buffer);
        }
      }
      const meta: StatsMeta = {
        clusters: [...session.selection],
        histograms: list.map((h) => ({ id: h.id, label: h.label, unit: h.unit, range: h.range?.(ctx) })),
      };
      return { meta, buffers };
    },
  };
}
```

`packages/extension/src/views/index.ts` becomes the whole file:

```ts
import type { HistogramDefinition } from '@phy-vscode/api';
import { amplitudeView } from './amplitude/provider';
import { correlogramView } from './correlogram/provider';
import { featureView } from './feature/provider';
import { builtinHistograms, clusterStatsView } from './stats/provider';
import type { BuiltinView } from './types';
import { waveformView } from './waveform/provider';

export const makeBuiltinViews = (histograms: () => readonly HistogramDefinition[]): BuiltinView[] => [
  waveformView,
  featureView,
  correlogramView,
  amplitudeView,
  clusterStatsView(histograms),
];

export const builtinViews: BuiltinView[] = makeBuiltinViews(() => builtinHistograms);
```

- [ ] **Step 4: Write `packages/extension/src/host/modRegistry.ts`**

```ts
import type { CancellationToken, ClusterMetricDefinition, Disposable, HistogramDefinition, UriLike, ViewDefinition, ViewResult } from '@phy-vscode/api';
import { makeBuiltinViews } from '../views';
import { builtinHistograms } from '../views/stats/provider';
import type { HostViewContext } from '../views/types';
import { Emitter } from './emitter';

/** Columns every cluster table has; a metric may not reuse them. */
export const BASE_COLUMNS: readonly string[] = ['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate'];
const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export interface ViewEntry {
  id: string;
  title: string;
  provider(ctx: HostViewContext, token: CancellationToken): Promise<ViewResult>;
  /** Mod views only: the webview module that draws them. Built-in renderers are bundled into plot.js. */
  rendererScript?: UriLike;
  /** Bumps on every registration, so a re-registered view's renderer module is fetched afresh. */
  generation: number;
}
export interface RegistryChange {
  views: boolean;
  metrics: boolean;
  histograms: boolean;
}

function checkId(kind: string, id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error(`${kind} id must match ${ID}, got ${JSON.stringify(id)}`);
}

/** Every view, cluster metric and histogram, built-in and from mods. Pure: no vscode, so it is unit-tested. */
export class ModRegistry {
  private readonly builtin: ViewEntry[];
  private mods: ViewEntry[] = [];
  private metricList: readonly ClusterMetricDefinition[] = [];
  private histogramList: readonly HistogramDefinition[] = builtinHistograms;
  private generation = 0;
  private holds = 0;
  private pending: RegistryChange | undefined;
  private readonly emitter = new Emitter<RegistryChange>();
  readonly onDidChange = this.emitter.event;

  constructor() {
    this.builtin = makeBuiltinViews(() => this.histogramList).map((v) => ({ ...v, generation: 0 }));
  }

  views(): readonly ViewEntry[] {
    return [...this.builtin, ...this.mods];
  }
  view(id: string): ViewEntry | undefined {
    return this.views().find((v) => v.id === id);
  }
  /** The same array object until the set changes. */
  metrics(): readonly ClusterMetricDefinition[] {
    return this.metricList;
  }
  /** The same array object until the set changes. */
  histograms(): readonly HistogramDefinition[] {
    return this.histogramList;
  }

  registerView(def: ViewDefinition): Disposable {
    checkId('view', def.id);
    if (!def.title) throw new Error(`view '${def.id}' needs a title`);
    if (!def.rendererScript?.fsPath) throw new Error(`view '${def.id}' needs a rendererScript`);
    if (this.view(def.id)) throw new Error(`view '${def.id}' is already registered`);
    const entry: ViewEntry = {
      id: def.id,
      title: def.title,
      rendererScript: def.rendererScript,
      generation: ++this.generation,
      // async: a provider that throws synchronously must reject, not escape the scheduler
      provider: async ({ session, settings }, token) => def.provider({ session, settings }, token),
    };
    this.mods = [...this.mods, entry];
    this.changed({ views: true });
    return {
      dispose: () => {
        if (!this.mods.includes(entry)) return;
        this.mods = this.mods.filter((e) => e !== entry);
        this.changed({ views: true });
      },
    };
  }

  registerClusterMetric(def: ClusterMetricDefinition): Disposable {
    checkId('cluster metric', def.id);
    if (BASE_COLUMNS.includes(def.id)) throw new Error(`cluster metric id '${def.id}' is a built-in table column`);
    if (typeof def.compute !== 'function') throw new Error(`cluster metric '${def.id}' needs a compute function`);
    if (this.metricList.some((m) => m.id === def.id)) throw new Error(`cluster metric '${def.id}' is already registered`);
    this.metricList = [...this.metricList, def];
    this.changed({ metrics: true });
    return {
      dispose: () => {
        if (!this.metricList.includes(def)) return;
        this.metricList = this.metricList.filter((m) => m !== def);
        this.changed({ metrics: true });
      },
    };
  }

  registerHistogram(def: HistogramDefinition): Disposable {
    checkId('histogram', def.id);
    if (typeof def.compute !== 'function') throw new Error(`histogram '${def.id}' needs a compute function`);
    if (this.histogramList.some((h) => h.id === def.id)) throw new Error(`histogram '${def.id}' is already registered`);
    this.histogramList = [...this.histogramList, def];
    this.changed({ histograms: true });
    return {
      dispose: () => {
        if (!this.histogramList.includes(def)) return;
        this.histogramList = this.histogramList.filter((h) => h !== def);
        this.changed({ histograms: true });
      },
    };
  }

  /** Defer change events until the returned function is called (it merges them into one event). Holds nest. */
  hold(): () => void {
    this.holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holds === 0) this.flush();
    };
  }

  private changed(c: Partial<RegistryChange>): void {
    const p = this.pending ?? { views: false, metrics: false, histograms: false };
    this.pending = { views: p.views || !!c.views, metrics: p.metrics || !!c.metrics, histograms: p.histograms || !!c.histograms };
    if (this.holds === 0) this.flush();
  }

  private flush(): void {
    const p = this.pending;
    this.pending = undefined;
    if (p) this.emitter.fire(p);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w packages/extension -- modRegistry providers && npm run typecheck`
Expected: PASS (`providers.test.ts` still passes with the array form of `clusterStatsView`).

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src packages/extension/test/modRegistry.test.ts
git commit -m "feat: ModRegistry for built-in and mod views, metrics and histograms"
```

---

### Task 3: Cluster-metric columns in the Session and sidebar tooltips

**Files:**
- Modify: `packages/extension/src/host/session.ts`, `packages/api/src/protocol.ts`, `packages/extension/src/webview/sidebar/main.ts`
- Test: `packages/extension/test/session-metrics.test.ts`

**Interfaces:**
- Consumes: `ClusterMetricDefinition` (Task 1). The registry's stable `metrics()` array (Task 2).
- Produces:
  - `interface SessionMods { metrics?(): readonly ClusterMetricDefinition[]; warn?(message: string): void }`.
  - `new Session(dataset, mods?: SessionMods)`.
  - `session.clusters` is now a getter. The table is rebuilt only when `mods.metrics()` returns a different array; each metric's column is computed once.
  - `session.metricLabels(): Record<string, string>`.
  - `HostToSidebar` `clusterTable` gains `labels?: Record<string, string>`.

- [ ] **Step 1: Write the failing tests** — `packages/extension/test/session-metrics.test.ts`

```ts
import type { ClusterMetricDefinition } from '@phy-vscode/api';
import { expect, it, onTestFinished, vi } from 'vitest';
import { openDataset } from '../src/host/dataset/dataset';
import { Session } from '../src/host/session';
import { fixtureParams } from './fixtures/makeFixture';

async function sessionWith(initial: ClusterMetricDefinition[]) {
  let defs: readonly ClusterMetricDefinition[] = initial;
  const warn = vi.fn();
  const session = new Session(await openDataset(fixtureParams('base')), { metrics: () => defs, warn });
  onTestFinished(async () => {
    session.dispose();
    await session.dataset.close();
  });
  return { session, warn, set: (d: ClusterMetricDefinition[]) => (defs = d) };
}
const metric = (id: string, compute: ClusterMetricDefinition['compute']): ClusterMetricDefinition => ({ id, label: `L ${id}`, compute });
const col = (s: Session, id: string) => {
  const i = s.clusters.columns.indexOf(id);
  return s.clusters.rows.map((r) => r[i]);
};

it('appends a column per metric after the dataset columns, with its label', async () => {
  const { session } = await sessionWith([metric('double', (id) => id * 2)]);
  expect(session.clusters.columns.slice(-3)).toEqual(['ContamPct', 'KSLabel', 'double']);
  expect(col(session, 'double')).toEqual(session.clusters.rows.map((r) => (r[0] as number) * 2));
  expect(session.metricLabels()).toEqual({ double: 'L double' });
});

it('hands the metric the session', async () => {
  const { session } = await sessionWith([metric('count', (id, ctx) => ctx.session.spikesOf(id).length)]);
  expect(col(session, 'count')).toEqual(col(session, 'n_spikes'));
});

it('leaves a cell empty when the metric throws or returns something unusable, and warns once', async () => {
  const flaky = metric('flaky', (id) => {
    if (id === 2) throw new Error('boom');
    if (id === 7) return NaN;
    if (id === 11) return {} as never;
    return 'ok';
  });
  const { session, warn } = await sessionWith([flaky]);
  const ids = session.clusters.rows.map((r) => r[0]);
  const values = col(session, 'flaky');
  expect(values[ids.indexOf(2)]).toBeNull();
  expect(values[ids.indexOf(7)]).toBeNull();
  expect(values.filter((v) => v === 'ok').length).toBe(ids.length - 2 - (ids.includes(11) ? 1 : 0));
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/flaky.*cluster 2.*boom/);
});

it('skips a metric that reuses a dataset column, warning once', async () => {
  const { session, warn } = await sessionWith([metric('n_spikes', () => 0), metric('KSLabel', () => 'x')]);
  expect(session.clusters.columns.filter((c) => c === 'n_spikes')).toHaveLength(1);
  expect(session.clusters.rows.every((r) => r[1] !== 0)).toBe(true);
  void session.clusters;
  expect(warn).toHaveBeenCalledTimes(2);
  expect(session.metricLabels()).toEqual({});
});

it('computes a new metric without recomputing the existing ones, and keeps the table until the set changes', async () => {
  const a = vi.fn(() => 1);
  const first = metric('a', a);
  const { session, set } = await sessionWith([first]);
  const t1 = session.clusters;
  expect(session.clusters).toBe(t1);
  const calls = a.mock.calls.length;
  set([first, metric('b', () => 2)]);
  expect(col(session, 'b').every((v) => v === 2)).toBe(true);
  expect(a).toHaveBeenCalledTimes(calls);
  set([]);
  expect(session.clusters.columns).not.toContain('a');
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `npm test -w packages/extension -- session-metrics`
Expected: FAIL (`metricLabels` is not a function; the second constructor argument is ignored).

- [ ] **Step 3: Edit `packages/extension/src/host/session.ts`**

Change the first import line to `import type { Cell, ClusterMetricDefinition, ClusterTable, ClusterUpdate, PhySession } from '@phy-vscode/api';`. Then replace the `export class Session` header through the end of the constructor, that is these lines:

```ts
export class Session implements PhySession {
  readonly index: ClusterIndex;
  readonly clusters: ClusterTable;
```
…and…
```ts
  constructor(readonly dataset: Dataset) {
    this.index = buildClusterIndex(dataset.spikeClusters);
    this.clusters = this.buildTable();
  }
```
with:

```ts
export interface SessionMods {
  /** Registered cluster metrics. Must return the same array object until the set changes. */
  metrics?(): readonly ClusterMetricDefinition[];
  warn?(message: string): void;
}
const NO_METRICS: readonly ClusterMetricDefinition[] = [];

export class Session implements PhySession {
  readonly index: ClusterIndex;
  private readonly base: ClusterTable;
  private table: ClusterTable;
  private tableFor = NO_METRICS;
  private labels: Record<string, string> = {};
  private readonly metricColumns = new WeakMap<ClusterMetricDefinition, Cell[]>();
  private readonly warned = new Set<string>();
```
(keep the lines that follow `readonly clusters` as they are: `_selection`, the emitters, `channelCache`), and the constructor becomes:

```ts
  constructor(readonly dataset: Dataset, private readonly mods: SessionMods = {}) {
    this.index = buildClusterIndex(dataset.spikeClusters);
    this.base = this.table = this.buildTable();
  }

  /** The dataset's columns plus one per registered cluster metric. */
  get clusters(): ClusterTable {
    const defs = this.mods.metrics?.() ?? NO_METRICS;
    if (defs !== this.tableFor) {
      this.table = this.withMetrics(defs);
      this.tableFor = defs;
    }
    return this.table;
  }

  /** Column name → tooltip text for the metric columns. */
  metricLabels(): Record<string, string> {
    void this.clusters;
    return this.labels;
  }

  private warn(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    (this.mods.warn ?? console.warn)(message);
  }

  private withMetrics(defs: readonly ClusterMetricDefinition[]): ClusterTable {
    const live = defs.filter((d) => {
      if (!this.base.columns.includes(d.id)) return true;
      this.warn(`cluster metric '${d.id}' skipped: the dataset already has a column of that name`);
      return false;
    });
    this.labels = Object.fromEntries(live.map((d) => [d.id, d.label]));
    if (live.length === 0) return this.base;
    const columns = live.map((d) => this.metricColumn(d));
    return {
      columns: [...this.base.columns, ...live.map((d) => d.id)],
      rows: this.base.rows.map((r, i) => [...r, ...columns.map((c) => c[i])]),
    };
  }

  // ponytail: metrics run synchronously on the extension host, once per cluster; a heavy one blocks it. Move to a worker if one ever needs to.
  private metricColumn(d: ClusterMetricDefinition): Cell[] {
    let col = this.metricColumns.get(d);
    if (col) return col;
    const ctx = { session: this };
    col = this.base.rows.map((r) => {
      try {
        const v = d.compute(r[0] as number, ctx);
        return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : null;
      } catch (e) {
        this.warn(`cluster metric '${d.id}' failed for cluster ${r[0]}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    });
    this.metricColumns.set(d, col);
    return col;
  }
```
`buildTable()` is unchanged (it still returns the dataset's own table).

- [ ] **Step 4: Add the labels to the sidebar message** — `packages/api/src/protocol.ts`

Change the `clusterTable` member of `HostToSidebar` to:

```ts
  | { type: 'clusterTable'; columns: string[]; rows: Cell[][]; labels?: Record<string, string>; info: string; state: TableState }
```

`packages/extension/src/webview/sidebar/main.ts`: next to `let columns: string[] = [];` add `let labels: Record<string, string> = {};`. In the message handler change `({ columns, rows } = m);` to `({ columns, rows } = m);\n    labels = m.labels ?? {};`, and in `renderHeader` change `d.title = c;` to `d.title = labels[c] ?? c;`.

- [ ] **Step 5: Run the tests**

Run: `npm test -w packages/extension -- session sidebar && npm run typecheck`
Expected: PASS. The existing `session.test.ts` is unaffected because its `new Session(ds)` has no metrics.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/protocol.ts packages/extension/src packages/extension/test/session-metrics.test.ts
git commit -m "feat: cluster-metric columns on the cluster table"
```

---

### Task 4: `ViewScheduler.viewChanged` and `reset`

A mod histogram changing must recompute the statistics view. A reloaded plot page must start from scratch.

**Files:**
- Modify: `packages/extension/src/host/viewScheduler.ts`
- Test: `packages/extension/test/viewScheduler.test.ts`

**Interfaces:**
- Produces:
  - `scheduler.viewChanged(viewId: string): void`: drop the view's cached result and recompute it if it is shown. `setSettings` now delegates to it.
  - `scheduler.reset(): void`: forget everything the old webview showed.

- [ ] **Step 1: Add the failing tests** — append inside `describe('ViewScheduler', …)` in `packages/extension/test/viewScheduler.test.ts`

```ts
  it('viewChanged recomputes a visible view, and a hidden one when it is next shown', () => {
    const { s, calls } = harness();
    s.setVisible(['waveform']);
    calls.length = 0;
    s.viewChanged('waveform');
    expect(calls.map((c) => c.viewId)).toEqual(['waveform']);
    s.setVisible([]);
    calls.length = 0;
    s.viewChanged('waveform');
    expect(calls).toEqual([]);
    s.setVisible(['waveform']);
    expect(calls.map((c) => c.viewId)).toEqual(['waveform']);
  });

  it('reset drops in-flight results and recomputes the views the new webview reports', async () => {
    const { s, calls, posted, flush } = harness();
    s.setVisible(['waveform']);
    const old = calls[0];
    s.reset();
    expect(old.token.isCancellationRequested).toBe(true);
    old.resolve(result(1));
    await flush();
    expect(posted).toEqual([]);
    s.setVisible(['waveform']);
    expect(calls).toHaveLength(2);
  });
```

- [ ] **Step 2: Run them and check they fail**

Run: `npm test -w packages/extension -- viewScheduler`
Expected: FAIL (`s.viewChanged is not a function`).

- [ ] **Step 3: Edit `packages/extension/src/host/viewScheduler.ts`**

Replace `setSettings` with:

```ts
  setSettings(viewId: string, patch: Record<string, unknown>): void {
    this.settings[viewId] = { ...this.settingsOf(viewId), ...patch };
    this.viewChanged(viewId);
  }

  /** The view's inputs changed (not the selection): drop its cached result and recompute it if it is shown. */
  viewChanged(viewId: string): void {
    this.computedFor.delete(viewId);
    if (this.visible.has(viewId)) this.refresh(viewId);
    else {
      this.current.get(viewId)?.source.cancel();
      this.current.delete(viewId);
    }
  }

  /** The webview was replaced: forget what it showed. The new one reports its visible views, which are all recomputed. */
  reset(): void {
    for (const c of this.current.values()) c.source.cancel();
    this.current.clear();
    this.computedFor.clear();
    this.visible.clear();
  }
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w packages/extension -- viewScheduler`
Expected: PASS (the earlier settings tests still pass through `viewChanged`).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/viewScheduler.ts packages/extension/test/viewScheduler.test.ts
git commit -m "feat: ViewScheduler.viewChanged and reset"
```

---

### Task 5: The plot webview loads mod renderers

**Files:**
- Create: `packages/extension/src/webview/plot/layout.ts`, `packages/extension/src/webview/plot/moduleRenderer.ts`
- Modify: `packages/extension/src/webview/plot/main.ts`, `packages/extension/src/host/html.ts`, `packages/api/src/protocol.ts`
- Test: `packages/extension/test/layout.test.ts`, `packages/extension/test/moduleRenderer.test.ts`, `packages/extension/test/html.test.ts`

**Interfaces:**
- Produces:
  - `HostToPlot` `init.views` items become `{ id: string; title: string; rendererUri?: string }`.
  - `layout.ts`:
    - `SavedLayout { v: 2; dock: unknown; known: string[] }`
    - `LEGACY_KNOWN`
    - `unpackLayout(saved: unknown): { dock: unknown; known: string[] } | undefined`
    - `packLayout(dock: unknown, known: Iterable<string>): SavedLayout`
    - `newViews(registered: readonly string[], known: Iterable<string>): string[]`
  - `moduleRenderer(url: string, report: (error?: string) => void, load?: (url: string) => Promise<unknown>): ViewRenderer`
    - Calls `report(undefined)` after replaying an update it held while loading.
    - Calls `report(message)` once on any failure.
  - `webviewHtml` allows scripts from `cspSource` as well as the nonce.

- [ ] **Step 1: Write the failing tests**

`packages/extension/test/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LEGACY_KNOWN, newViews, packLayout, unpackLayout } from '../src/webview/plot/layout';

describe('layout', () => {
  it('reads nothing as no layout', () => {
    expect(unpackLayout(undefined)).toBeUndefined();
    expect(unpackLayout(null)).toBeUndefined();
  });
  it('reads a Plan 2 layout (bare dockview JSON) as having seen only the built-in views', () => {
    expect(unpackLayout({ grid: { root: 1 } })).toEqual({ dock: { grid: { root: 1 } }, known: LEGACY_KNOWN });
  });
  it('round-trips a packed layout', () => {
    expect(unpackLayout(packLayout({ grid: 2 }, new Set(['a', 'b'])))).toEqual({ dock: { grid: 2 }, known: ['a', 'b'] });
  });
  it('lists only registered views the layout has never seen, so closed views stay closed', () => {
    expect(newViews(['waveform', 'mine', 'other'], ['waveform', 'other'])).toEqual(['mine']);
    expect(newViews(['waveform'], LEGACY_KNOWN)).toEqual([]);
  });
});
```

`packages/extension/test/moduleRenderer.test.ts`:

```ts
import type { Plot, RendererHost, SelectionMsg } from '@phy-vscode/api';
import { describe, expect, it, vi } from 'vitest';
import { moduleRenderer } from '../src/webview/plot/moduleRenderer';

const el = {} as HTMLElement;
const plot = {} as Plot;
const host = {} as RendererHost;
const sel: SelectionMsg = { ids: [], colors: [] };
const flush = () => new Promise((r) => setTimeout(r, 0));
const mod = () => ({ mount: vi.fn(), update: vi.fn(), dispose: vi.fn() });

describe('moduleRenderer', () => {
  it('mounts after the module loads and replays only the latest update held meanwhile', async () => {
    const m = mod();
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => m);
    r.mount(el, plot, host);
    r.update(1, [], sel);
    r.update(2, [], sel);
    expect(m.mount).not.toHaveBeenCalled();
    await flush();
    expect(m.mount).toHaveBeenCalledWith(el, plot, host);
    expect(m.update.mock.calls).toEqual([[2, [], sel]]);
    expect(report).toHaveBeenCalledWith(undefined);
    r.update(3, [], sel);
    expect(m.update).toHaveBeenLastCalledWith(3, [], sel);
    r.dispose();
    expect(m.dispose).toHaveBeenCalledOnce();
  });

  it('accepts a default factory', async () => {
    const m = mod();
    const r = moduleRenderer('u', vi.fn(), async () => ({ default: () => m }));
    r.mount(el, plot, host);
    await flush();
    r.update(1, [], sel);
    expect(m.update).toHaveBeenCalledOnce();
  });

  it('reports a load failure once and ignores later updates', async () => {
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => {
      throw new Error('404');
    });
    r.mount(el, plot, host);
    r.update(1, [], sel);
    await flush();
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0]).toMatch(/could not load.*404/);
    expect(() => r.update(2, [], sel)).not.toThrow();
  });

  it('rejects a module without the renderer contract', async () => {
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => ({ mount() {} }));
    r.mount(el, plot, host);
    await flush();
    expect(report.mock.calls[0][0]).toMatch(/mount, update and dispose/);
  });

  it('reports a throw from the replayed update', async () => {
    const m = mod();
    m.update.mockImplementation(() => {
      throw new Error('bad meta');
    });
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => m);
    r.mount(el, plot, host);
    r.update(1, [], sel);
    await flush();
    expect(report.mock.calls[0][0]).toMatch(/render error: bad meta/);
  });

  it('does not mount a module that arrives after dispose', async () => {
    const m = mod();
    const r = moduleRenderer('u', vi.fn(), async () => m);
    r.mount(el, plot, host);
    r.dispose();
    await flush();
    expect(m.mount).not.toHaveBeenCalled();
  });
});
```

In `packages/extension/test/html.test.ts` change the CSP assertion line `expect(h).toContain("script-src 'nonce-abc123'");` to:

```ts
    expect(h).toContain("script-src vscode-resource: 'nonce-abc123'");
```
and rename that test's title to `'allows scripts only from the webview roots and the nonce, never eval'`.

- [ ] **Step 2: Run them and check they fail**

Run: `npm test -w packages/extension -- layout moduleRenderer html`
Expected: FAIL (the modules do not exist; the CSP string differs).

- [ ] **Step 3: Write `packages/extension/src/webview/plot/layout.ts`**

```ts
/** The plot webview's persisted layout: dockview's JSON plus the ids of every view it has been offered. */
export interface SavedLayout {
  v: 2;
  dock: unknown;
  known: string[];
}

/** Layouts saved by Plan 2 were the bare dockview JSON, written when only the built-in views existed. */
export const LEGACY_KNOWN = ['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics'];

export function unpackLayout(saved: unknown): { dock: unknown; known: string[] } | undefined {
  if (saved === undefined || saved === null) return undefined;
  const s = saved as Partial<SavedLayout>;
  if (s.v === 2 && Array.isArray(s.known)) return { dock: s.dock, known: s.known.filter((k): k is string => typeof k === 'string') };
  return { dock: saved, known: LEGACY_KNOWN };
}

export const packLayout = (dock: unknown, known: Iterable<string>): SavedLayout => ({ v: 2, dock, known: [...known] });

/** Registered views the layout has never been offered: they get a tab. Views the user closed stay in `known`, so they stay closed. */
export function newViews(registered: readonly string[], known: Iterable<string>): string[] {
  const seen = new Set(known);
  return registered.filter((id) => !seen.has(id));
}
```

- [ ] **Step 4: Write `packages/extension/src/webview/plot/moduleRenderer.ts`**

```ts
import type { Plot, RendererHost, SelectionMsg, ViewRenderer } from '@phy-vscode/api';

type Loader = (url: string) => Promise<unknown>;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A `ViewRenderer` backed by an ES module loaded from `url`. The module exports `mount`, `update` and `dispose`, or a default
 * function returning them. Updates that arrive while it loads are held (the latest wins) and replayed after `mount`.
 * `report` is called with no argument after a replayed update succeeds, and once with a message on any failure.
 */
export function moduleRenderer(url: string, report: (error?: string) => void, load: Loader = (u) => import(/* @vite-ignore */ u)): ViewRenderer {
  let inner: ViewRenderer | undefined;
  let failed = false;
  let disposed = false;
  let held: [unknown, ArrayBuffer[], SelectionMsg] | undefined;
  const fail = (text: string) => {
    failed = true;
    held = undefined;
    report(text);
  };
  return {
    mount(el: HTMLElement, plot: Plot, host: RendererHost) {
      load(url).then(
        (mod) => {
          if (disposed) return;
          const m = mod as { default?: unknown } & Partial<ViewRenderer>;
          const r = (typeof m.default === 'function' ? (m.default as () => Partial<ViewRenderer>)() : m) as Partial<ViewRenderer>;
          if (typeof r.mount !== 'function' || typeof r.update !== 'function' || typeof r.dispose !== 'function') {
            fail(`renderer ${url} must export mount, update and dispose`);
            return;
          }
          inner = r as ViewRenderer;
          try {
            inner.mount(el, plot, host);
            if (held) {
              const h = held;
              held = undefined;
              inner.update(...h);
              report(undefined);
            }
          } catch (e) {
            fail(`render error: ${message(e)}`);
          }
        },
        (e) => {
          if (!disposed) fail(`could not load renderer ${url}: ${message(e)}`);
        },
      );
    },
    update(meta, buffers, selection) {
      if (failed) return;
      if (inner) inner.update(meta, buffers, selection);
      else held = [meta, buffers, selection];
    },
    dispose() {
      disposed = true;
      held = undefined;
      inner?.dispose();
      inner = undefined;
    },
  };
}
```

- [ ] **Step 5: Allow module scripts in the CSP** — `packages/extension/src/host/html.ts`

Change the `csp` line of `webviewHtml` to:

```ts
  const csp = `default-src 'none'; style-src ${o.cspSource} 'unsafe-inline'; img-src ${o.cspSource} data:; script-src ${o.cspSource} 'nonce-${o.nonce}';`;
```
(`cspSource` covers only the webview's `localResourceRoots`: `dist/webview` and the mod renderer folders.)

- [ ] **Step 6: Carry the renderer URI in `init`** — `packages/api/src/protocol.ts`

In `HostToPlot`, change `views: { id: string; title: string }[];` to `views: { id: string; title: string; rendererUri?: string }[];`.

- [ ] **Step 7: Wire `main.ts`** — `packages/extension/src/webview/plot/main.ts`

Imports: add

```ts
import { newViews, packLayout, unpackLayout } from './layout';
import { moduleRenderer } from './moduleRenderer';
```
and change `import type { RendererHost, ViewRenderer } from './renderer';` to stay as is (both types still exported there).

After `let titles = new Map<string, string>();` add:

```ts
let rendererUris = new Map<string, string>();
const known = new Set<string>(); // every view this webview's layout has been offered; closed views stay in it
```

Replace the `saveLocal` line with:

```ts
const saveLocal = () => vscode.setState({ ...local, layout: api && packLayout(api.toJSON(), known) });
```

Add, before `class ViewPanel`:

```ts
function rendererFor(viewId: string): ViewRenderer {
  const builtin = renderers[viewId];
  if (builtin) return builtin();
  const uri = rendererUris.get(viewId);
  return uri ? moduleRenderer(uri, (error) => reportRendered(viewId, error)) : missingRenderer();
}

/** A mod renderer finished after its first `update` returned: say how it went (the host's render log and the header). */
function reportRendered(viewId: string, error?: string): void {
  const slot = slots.get(viewId);
  if (!slot) return;
  if (error) setHeader(slot, error, true);
  post({ type: 'rendered', viewId, seq: slot.lastSeq, error });
}
```

In `ViewPanel.init`, replace `const renderer = (renderers[this.viewId] ?? missingRenderer)();` with `const renderer = rendererFor(this.viewId);`.

Replace the body of `init(m)` from the line `titles = new Map(…)` through the `if (!restored) for (const v of m.views) addView(…)` line with:

```ts
  titles = new Map(m.views.map((v) => [v.id, v.title]));
  rendererUris = new Map(m.views.flatMap((v) => (v.rendererUri ? [[v.id, v.rendererUri] as const] : [])));
  local = { settings: { ...m.settings, ...local.settings }, states: { ...m.states, ...local.states }, layout: local.layout ?? m.layout };
  if (api) return;
  api = createDockview(root, {
    createComponent: () => new ViewPanel(),
    theme: document.body.classList.contains('vscode-light') ? themeLight : themeDark,
  });
  const registered = m.views.map((v) => v.id);
  const saved = unpackLayout(local.layout);
  let restored = false;
  if (saved) {
    try {
      api.fromJSON(saved.dock as SerializedDockview);
      restored = true;
      for (const k of saved.known) known.add(k);
    } catch {
      api.clear();
    }
  }
  if (restored) {
    for (const p of [...api.panels]) if (!registered.includes(p.id)) api.removePanel(p); // a plugin that is gone
    for (const id of newViews(registered, known)) addView(id, DEFAULT_POSITION[id]); // a plugin that is new
  } else {
    for (const id of registered) addView(id, DEFAULT_POSITION[id]);
  }
  for (const id of registered) known.add(id);
```
(The `let timer…` and `api.onDidLayoutChange(…)` block after it is unchanged, except that its `post({ type: 'persist', layout: api!.toJSON() })` becomes `post({ type: 'persist', layout: packLayout(api!.toJSON(), known) })`.)

In the `toggleView` case nothing changes: `addView(m.viewId)` adds it back, and `known` already has it.

- [ ] **Step 8: Run the checks**

Run: `npm test -w packages/extension -- layout moduleRenderer html && npm run typecheck && npm run build`
Expected: PASS; the build prints no esbuild error (`import(url)` with a variable stays a real dynamic import in the IIFE bundle).

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/protocol.ts packages/extension/src packages/extension/test
git commit -m "feat: plot webview loads mod renderer modules and tracks known views"
```

---

### Task 6: Host wiring — registry, `PhyApi` as `exports`, page reload on view changes

Everything on the host side switches from the `builtinViews` constant to the registry.

**Files:**
- Create: `packages/extension/src/host/phyApi.ts`
- Modify: `packages/extension/src/host/plotPanel.ts`, `clusterView.ts`, `editor.ts`, `packages/extension/src/extension.ts`
- Test: `packages/extension/test/phyApi.test.ts`; existing smoke test (run in Task 10)

**Interfaces:**
- Consumes: `ModRegistry`, `Session(dataset, mods)`, `ViewScheduler.viewChanged/reset`, `HostToPlot.init.views[].rendererUri`.
- Produces:
  - `createPhyApi(mods: ModRegistry, host: { activeSession(): PhySession | undefined; onDidOpenSession: Event<PhySession> }): PhyApi`.
  - `DatasetEditorProvider.onDidOpenSession: vscode.Event<Session>`.
  - `EditorContext` and `PanelContext` gain `mods: ModRegistry` and `ready: Promise<void>` (resolves after the first plugin load; the webview's `init` waits for it).
  - `activate()` returns `ExtensionApi extends PhyApi` (adds the test hooks `runView`, `renderLog`).

- [ ] **Step 1: Write the failing test** — `packages/extension/test/phyApi.test.ts`

```ts
import { API_VERSION, type PhySession } from '@phy-vscode/api';
import { expect, it } from 'vitest';
import { Emitter } from '../src/host/emitter';
import { ModRegistry } from '../src/host/modRegistry';
import { createPhyApi } from '../src/host/phyApi';

it('forwards registrations to the registry and exposes the API version', () => {
  const mods = new ModRegistry();
  const opened = new Emitter<PhySession>();
  const api = createPhyApi(mods, { activeSession: () => undefined, onDidOpenSession: opened.event });
  expect(api.version).toBe(API_VERSION);
  expect(api.activeSession()).toBeUndefined();
  const d = api.registerClusterMetric({ id: 'm', label: 'm', compute: () => 1 });
  expect(mods.metrics().map((m) => m.id)).toEqual(['m']);
  d.dispose();
  expect(mods.metrics()).toEqual([]);
  const seen: PhySession[] = [];
  api.onDidOpenSession((s) => seen.push(s));
  opened.fire('S' as never);
  expect(seen).toEqual(['S']);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `npm test -w packages/extension -- phyApi`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `packages/extension/src/host/phyApi.ts`**

```ts
import { API_VERSION, type Event, type PhyApi, type PhySession } from '@phy-vscode/api';
import type { ModRegistry } from './modRegistry';

/** The object mods receive: the extension's `exports`, and (scoped) a plugin's `activate` argument. */
export function createPhyApi(mods: ModRegistry, host: { activeSession(): PhySession | undefined; onDidOpenSession: Event<PhySession> }): PhyApi {
  return {
    version: API_VERSION,
    activeSession: () => host.activeSession(),
    onDidOpenSession: host.onDidOpenSession,
    registerView: (def) => mods.registerView(def),
    registerClusterMetric: (def) => mods.registerClusterMetric(def),
    registerHistogram: (def) => mods.registerHistogram(def),
  };
}
```

- [ ] **Step 4: Rewrite `packages/extension/src/host/plotPanel.ts`**

Replace the whole file with the following. Compared with the old one, it has new imports, `PanelContext` gains `mods` and `ready`, and `PlotPanel` is rewritten; `Persisted`, `persistKey`, `loadPersisted`, `savePersisted`, `selectionMsg` and `RenderEntry` are unchanged.

```ts
import { dirname } from 'node:path';
import * as vscode from 'vscode';
import type { HostToPlot, PlotToHost, SelectionMsg, TableState } from '@phy-vscode/api';
import type { Compute } from '../compute';
import { nonce, webviewHtml } from './html';
import type { ModRegistry, RegistryChange } from './modRegistry';
import type { Session } from './session';
import { ViewScheduler } from './viewScheduler';

/** Per-dataset UI state in workspaceState (spec §4 Persistence). */
export interface Persisted {
  layout?: unknown;
  settings: Record<string, Record<string, unknown>>;
  states: Record<string, unknown>;
  table?: TableState;
}
export const persistKey = (paramsPath: string): string => `phyVscode:${paramsPath}`;
export const loadPersisted = (state: vscode.Memento, paramsPath: string): Persisted => ({
  settings: {},
  states: {},
  ...state.get<Persisted>(persistKey(paramsPath)),
});
export const savePersisted = (state: vscode.Memento, paramsPath: string, patch: Partial<Persisted>): void => {
  void state.update(persistKey(paramsPath), { ...loadPersisted(state, paramsPath), ...patch });
};

export const selectionMsg = (s: Session): SelectionMsg => ({ ids: [...s.selection], colors: s.selection.map((id) => s.colorOf(id)) });

export interface PanelContext {
  extensionUri: vscode.Uri;
  state: vscode.Memento;
  compute: Compute;
  mods: ModRegistry;
  /** Resolves once the first plugin load finished, so the webview starts with every plugin's views. */
  ready: Promise<void>;
}
export interface RenderEntry {
  viewId: string;
  seq: number;
  error?: string;
}

/** Host side of the dataset editor's plot webview. */
export class PlotPanel implements vscode.Disposable {
  readonly renderLog: RenderEntry[] = [];
  private readonly scheduler: ViewScheduler;
  private readonly subs: vscode.Disposable[] = [];
  /** The view list the webview was last initialised with (JSON); undefined until it asks. */
  private shown: string | undefined;

  constructor(private readonly panel: vscode.WebviewPanel, private readonly session: Session, private readonly ctx: PanelContext) {
    this.scheduler = new ViewScheduler(
      (viewId, settings, token) => {
        const view = ctx.mods.view(viewId);
        if (!view) return Promise.reject(new Error(`unknown view ${viewId}`));
        return view.provider({ session, compute: ctx.compute, settings }, token);
      },
      (m) => this.post(m),
      () => selectionMsg(session),
      loadPersisted(ctx.state, session.dataset.paramsPath).settings,
    );
    this.load();
    this.subs.push(
      session.onDidChangeSelection(() => this.scheduler.selectionChanged()),
      panel.webview.onDidReceiveMessage((m: PlotToHost) => this.onMessage(m)),
      ctx.mods.onDidChange((c) => this.onModsChanged(c)),
    );
  }

  toggleView(viewId: string): void {
    this.post({ type: 'toggleView', viewId });
  }

  /** The webview may read dist/webview and the folder of every mod renderer. */
  private setRoots(): void {
    const dirs = new Set(this.ctx.mods.views().flatMap((v) => (v.rendererScript ? [dirname(v.rendererScript.fsPath)] : [])));
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview'), ...[...dirs].map((d) => vscode.Uri.file(d))],
    };
  }

  /** (Re)load the page. */
  private load(): void {
    const webview = this.panel.webview;
    this.setRoots();
    webview.html = webviewHtml({
      cspSource: webview.cspSource,
      nonce: nonce(),
      title: 'Phy',
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview', 'plot.js')).toString(),
    });
  }

  private views(): { id: string; title: string; rendererUri?: string }[] {
    return this.ctx.mods.views().map((v) => ({
      id: v.id,
      title: v.title,
      ...(v.rendererScript
        ? { rendererUri: this.panel.webview.asWebviewUri(vscode.Uri.file(v.rendererScript.fsPath)).with({ query: `v=${v.generation}` }).toString() }
        : {}),
    }));
  }

  private onModsChanged(c: RegistryChange): void {
    if (c.views) {
      this.setRoots();
      if (this.shown !== undefined && this.shown !== JSON.stringify(this.views())) {
        // The view list or a renderer changed under a live page: start it afresh. Layout, settings and selection come back from state.
        this.shown = undefined;
        this.scheduler.reset();
        this.load();
        return;
      }
    }
    if (c.histograms) this.scheduler.viewChanged('cluster_statistics');
  }

  private post(m: HostToPlot): void {
    void this.panel.webview.postMessage(m);
  }

  private onMessage(m: PlotToHost): void {
    const { state } = this.ctx;
    const paramsPath = this.session.dataset.paramsPath;
    switch (m.type) {
      case 'ready':
        void this.ctx.ready.then(() => {
          const saved = loadPersisted(state, paramsPath);
          const views = this.views();
          this.shown = JSON.stringify(views);
          this.post({ type: 'init', views, layout: saved.layout, settings: saved.settings, states: saved.states });
        });
        break;
      case 'visible':
        this.scheduler.setVisible(m.viewIds);
        break;
      case 'viewEvent': {
        const saved = loadPersisted(state, paramsPath);
        if (m.payload.kind === 'settings') {
          this.scheduler.setSettings(m.viewId, m.payload.settings);
          savePersisted(state, paramsPath, { settings: { ...saved.settings, [m.viewId]: this.scheduler.settingsOf(m.viewId) } });
        } else {
          savePersisted(state, paramsPath, { states: { ...saved.states, [m.viewId]: m.payload.state } });
        }
        break;
      }
      case 'persist':
        savePersisted(state, paramsPath, { layout: m.layout });
        break;
      case 'rendered':
        this.renderLog.push({ viewId: m.viewId, seq: m.seq, error: m.error });
        break;
    }
  }

  dispose(): void {
    this.scheduler.dispose();
    for (const s of this.subs) s.dispose();
  }
}
```

- [ ] **Step 5: `editor.ts`** — `packages/extension/src/host/editor.ts`

Add the import `import type { ModRegistry } from './modRegistry';`. Extend the context:

```ts
export interface EditorContext {
  storage: vscode.Uri;
  extensionUri: vscode.Uri;
  state: vscode.Memento;
  compute: Compute;
  mods: ModRegistry;
  ready: Promise<void>;
}
```
In `DatasetEditorProvider` add next to `onDidChangeActiveSession`:

```ts
  private readonly openEmitter = new vscode.EventEmitter<Session>();
  readonly onDidOpenSession = this.openEmitter.event;
```
and replace the line `return new DatasetDocument(uri, new Session(dataset), undefined);` with:

```ts
        const session = new Session(dataset, {
          metrics: () => this.ctx.mods.metrics(),
          warn: (m) => void vscode.window.showWarningMessage(`Phy: ${m}`),
        });
        this.openEmitter.fire(session);
        return new DatasetDocument(uri, session, undefined);
```
(`new PlotPanel(panel, session, this.ctx)` already passes `this.ctx`, which now satisfies `PanelContext`.)

- [ ] **Step 6: `clusterView.ts`** — `packages/extension/src/host/clusterView.ts`

Add `import type { ModRegistry } from './modRegistry';`. Change the constructor and add a subscription:

```ts
  private readonly modSub: vscode.Disposable;

  constructor(private readonly ctx: { extensionUri: vscode.Uri; state: vscode.Memento; mods: ModRegistry }) {
    this.modSub = ctx.mods.onDidChange((c) => {
      if (c.metrics && this.session) this.push();
    });
  }
```
In `push()`, change the `clusterTable` post to include the labels:

```ts
    this.post({ type: 'clusterTable', columns: s.clusters.columns, rows: s.clusters.rows, labels: s.metricLabels(), info: datasetInfo(s), state });
```
and in `dispose()` add `this.modSub.dispose();`.

- [ ] **Step 7: Rewrite `packages/extension/src/extension.ts`**

```ts
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { PhyApi, ViewResult } from '@phy-vscode/api';
import { ClusterViewProvider } from './host/clusterView';
import { DatasetEditorProvider } from './host/editor';
import { ModRegistry } from './host/modRegistry';
import { createPhyApi } from './host/phyApi';
import type { RenderEntry } from './host/plotPanel';
import { WorkerPool } from './host/workerPool';

/** What `activate` returns: the public `PhyApi` for mods, plus test hooks the smoke test uses (not part of the API). */
export interface ExtensionApi extends PhyApi {
  runView(id: string, settings?: Record<string, unknown>): Promise<ViewResult>;
  renderLog(): readonly RenderEntry[];
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const pool = new WorkerPool(join(context.extensionPath, 'dist', 'worker.cjs'));
  const mods = new ModRegistry();
  let pluginsLoaded!: () => void;
  const ready = new Promise<void>((resolve) => (pluginsLoaded = resolve));
  const editor = new DatasetEditorProvider({ storage: context.globalStorageUri, extensionUri: context.extensionUri, state: context.workspaceState, compute: pool, mods, ready });
  const clusters = new ClusterViewProvider({ extensionUri: context.extensionUri, state: context.workspaceState, mods });
  const api = createPhyApi(mods, { activeSession: () => editor.activeSession, onDidOpenSession: editor.onDidOpenSession });
  context.subscriptions.push(
    clusters,
    vscode.window.registerWebviewViewProvider('phyVscode.clusters', clusters),
    editor.onDidChangeActiveSession((s) => clusters.setSession(s)),
    vscode.commands.registerCommand('phy.selectNext', () => clusters.step(1)),
    vscode.commands.registerCommand('phy.selectPrevious', () => clusters.step(-1)),
  );
  context.subscriptions.push(
    { dispose: () => void pool.dispose() },
    vscode.window.registerCustomEditorProvider('phyVscode.dataset', editor, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('phy.openDataset', async (uri?: vscode.Uri) => {
      const target = uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Open Phy Dataset' }))?.[0];
      if (!target) return;
      const params = target.path.endsWith('/params.py') ? target : vscode.Uri.joinPath(target, 'params.py');
      await vscode.commands.executeCommand('vscode.openWith', params, 'phyVscode.dataset');
    }),
    vscode.commands.registerCommand('phy.view.toggle', async (viewId?: string) => {
      const id = viewId ?? (await vscode.window.showQuickPick(mods.views().map((v) => ({ label: v.title, id: v.id })), { placeHolder: 'Show or hide a view' }))?.id;
      if (id) editor.activePanel?.toggleView(id);
    }),
  );
  pluginsLoaded(); // Task 9 loads the plugins first
  return {
    ...api,
    renderLog: () => editor.activePanel?.renderLog ?? [],
    runView: (id, settings = {}) => {
      const session = editor.activeSession;
      const view = mods.view(id);
      if (!session) return Promise.reject(new Error('no active phy dataset'));
      if (!view) return Promise.reject(new Error(`unknown view ${id}`));
      return view.provider({ session, compute: pool, settings }, { isCancellationRequested: false });
    },
  };
}

export function deactivate(): void {}
```

- [ ] **Step 8: Run the checks**

Run: `npm test -w packages/extension -- phyApi && npm run typecheck && npm test && npm run test:smoke -w packages/extension`
Expected: all PASS. The existing smoke test (first run downloads VS Code into `.vscode-test/`) still opens `base`, `noraw` and `minimal` and renders all five views.

- [ ] **Step 9: Commit**

```bash
git add packages/extension/src packages/extension/test/phyApi.test.ts
git commit -m "feat: host uses the ModRegistry; activate returns PhyApi; reload the page when views change"
```

---

### Task 7: Plugin host

**Files:**
- Create: `packages/extension/src/host/plugins.ts`
- Test: `packages/extension/test/plugins.test.ts`

**Interfaces:**
- Consumes: `PhyApi`, `satisfiesApi`, `API_VERSION`.
- Produces:
  - `pluginRoots(setting: unknown, home: string, log: PluginLog): string[]`: the default `<home>/.phy-vscode/plugins` first, then the setting's absolute or `~/` paths.
  - `discoverPlugins(roots: readonly string[], log: PluginLog): DiscoveredPlugin[]`.
  - `interface DiscoveredPlugin { file: string; scope: string }`. `scope` is the file itself, or the plugin's folder for `<root>/<dir>/index.js`.
  - `requireLoader(req: NodeJS.Require): PluginLoader`.
  - `class PluginHost { constructor(deps: PluginHostDeps); load(): Promise<LoadReport>; reload(): Promise<LoadReport>; dispose(): void }`.
  - `interface LoadReport { loaded: number; problems: string[] }`.
  - `type PluginLog = (message: string) => void`.

- [ ] **Step 1: Write the failing tests** — `packages/extension/test/plugins.test.ts`

```ts
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_VERSION, type PhySession } from '@phy-vscode/api';
import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/host/emitter';
import { ModRegistry, type RegistryChange } from '../src/host/modRegistry';
import { createPhyApi } from '../src/host/phyApi';
import { discoverPlugins, PluginHost, pluginRoots, requireLoader } from '../src/host/plugins';

const write = (file: string, body: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
};
const metricPlugin = (id: string) => `exports.activate = (api) => { api.registerClusterMetric({ id: '${id}', label: '${id}', compute: () => 1 }); };`;

const tmpDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'phy-plugins-'))); // real path: the module cache is keyed by it

function setup() {
  const dir = tmpDir();
  const mods = new ModRegistry();
  const api = createPhyApi(mods, { activeSession: () => undefined, onDidOpenSession: new Emitter<PhySession>().event });
  const log = vi.fn();
  const host = new PluginHost({ api, loader: requireLoader(createRequire(import.meta.url)), roots: () => [dir], log, hold: () => mods.hold() });
  const ids = () => mods.metrics().map((m) => m.id);
  return { dir, mods, host, log, ids };
}

describe('PluginHost', () => {
  it('loads top-level .js files and folder plugins (index.js), in name order, and nothing else', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'b.js'), metricPlugin('b'));
    write(join(dir, 'a.js'), metricPlugin('a'));
    write(join(dir, 'folder', 'index.js'), metricPlugin('c'));
    write(join(dir, 'folder', 'other.js'), 'throw new Error("must not be loaded")');
    write(join(dir, 'node_modules', 'x', 'index.js'), 'throw new Error("must not be loaded")');
    write(join(dir, '.hidden.js'), 'throw new Error("must not be loaded")');
    write(join(dir, 'notes.txt'), 'not js');
    expect(await host.load()).toEqual({ loaded: 3, problems: [] });
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('skips a file without activate(), quietly', async () => {
    const { dir, host, log } = setup();
    write(join(dir, 'lib.js'), 'exports.x = 1;');
    expect(await host.load()).toEqual({ loaded: 0, problems: [] });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/lib\.js: no activate\(\) export/));
  });

  it('refuses a plugin that needs another API version, and accepts a compatible one', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'old.js'), `exports.apiVersion = '^9.0.0'; ${metricPlugin('old')}`);
    write(join(dir, 'ok.js'), `exports.apiVersion = '^${API_VERSION}'; ${metricPlugin('ok')}`);
    const r = await host.load();
    expect(r.loaded).toBe(1);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/old\.js: needs API \^9\.0\.0, this phy-vscode has /);
    expect(ids()).toEqual(['ok']);
  });

  it('isolates a failing plugin and undoes its partial registrations', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'bad.js'), `exports.activate = (api) => { api.registerClusterMetric({ id: 'half', label: 'h', compute: () => 1 }); throw new Error('boom'); };`);
    write(join(dir, 'broken.js'), 'this is not javascript');
    write(join(dir, 'good.js'), metricPlugin('good'));
    const r = await host.load();
    expect(r.loaded).toBe(1);
    expect(r.problems.map((p) => p.replace(dir, ''))).toEqual([expect.stringMatching(/bad\.js: boom/), expect.stringMatching(/broken\.js: /)]);
    expect(ids()).toEqual(['good']);
  });

  it('awaits an async activate and disposes what it returns on unload', async () => {
    const { dir, host, mods } = setup();
    write(join(dir, 'a.js'), `exports.activate = async (api) => { await null; api.registerHistogram({ id: 'h', label: 'h', compute: () => new Float64Array(1) }); return { dispose() { globalThis.__phyDisposed = true; } }; };`);
    await host.load();
    expect(mods.histograms().some((h) => h.id === 'h')).toBe(true);
    await host.reload();
    expect((globalThis as { __phyDisposed?: boolean }).__phyDisposed).toBe(true);
  });

  it('reload picks up edited plugin and sibling files, drops the old registrations, and emits one change', async () => {
    const { dir, host, mods, ids } = setup();
    write(join(dir, 'p', 'helper.js'), `exports.id = 'v1';`);
    write(join(dir, 'p', 'index.js'), `const h = require('./helper'); exports.activate = (api) => { api.registerClusterMetric({ id: h.id, label: 'x', compute: () => 1 }); };`);
    await host.load();
    expect(ids()).toEqual(['v1']);
    write(join(dir, 'p', 'helper.js'), `exports.id = 'v2';`);
    const events: RegistryChange[] = [];
    mods.onDidChange((c) => events.push(c));
    expect((await host.reload()).loaded).toBe(1);
    expect(ids()).toEqual(['v2']);
    expect(events).toEqual([{ views: false, metrics: true, histograms: false }]);
  });

  it('calls deactivate on unload', async () => {
    const { dir, host } = setup();
    write(join(dir, 'a.js'), `${metricPlugin('a')} exports.deactivate = () => { globalThis.__phyDeactivated = (globalThis.__phyDeactivated ?? 0) + 1; };`);
    await host.load();
    await host.reload();
    expect((globalThis as { __phyDeactivated?: number }).__phyDeactivated).toBeGreaterThanOrEqual(1);
  });

  it('tracks onDidOpenSession listeners too', async () => {
    const { dir, host } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { api.onDidOpenSession(() => {}); };`);
    expect((await host.load()).loaded).toBe(1);
    await host.reload();
  });
});

describe('discoverPlugins and pluginRoots', () => {
  it('logs a missing path instead of throwing, and accepts a single file as a root', () => {
    const dir = tmpDir();
    write(join(dir, 'one.js'), metricPlugin('one'));
    const log = vi.fn();
    const found = discoverPlugins([join(dir, 'missing'), join(dir, 'one.js')], log);
    expect(found).toEqual([{ file: join(dir, 'one.js'), scope: join(dir, 'one.js') }]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/plugin path not found: .*missing/));
  });

  it('uses the default folder, expands ~/, and ignores relative or non-string entries', () => {
    const log = vi.fn();
    expect(pluginRoots(['~/mine', '/abs/other', 'relative/dir', 5, '', '/abs/other'], '/home/u', log)).toEqual([
      '/home/u/.phy-vscode/plugins',
      '/home/u/mine',
      '/abs/other',
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/'relative\/dir' ignored/));
    expect(pluginRoots(undefined, '/home/u', log)).toEqual(['/home/u/.phy-vscode/plugins']);
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `npm test -w packages/extension -- plugins`
Expected: FAIL (module `../src/host/plugins` not found).

- [ ] **Step 3: Write `packages/extension/src/host/plugins.ts`**

```ts
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { API_VERSION, satisfiesApi, type Disposable, type PhyApi } from '@phy-vscode/api';

export type PluginLog = (message: string) => void;

/** What a plugin file exports. */
export interface PluginModule {
  /** Caret or exact range of `@phy-vscode/api` this plugin was written for, e.g. `^0.2.0`. Checked at load. */
  apiVersion?: string;
  activate(api: PhyApi): unknown;
  deactivate?(): unknown;
}
export interface DiscoveredPlugin {
  file: string;
  /** What reloading clears from the module cache: the file itself, or a folder plugin's whole folder. */
  scope: string;
}
export interface PluginLoader {
  load(file: string): unknown;
  /** Forget the modules at (or under) these paths, so the next `load` re-reads them. */
  unload(scopes: readonly string[]): void;
}
export interface LoadReport {
  loaded: number;
  problems: string[];
}

/** Node's `require`, with the module cache cleared only under a plugin's own scope. */
export function requireLoader(req: NodeJS.Require): PluginLoader {
  return {
    load: (file) => req(file),
    unload(scopes) {
      for (const key of Object.keys(req.cache)) if (scopes.some((s) => key === s || key.startsWith(s + sep))) delete req.cache[key];
    },
  };
}

/** `<home>/.phy-vscode/plugins`, then the `phyVscode.pluginPaths` entries that are absolute or start with `~/`. */
export function pluginRoots(setting: unknown, home: string, log: PluginLog): string[] {
  const roots = [join(home, '.phy-vscode', 'plugins')];
  for (const p of Array.isArray(setting) ? setting : []) {
    if (typeof p !== 'string' || !p.trim()) continue;
    const full = p === '~' || p.startsWith('~/') ? join(home, p.slice(1)) : p;
    if (!isAbsolute(full)) {
      log(`phyVscode.pluginPaths: '${p}' ignored, plugin paths must be absolute or start with ~/`);
      continue;
    }
    roots.push(resolve(full));
  }
  return [...new Set(roots)];
}

/**
 * A root that is a file is one plugin. A root that is a folder contributes its top-level `*.js` files and each subfolder that has an
 * `index.js`; dot-entries and `node_modules` are skipped. Plugins are never looked for inside dataset folders.
 * Paths are returned as real paths, because Node's module cache is keyed by them (on macOS `/var` is a symlink to `/private/var`).
 */
export function discoverPlugins(roots: readonly string[], log: PluginLog): DiscoveredPlugin[] {
  const found: DiscoveredPlugin[] = [];
  for (const root of roots) {
    const st = statSync(root, { throwIfNoEntry: false });
    if (!st) {
      log(`plugin path not found: ${root}`);
      continue;
    }
    if (st.isFile()) {
      const file = realpathSync(root);
      found.push({ file, scope: file });
      continue;
    }
    for (const name of readdirSync(root).sort()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const p = join(root, name);
      const e = statSync(p, { throwIfNoEntry: false });
      if (e?.isFile() && name.endsWith('.js')) {
        const file = realpathSync(p);
        found.push({ file, scope: file });
      } else if (e?.isDirectory() && existsSync(join(p, 'index.js'))) found.push({ file: realpathSync(join(p, 'index.js')), scope: realpathSync(p) });
    }
  }
  return found;
}

export interface PluginHostDeps {
  api: PhyApi;
  loader: PluginLoader;
  roots(): string[];
  log: PluginLog;
  /** Defer the registry's change events until the returned function is called, so a reload refreshes webviews once. */
  hold(): () => void;
}

const isDisposable = (x: unknown): x is Disposable => typeof (x as Disposable | undefined)?.dispose === 'function';
const tryDispose = (d: Disposable): void => {
  try {
    d.dispose();
  } catch {
    // a failing dispose must not stop the rest being undone
  }
};
const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A copy of `api` that remembers everything a plugin registers, so it can be undone. */
function scoped(api: PhyApi, subs: Disposable[]): PhyApi {
  const track = (d: Disposable): Disposable => (subs.push(d), d);
  return {
    ...api,
    onDidOpenSession: (l) => track(api.onDidOpenSession(l)),
    registerView: (d) => track(api.registerView(d)),
    registerClusterMetric: (d) => track(api.registerClusterMetric(d)),
    registerHistogram: (d) => track(api.registerHistogram(d)),
  };
}

export class PluginHost {
  private active: { file: string; scope: string; plugin: PluginModule; subs: Disposable[] }[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PluginHostDeps) {}

  load(): Promise<LoadReport> {
    return this.enqueue(() => this.loadNow());
  }

  /** Unload every plugin, forget its modules, load again. The registry emits one merged change event. */
  reload(): Promise<LoadReport> {
    return this.enqueue(async () => {
      const release = this.deps.hold();
      try {
        await this.unloadNow();
        return await this.loadNow();
      } finally {
        release();
      }
    });
  }

  dispose(): void {
    void this.enqueue(() => this.unloadNow());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ponytail: an activate() that never settles stalls loading; add a timeout if a plugin ever does.
  private async loadNow(): Promise<LoadReport> {
    const { loader, log } = this.deps;
    const problems: string[] = [];
    const fail = (m: string) => {
      problems.push(m);
      log(m);
    };
    let loaded = 0;
    for (const { file, scope } of discoverPlugins(this.deps.roots(), log)) {
      const subs: Disposable[] = [];
      try {
        const exported = loader.load(file) as ({ default?: unknown } & Partial<PluginModule>) | undefined;
        const plugin = (typeof exported?.activate === 'function' ? exported : exported?.default) as Partial<PluginModule> | undefined;
        if (typeof plugin?.activate !== 'function') {
          log(`${file}: no activate() export, skipped`);
          continue;
        }
        if (plugin.apiVersion !== undefined && !satisfiesApi(plugin.apiVersion)) {
          fail(`${file}: needs API ${plugin.apiVersion}, this phy-vscode has ${API_VERSION}`);
          continue;
        }
        const returned = await plugin.activate(scoped(this.deps.api, subs));
        if (isDisposable(returned)) subs.push(returned);
        this.active.push({ file, scope, plugin: plugin as PluginModule, subs });
        loaded++;
        log(`${file}: loaded`);
      } catch (e) {
        for (const s of subs.reverse()) tryDispose(s);
        fail(`${file}: ${text(e)}`);
      }
    }
    return { loaded, problems };
  }

  private async unloadNow(): Promise<void> {
    const { log, loader } = this.deps;
    const active = this.active.reverse();
    this.active = [];
    for (const { file, plugin, subs } of active) {
      try {
        await plugin.deactivate?.();
      } catch (e) {
        log(`${file}: deactivate failed: ${text(e)}`);
      }
      for (const s of subs.reverse()) tryDispose(s);
    }
    loader.unload(active.map((a) => a.scope));
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w packages/extension -- plugins && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/plugins.ts packages/extension/test/plugins.test.ts
git commit -m "feat: plugin host with scoped API, isolation and reload"
```

---

### Task 8: Plugin scaffold and template

**Files:**
- Create: `packages/extension/src/host/scaffold.ts`
- Create: `packages/extension/templates/plugin/package.json`, `tsconfig.json`, `build.mjs`, `README.md`, `src/index.ts`, `src/renderer.ts`
- Test: `packages/extension/test/scaffold.test.ts`

**Interfaces:**
- Produces:
  - `PLUGIN_NAME: RegExp`.
  - `scaffoldPlugin(o: { templateDir: string; apiSrcDir: string; target: string; name: string }): string[]`: copies the template, fills `__NAME__`, copies the API sources as `api/`, and returns the created file paths.

- [ ] **Step 1: Write the failing test** — `packages/extension/test/scaffold.test.ts`

```ts
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_VERSION, type PhySession } from '@phy-vscode/api';
import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/host/emitter';
import { ModRegistry } from '../src/host/modRegistry';
import { createPhyApi } from '../src/host/phyApi';
import { PluginHost, requireLoader } from '../src/host/plugins';
import { scaffoldPlugin } from '../src/host/scaffold';

const templateDir = fileURLToPath(new URL('../templates/plugin', import.meta.url));
const apiSrcDir = fileURLToPath(new URL('../../api/src', import.meta.url));
const repoModules = fileURLToPath(new URL('../../../node_modules', import.meta.url));
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'phy-scaffold-'))); // real path: plugins report real paths

describe('scaffoldPlugin', () => {
  it('rejects a bad name and a non-empty target', () => {
    const base = tmp();
    expect(() => scaffoldPlugin({ templateDir, apiSrcDir, target: join(base, 'x'), name: 'Bad Name' })).toThrow(/plugin name must match/);
    mkdirSync(join(base, 'full'));
    writeFileSync(join(base, 'full', 'f.txt'), 'x');
    expect(() => scaffoldPlugin({ templateDir, apiSrcDir, target: join(base, 'full'), name: 'ok' })).toThrow(/not empty/);
  });

  it('writes a plugin that typechecks, builds, and loads against the real API', { timeout: 120_000 }, async () => {
    const parent = tmp();
    const target = join(parent, 'my-plugin');
    const files = scaffoldPlugin({ templateDir, apiSrcDir, target, name: 'my-plugin' });
    const rel = files.map((f) => relative(target, f));
    expect(rel).toEqual(expect.arrayContaining(['package.json', 'build.mjs', 'tsconfig.json', join('src', 'index.ts'), join('src', 'renderer.ts'), join('api', 'index.ts')]));
    expect(readFileSync(join(target, 'package.json'), 'utf8')).toContain('"name": "my-plugin"');
    expect(files.some((f) => readFileSync(f, 'utf8').includes('__NAME__'))).toBe(false);

    symlinkSync(repoModules, join(target, 'node_modules')); // stands in for `npm install`
    execFileSync(join(target, 'node_modules', '.bin', 'tsc'), ['-p', target], { stdio: 'pipe' }); // throws, with the diagnostics, on a type error
    execFileSync(process.execPath, ['build.mjs'], { cwd: target, stdio: 'pipe' });
    expect(readFileSync(join(target, 'renderer.js'), 'utf8')).toMatch(/export\s*\{/);

    const mods = new ModRegistry();
    const api = createPhyApi(mods, { activeSession: () => undefined, onDidOpenSession: new Emitter<PhySession>().event });
    const host = new PluginHost({ api, loader: requireLoader(createRequire(import.meta.url)), roots: () => [parent], log: vi.fn(), hold: () => mods.hold() });
    expect(await host.load()).toEqual({ loaded: 1, problems: [] });
    expect(mods.metrics().map((m) => m.id)).toEqual(['spike_share']);
    expect(mods.histograms().map((h) => h.id)).toContain('spikes_over_time');
    const v = mods.view('spike_counts')!;
    expect(dirname(v.rendererScript!.fsPath)).toBe(target);
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toContain(API_VERSION);
    host.dispose();
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `npm test -w packages/extension -- scaffold`
Expected: FAIL (module `../src/host/scaffold` not found).

- [ ] **Step 3: Write `packages/extension/src/host/scaffold.ts`**

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLUGIN_NAME = /^[a-z][a-z0-9-]{0,40}$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Copy the plugin template to `target` (which must not exist or be empty), fill in `__NAME__`, and add the API sources as `api/`
 * (they are plain TypeScript, so the plugin type-checks and bundles against them with no published package). Returns the files created.
 */
export function scaffoldPlugin(o: { templateDir: string; apiSrcDir: string; target: string; name: string }): string[] {
  if (!PLUGIN_NAME.test(o.name)) throw new Error(`plugin name must match ${PLUGIN_NAME}`);
  if (existsSync(o.target) && readdirSync(o.target).length) throw new Error(`${o.target} already exists and is not empty`);
  mkdirSync(o.target, { recursive: true });
  cpSync(o.templateDir, o.target, { recursive: true });
  const files = walk(o.target);
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    if (s.includes('__NAME__')) writeFileSync(f, s.replaceAll('__NAME__', o.name));
  }
  cpSync(o.apiSrcDir, join(o.target, 'api'), { recursive: true });
  return [...files, ...walk(join(o.target, 'api'))];
}
```

- [ ] **Step 4: Write the template files** under `packages/extension/templates/plugin/`

`package.json`:
```json
{
  "name": "__NAME__",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "esbuild": "^0.28.2",
    "typescript": "^7.0.2"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "paths": { "@phy-vscode/api": ["./api/index.ts"] }
  },
  "include": ["src"]
}
```

`build.mjs`:
```js
import { context } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, logLevel: 'info' };

const builds = await Promise.all([
  // Runs in the VS Code extension host: registers the view, metric and histogram.
  context({ ...common, entryPoints: ['src/index.ts'], outfile: 'index.js', platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }),
  // Runs in the Phy plot webview: draws the view. One self-contained file; only its folder is served.
  context({ ...common, entryPoints: ['src/renderer.ts'], outfile: 'renderer.js', platform: 'browser', format: 'esm', target: 'es2022' }),
]);
for (const b of builds) {
  if (watch) await b.watch();
  else {
    await b.rebuild();
    await b.dispose();
  }
}
```

`README.md`:
```md
# __NAME__

A phy-vscode plugin. It adds a cluster-table column, a Cluster statistics histogram and a plot view.

    npm install
    npm run build        # writes index.js (host) and renderer.js (webview)

Then run **Phy: Reload Plugins** in VS Code. Keep this folder under `~/.phy-vscode/plugins/`, or add its parent to the
`phyVscode.pluginPaths` setting. `npm run watch` rebuilds on save.

`src/index.ts` runs in the extension host. `src/renderer.ts` runs in the plot webview. Details: docs/mods.md in the phy-vscode repo.
```

`src/index.ts`:
```ts
import { join } from 'node:path';
import type { PhyApi } from '@phy-vscode/api';

/** Refused at load if this phy-vscode's API is not compatible. */
export const apiVersion = '^0.2.0';

export function activate(api: PhyApi): void {
  // A column in the Clusters table. Return a number or a string; anything else leaves the cell empty.
  api.registerClusterMetric({
    id: 'spike_share',
    label: 'Share of all spikes',
    compute: (clusterId, { session }) => session.spikesOf(clusterId).length / session.dataset.nSpikes,
  });

  // A panel in the Cluster statistics view: counts of this cluster's spikes in 20 equal slices of the recording.
  const BINS = 20;
  api.registerHistogram({
    id: 'spikes_over_time',
    label: 'Spikes over time',
    unit: 's',
    range: ({ session }) => [0, session.dataset.duration],
    compute(spikeIds, { session }) {
      const { spikeTimes, sampleRate, duration } = session.dataset;
      const h = new Float64Array(BINS);
      for (const i of spikeIds) h[Math.min(BINS - 1, Math.floor((spikeTimes[i] / sampleRate / duration) * BINS))]++;
      return h;
    },
  });

  // A whole new view. The provider runs here and its result goes to renderer.js in the webview.
  api.registerView({
    id: 'spike_counts',
    title: 'Spike counts',
    rendererScript: { fsPath: join(__dirname, 'renderer.js') },
    async provider({ session }) {
      const counts = Float32Array.from(session.selection, (id) => session.spikesOf(id).length);
      return { meta: {}, buffers: [counts.buffer] };
    },
  });
}
```

`src/renderer.ts`:
```ts
import { colorOf, emptyScene, type Plot, type RendererHost, type SelectionMsg } from '@phy-vscode/api';

let plot: Plot | undefined;

export function mount(_el: HTMLElement, p: Plot, _host: RendererHost): void {
  plot = p;
}

export function update(_meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg): void {
  const counts = new Float32Array(buffers[0] ?? new ArrayBuffer(0));
  if (!plot) return;
  if (counts.length === 0) {
    plot.setScene(emptyScene('Select a cluster'));
    return;
  }
  plot.setScene({
    rows: 1,
    cols: 1,
    panels: [
      {
        row: 0,
        col: 0,
        title: 'Spikes per selected cluster',
        x: { min: 0, max: counts.length },
        y: { min: 0, max: Math.max(...counts) * 1.05 || 1 },
        layers: Array.from(counts, (c, i) => ({ kind: 'bars' as const, x0: i + 0.1, dx: 0.8, heights: Float32Array.of(c), color: colorOf(selection, selection.ids[i]) })),
      },
    ],
  });
}

export function dispose(): void {
  plot = undefined;
}
```

- [ ] **Step 5: Run the test**

Run: `npm test -w packages/extension -- scaffold`
Expected: PASS (it runs `tsc` and `esbuild` in a temp copy; allow up to a minute). If `tsc` reports an error in `api/*.ts` under the plugin's settings, fix the template's `tsconfig.json`, not the API.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/host/scaffold.ts packages/extension/templates packages/extension/test/scaffold.test.ts
git commit -m "feat: plugin scaffold with a buildable template"
```

---

### Task 9: Commands, setting and packaging

Plug the plugin host and the scaffold into VS Code.

**Files:**
- Modify: `packages/extension/package.json`, `packages/extension/esbuild.mjs`, `packages/extension/.vscodeignore`, `packages/extension/src/extension.ts`

**Interfaces:**
- Consumes: `PluginHost`, `pluginRoots`, `requireLoader`, `scaffoldPlugin`, `PLUGIN_NAME`.
- Produces:
  - Commands `phy.reloadPlugins` (returns `LoadReport`) and `phy.newPlugin`.
  - Setting `phyVscode.pluginPaths` (machine scope).
  - `dist/plugin-template/files` (the template) and `dist/plugin-template/api` (the API sources) in the build and the `.vsix`.

- [ ] **Step 1: `package.json`** — `packages/extension/package.json`

In `contributes.commands` append:
```json
      {
        "command": "phy.reloadPlugins",
        "title": "Phy: Reload Plugins"
      },
      {
        "command": "phy.newPlugin",
        "title": "Phy: New Plugin…"
      }
```
and add a sibling of `commands` inside `contributes`:
```json
    "configuration": {
      "title": "phy-vscode",
      "properties": {
        "phyVscode.pluginPaths": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "scope": "machine",
          "markdownDescription": "Extra plugin files or folders to load, besides `~/.phy-vscode/plugins`. Absolute paths or `~/…`. Plugins run with full access to this machine, so this setting is machine-wide and a workspace cannot set it. Run **Phy: Reload Plugins** after changing it."
        }
      }
    },
```

- [ ] **Step 2: Build copies** — `packages/extension/esbuild.mjs`

Add at the top `import { cpSync, rmSync } from 'node:fs';` and, after the `await Promise.all([...])` call:

```js
// The files `Phy: New Plugin` copies: the plugin template and the API sources (plain TypeScript).
rmSync('dist/plugin-template', { recursive: true, force: true });
cpSync('templates/plugin', 'dist/plugin-template/files', { recursive: true });
cpSync('../api/src', 'dist/plugin-template/api', { recursive: true });
```

`packages/extension/.vscodeignore`: add the line `!dist/plugin-template/**`.

- [ ] **Step 3: Load plugins and register the commands** — `packages/extension/src/extension.ts`

Add imports:
```ts
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { PLUGIN_NAME, scaffoldPlugin } from './host/scaffold';
import { PluginHost, pluginRoots, requireLoader, type LoadReport } from './host/plugins';
```

After the `const api = createPhyApi(…)` line add:

```ts
  const out = vscode.window.createOutputChannel('phy-vscode');
  const log = (m: string) => out.appendLine(m);
  const plugins = new PluginHost({
    api,
    loader: requireLoader(createRequire(join(context.extensionPath, 'package.json'))),
    roots: () => pluginRoots(vscode.workspace.getConfiguration('phyVscode').get('pluginPaths'), homedir(), log),
    log,
    hold: () => mods.hold(),
  });
  const report = (r: LoadReport): LoadReport => {
    if (r.problems.length) {
      void vscode.window.showWarningMessage(`Phy: ${r.problems.length} plugin problem(s): ${r.problems[0]}`, 'Show output').then((b) => b && out.show());
    }
    return r;
  };
```

Replace the line `pluginsLoaded(); // Task 9 loads the plugins first` with:

```ts
  void plugins.load().then(report).finally(pluginsLoaded);
```

Inside the second `context.subscriptions.push(` (the one that starts with the pool disposer), add:

```ts
    out,
    { dispose: () => plugins.dispose() },
    vscode.commands.registerCommand('phy.reloadPlugins', async () => {
      const r = report(await plugins.reload());
      void vscode.window.setStatusBarMessage(`Phy: ${r.loaded} plugin(s) loaded`, 4000);
      return r;
    }),
    vscode.commands.registerCommand('phy.newPlugin', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Name for the new plugin (a folder under ~/.phy-vscode/plugins)',
        value: 'my-plugin',
        validateInput: (v) => (PLUGIN_NAME.test(v) ? undefined : 'Lowercase letters, digits and dashes, starting with a letter'),
      });
      if (!name) return;
      const target = join(homedir(), '.phy-vscode', 'plugins', name);
      try {
        scaffoldPlugin({
          templateDir: join(context.extensionPath, 'dist', 'plugin-template', 'files'),
          apiSrcDir: join(context.extensionPath, 'dist', 'plugin-template', 'api'),
          target,
          name,
        });
      } catch (e) {
        void vscode.window.showErrorMessage(`Phy: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      await vscode.window.showTextDocument(vscode.Uri.file(join(target, 'src', 'index.ts')));
      void vscode.window.showInformationMessage(`Created ${target}. Run "npm install && npm run build" there, then "Phy: Reload Plugins".`);
    }),
```

- [ ] **Step 4: Build, package, check**

Run:
```bash
npm run typecheck && npm test && npm run build
test -f packages/extension/dist/plugin-template/api/index.ts && test -f packages/extension/dist/plugin-template/files/build.mjs
npm run package && unzip -l packages/extension/phy-vscode-0.0.1.vsix | grep -c "plugin-template"
```
Expected: typecheck and tests PASS; both `test -f` succeed; the grep count is at least 10 (the template and API files are in the `.vsix`).

- [ ] **Step 5: Commit**

```bash
git add packages/extension
git commit -m "feat: Phy: Reload Plugins and Phy: New Plugin, phyVscode.pluginPaths"
```

---

### Task 10: Smoke test of mods in real VS Code

This is the one place that proves the webview CSP, `asWebviewUri` and `import()` work together, and that a reload brings the page back.

**Files:**
- Modify: `packages/extension/test/smoke/index.ts`

**Interfaces:**
- Consumes: the `phy.reloadPlugins` command's `LoadReport` return value, `ExtensionApi.renderLog/runView`.

- [ ] **Step 1: Add the plugin fixture and the assertions** — `packages/extension/test/smoke/index.ts`

Add imports at the top:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
```
(`join` is already imported.) Add above `export async function run()`:

```ts
/** A folder plugin with a metric, a histogram and a view; `metricId` is varied to prove a reload picks up edits. */
function writeSmokePlugin(dir: string, metricId: string): void {
  mkdirSync(join(dir, 'smoke'), { recursive: true });
  writeFileSync(
    join(dir, 'smoke', 'index.js'),
    `const vscode = require('vscode');
const path = require('node:path');
exports.apiVersion = '^0.2.0';
exports.activate = (api) => {
  api.registerClusterMetric({ id: '${metricId}', label: 'Smoke', compute: (id) => id * 2 });
  api.registerHistogram({ id: 'smoke_hist', label: 'Smoke', compute: () => new Float64Array([1, 2, 3]) });
  api.registerView({
    id: 'smoke_view',
    title: 'Smoke view',
    rendererScript: vscode.Uri.file(path.join(__dirname, 'renderer.js')),
    provider: async ({ session }) => ({ meta: {}, buffers: [Float32Array.of(session.selection.length).buffer] }),
  });
};
`,
  );
  writeFileSync(
    join(dir, 'smoke', 'renderer.js'),
    `let plot;
export function mount(el, p) { plot = p; }
export function update(meta, buffers) { plot.setScene({ rows: 1, cols: 1, panels: [], message: 'smoke ' + new Float32Array(buffers[0])[0] }); }
export function dispose() { plot = undefined; }
`,
  );
}
```

In `run()`, directly after the `const api = …activate();` line, insert:

```ts
  const pluginDir = mkdtempSync(join(tmpdir(), 'phy-plugins-'));
  writeSmokePlugin(pluginDir, 'smoke_double');
  await vscode.workspace.getConfiguration('phyVscode').update('pluginPaths', [pluginDir], vscode.ConfigurationTarget.Global);
  // The user's own ~/.phy-vscode/plugins may hold plugins too, so judge only this one.
  const reload = async () => {
    const r = (await vscode.commands.executeCommand<{ loaded: number; problems: string[] }>('phy.reloadPlugins'))!;
    assert.deepEqual(r.problems.filter((p) => p.includes('phy-plugins-')), []);
    assert.ok(r.loaded >= 1);
  };
  await reload();
```
and change the `views` line to:
```ts
  const views = ['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics', 'smoke_view'];
```

After the existing line `for (const id of views) assert.ok((await api.runView(id)).buffers.length > 0, …);` insert:

```ts
  // Mods: the plugin's metric is a table column, its histogram a statistics panel, and its view rendered through the real CSP.
  const col = (s: typeof session, id: string) => s.clusters.rows.find((r) => r[0] === 7)![s.clusters.columns.indexOf(id)];
  assert.equal(col(session, 'smoke_double'), 14);
  const stats = (await api.runView('cluster_statistics')).meta as { histograms: { id: string }[] };
  assert.ok(stats.histograms.some((h) => h.id === 'smoke_hist'));

  // Reload with an edited plugin while the dataset is open: the page restarts, every view (including the mod's) renders again.
  writeSmokePlugin(pluginDir, 'smoke_triple');
  mark = api.renderLog().length;
  await reload();
  assert.ok(session.clusters.columns.includes('smoke_triple'));
  assert.ok(!session.clusters.columns.includes('smoke_double'));
  for (const [v, e] of await renderedAfter(mark)) assert.equal(e.error, undefined, `${v} after reload: ${e.error}`);
  assert.deepEqual([...session.selection], [7, 2]);
```

- [ ] **Step 2: Run the smoke test**

Run: `npm run test:smoke -w packages/extension`
Expected: PASS. If `smoke_view` reports `could not load renderer`, the CSP, the `asWebviewUri` query or `localResourceRoots` is wrong: read the webview console, fix `plotPanel.ts`/`html.ts`, and do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/test/smoke/index.ts
git commit -m "test: smoke test loads a plugin's metric, histogram and view, then reloads it"
```

---

### Task 11: Author guide and README

**Files:**
- Create: `docs/mods.md`
- Modify: `README.md`

- [ ] **Step 1: Write `docs/mods.md`**

````md
# Writing phy-vscode mods

> **Proof of concept.** The API (`@phy-vscode/api`, version in `packages/api/package.json`) follows semver but is `0.x`: the minor version may break it.

A mod can add three things:

| You register | You get |
|---|---|
| `registerClusterMetric({ id, label, compute(clusterId, ctx) })` | A column in the Clusters table. It is filterable (`spike_share > 0.1`), sortable and persisted like the built-in columns. `label` is the header's tooltip. |
| `registerHistogram({ id, label, unit?, range?, compute(spikeIds, ctx) })` | A panel in the Cluster statistics view, one curve per selected cluster. |
| `registerView({ id, title, provider, rendererScript })` | A new tile in the dataset editor. |

`ctx.session` is the open dataset: `session.dataset` (typed arrays, read-only), `session.spikesOf(clusterId)`, `session.selection`, `session.clusters`.

## Way 1: a plugin folder (no VS Code extension needed)

1. Run **Phy: New Plugin…**. It creates `~/.phy-vscode/plugins/<name>/` with a working sample (a metric, a histogram and a view) and opens `src/index.ts`.
2. In that folder run `npm install && npm run build`. The build writes `index.js` (runs in the extension host) and `renderer.js` (runs in the plot webview).
3. Run **Phy: Reload Plugins**. Edit, rebuild and reload as often as you like; VS Code does not restart.

How plugins are found:
- `~/.phy-vscode/plugins/` and the paths in the `phyVscode.pluginPaths` setting.
- Each `*.js` file, and each subfolder with an `index.js`, is one plugin.
- A plugin exports `activate(api)`, optionally `deactivate()` and `apiVersion` (a range such as `^0.2.0`; the plugin is refused if it does not match).
- Everything a plugin registers is removed when it is unloaded.
- A plugin that throws is skipped and reported in the **phy-vscode** output channel; the others still load.
- Plugins are never loaded from dataset folders or from workspace settings. `phyVscode.pluginPaths` is a machine-scope setting because a plugin runs with full access to your machine.
- Plugins are plain CommonJS. No TypeScript is compiled at runtime, so build first.
- A reload re-reads a plugin file, or for a folder plugin everything in its folder. A multi-file plugin must therefore be a folder.

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
- **`provider(ctx, token)`** runs in the extension host whenever the selection changes while the view is visible. It returns `{ meta, buffers }`: `meta` is JSON, `buffers` are `ArrayBuffer`s. Check `token.isCancellationRequested` in long loops; a newer selection cancels the run.
- **`rendererScript`** is the path of an ES module that runs in the plot webview and exports `mount(el, plot, host)`, `update(meta, buffers, selection)` and `dispose()` (or a default function returning them). `update` turns the data into a `Scene` and calls `plot.setScene(scene)`. `plot` is the same WebGL2 layer the built-in views use, with pan, zoom and theme colours. `host.settings`/`host.setSettings` pass settings to the provider; `host.getState`/`host.setState` persist renderer-only state per dataset.

Rules for renderer scripts:
- Bundle everything into **one file**. Only its own folder is served to the webview, and only `script-src` from there plus the extension's own bundle is allowed.
- A module that fails to load, or lacks the three exports, shows its error in the view's header. Other views are unaffected.
- When the set of registered views changes (a plugin loads, reloads or is removed), the plot page reloads once. Layout, settings and selection are restored. A newly registered view gets a tab; one you closed stays closed.

## Cluster metrics

`compute` runs synchronously in the extension host, once per cluster, when the metric is registered and when a dataset opens. Return a finite number or a string. Anything else, or a throw, leaves the cell empty and shows one warning. The id is the column name, so it cannot contain spaces or reuse a built-in column (`n_spikes`, `group`, …) or a `cluster_*.tsv` column of the dataset.

## Commands

`phy.reloadPlugins` and `phy.newPlugin` work without a dataset open, unlike the dataset commands, which require `phyDatasetActive`.
````

- [ ] **Step 2: Update `README.md`**

In the warning block, change the bullet `> - **Unstable.** Expect bugs and breaking changes. The mod/plugin API in `packages/api` isn't stable yet.` to:

```md
> - **Unstable.** Expect bugs and breaking changes. The mod API (`packages/api`, `0.x`) can change between minor versions.
```
Add after the "Amplitude, Correlogram and Cluster statistics views" paragraph and screenshot in **Features**:

```md
**Mods:** add table columns, statistics histograms and whole plot views from a plugin folder (`Phy: New Plugin…`, `Phy: Reload Plugins`) or from another VS Code extension. See [docs/mods.md](docs/mods.md).
```

- [ ] **Step 3: Final checks**

Run: `npm run typecheck && npm test && npm run test:smoke -w packages/extension && git status --short`
Expected: everything PASSES; `git status` shows only the docs changes.

- [ ] **Step 4: Commit**

```bash
git add docs/mods.md README.md
git commit -m "docs: mod author guide and README"
```

Then dispatch the final whole-branch review over `main..phy-vscode-mods` on the most capable model, and merge as the user chooses.

---

### Task 12: Example plugin — the taro-station page of the selected cluster

A plugin that, while a dataset is open, shows `http://taro-station.usc.edu/dataview/cell/<year>-<month>-<day>-R%03d<shank>-C%04d` for the first selected cluster in a panel beside the editor. It is the first real use of the plugin API.

- **Where the URL comes from:** the open dataset's folder is named like `2026-05-07-R001A`. That is `<year>-<month>-<day>-R%03d<shank>` (here run `001`, shank `A`), so the URL is the base plus the folder name plus `-C%04d`, where `%04d` is the cluster id, zero-padded to four digits (`-C0012`). A folder that does not match makes the plugin say so; it never guesses.
- **Which cluster:** the first selected one (decided with the user).
- **Why not `registerView`:** a view tile shares the plot page's CSP (`default-src 'none'`), which blocks a page embedded from another site. The plugin opens its own webview panel through `require('vscode')`, with a CSP that allows only that site as a frame. A plugin cannot add Command Palette entries, so a status-bar item toggles the panel.
- **Two risks to check by hand** (they need the real site, on a network that reaches it): the page is `http` inside an `https` webview, which the browser may block as mixed content, and the site may forbid framing. The panel therefore always shows the URL and an "Open in browser" link, and one constant switches the iframe off.

**Files:**
- Create: `examples/taro-cell/package.json`, `tsconfig.json`, `build.mjs`, `src/url.ts`, `src/index.ts`, `README.md`
- Modify: `.gitignore`, `docs/mods.md`
- Test: `packages/extension/test/taroCell.test.ts`

**Interfaces:**
- Consumes: `PhyApi`, `PhySession`, `Disposable`, `API_VERSION` from `@phy-vscode/api`; the folder-plugin loading of Tasks 7 and 9.
- Produces:
  - `cellUrl(datasetDir: string, clusterId: number): string | undefined`, in `examples/taro-cell/src/url.ts`. It returns the full URL, or `undefined` when the folder name does not match or the id is not a non-negative integer.
  - `folderName(datasetDir: string): string`.
  - `ORIGIN: string` (`http://taro-station.usc.edu`) and `BASE_URL: string` (`ORIGIN` + `/dataview/cell/`).

- [ ] **Step 1: Write the failing test** — `packages/extension/test/taroCell.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { BASE_URL, cellUrl, folderName } from '../../../examples/taro-cell/src/url';

describe('cellUrl', () => {
  it('is the dataset folder name plus the zero-padded cluster id', () => {
    expect(cellUrl('/data/ks4-x/2026-05-07-R001A', 12)).toBe(`${BASE_URL}2026-05-07-R001A-C0012`);
    expect(cellUrl('/data/ks4-x/2026-05-07-R001A/', 0)).toBe(`${BASE_URL}2026-05-07-R001A-C0000`);
    expect(cellUrl('2026-12-31-R123B', 9999)).toBe(`${BASE_URL}2026-12-31-R123B-C9999`);
  });
  it('lets a wider id through, like printf %04d', () => {
    expect(cellUrl('/d/2026-05-07-R001A', 12345)).toBe(`${BASE_URL}2026-05-07-R001A-C12345`);
  });
  it('is undefined when the folder is not <year>-<month>-<day>-R<run><shank>', () => {
    for (const dir of ['/d/ks4-019e7fd7', '/d/2026-05-07-R01A', '/d/2026-05-07-R001', '/d/2026-5-7-R001A', '/d/2026-05-07-R001A-extra', '/d/x2026-05-07-R001A']) {
      expect(cellUrl(dir, 1), dir).toBeUndefined();
    }
  });
  it('is undefined for an id that is not a non-negative integer', () => {
    for (const id of [-1, 1.5, NaN, Infinity]) expect(cellUrl('/d/2026-05-07-R001A', id), String(id)).toBeUndefined();
  });
  it('folderName ignores trailing separators', () => {
    expect(folderName('/a/b/2026-05-07-R001A//')).toBe('2026-05-07-R001A');
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `npm test -w packages/extension -- taroCell`
Expected: FAIL (module `examples/taro-cell/src/url` not found).

- [ ] **Step 3: Write `examples/taro-cell/src/url.ts`**

```ts
import { basename } from 'node:path';

export const ORIGIN = 'http://taro-station.usc.edu';
export const BASE_URL = `${ORIGIN}/dataview/cell/`;
// <year>-<month>-<day>-R%03d<shank>, e.g. 2026-05-07-R001A: the folder Kilosort wrote the sorting to
const SESSION = /^\d{4}-\d{2}-\d{2}-R\d{3}[A-Za-z]+$/;

/** Last path component, ignoring trailing separators. */
export const folderName = (datasetDir: string): string => basename(datasetDir.replace(/[\\/]+$/, ''));

/** `…/2026-05-07-R001A` + cluster 12 → `http://taro-station.usc.edu/dataview/cell/2026-05-07-R001A-C0012`. */
export function cellUrl(datasetDir: string, clusterId: number): string | undefined {
  const name = folderName(datasetDir);
  if (!SESSION.test(name) || !Number.isInteger(clusterId) || clusterId < 0) return undefined;
  return `${BASE_URL}${name}-C${String(clusterId).padStart(4, '0')}`;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -w packages/extension -- taroCell`
Expected: PASS.

- [ ] **Step 5: Write the plugin** under `examples/taro-cell/`

`package.json`:
```json
{
  "name": "taro-cell",
  "version": "0.0.1",
  "private": true,
  "scripts": { "build": "node build.mjs" }
}
```
(No dependencies: `esbuild` and the API sources resolve from the repo root.)

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node", "vscode"],
    "paths": { "@phy-vscode/api": ["../../packages/api/src/index.ts"] }
  },
  "include": ["src"]
}
```

`build.mjs`:
```js
import { build } from 'esbuild';

await build({ entryPoints: ['src/index.ts'], outfile: 'index.js', bundle: true, sourcemap: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], logLevel: 'info' });
```

`src/index.ts`:
```ts
import * as vscode from 'vscode';
import type { Disposable, PhyApi, PhySession } from '@phy-vscode/api';
import { cellUrl, folderName, ORIGIN } from './url';

export const apiVersion = '^0.2.0';

// Set to false if taro-station refuses to be framed (http inside the https webview, or X-Frame-Options): the panel then
// shows the URL and an "Open in browser" link only.
const EMBED = true;
const TOGGLE = 'taroCell.toggle';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page for the first selected cluster of `session`, or a message saying why there is none. */
function pageFor(session: PhySession | undefined): string {
  if (!session) return `<p>Open a phy dataset first.</p>`;
  const id = session.selection[0];
  if (id === undefined) return `<p>Select a cluster.</p>`;
  const url = cellUrl(session.dataset.dir, id);
  if (!url) return `<p>The dataset folder <code>${esc(folderName(session.dataset.dir))}</code> is not named <code>&lt;year&gt;-&lt;month&gt;-&lt;day&gt;-R&lt;run&gt;&lt;shank&gt;</code>, e.g. <code>2026-05-07-R001A</code>.</p>`;
  return (
    `<p class="bar"><code>${esc(url)}</code> <a href="${esc(url)}">Open in browser</a></p>` +
    (EMBED ? `<iframe src="${esc(url)}"></iframe>` : '')
  );
}

const html = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src ${ORIGIN} ${ORIGIN.replace('http:', 'https:')};">` +
  `<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}` +
  `.bar,p{margin:6px 10px;font-size:12px}iframe{flex:1;border:0;background:#fff}</style></head><body>${body}</body></html>`;

export function activate(api: PhyApi): Disposable {
  const subs: Disposable[] = [];
  let panel: vscode.WebviewPanel | undefined;

  const render = () => {
    if (panel) panel.webview.html = html(pageFor(api.activeSession()));
  };

  // The API has no "active session changed" event, so listen to every session that opens and act only on the active one.
  const watch = (s: PhySession) =>
    subs.push(
      s.onDidChangeSelection(() => {
        if (s === api.activeSession()) render();
      }),
    );
  const current = api.activeSession();
  if (current) watch(current);
  subs.push(api.onDidOpenSession(watch));

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.text = '$(globe) Taro cell';
  item.tooltip = 'Show the taro-station page of the selected cluster';
  item.command = TOGGLE;
  item.show();

  const command = vscode.commands.registerCommand(TOGGLE, () => {
    if (panel) {
      panel.dispose();
      return;
    }
    panel = vscode.window.createWebviewPanel('taroCell', 'Taro cell', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: false });
    panel.onDidDispose(() => (panel = undefined));
    render();
  });

  return {
    dispose() {
      for (const s of subs) s.dispose();
      command.dispose();
      item.dispose();
      panel?.dispose();
    },
  };
}
```
The CSP's `frame-src` allows only `ORIGIN` and its `https` twin (in case the site redirects to https).

`README.md`:
```md
# taro-cell

A phy-vscode plugin: a **Taro cell** status-bar item opens a panel with the taro-station page of the first selected cluster,
`http://taro-station.usc.edu/dataview/cell/<dataset folder name>-C<cluster id, 4 digits>`.

The dataset folder (the one with `params.py`) must be named `<year>-<month>-<day>-R<run><shank>`, e.g. `2026-05-07-R001A`.

    node build.mjs        # from this folder; writes index.js

Then add `<repo>/examples` to `phyVscode.pluginPaths` (or copy this folder to `~/.phy-vscode/plugins/`) and run **Phy: Reload Plugins**.
```

`.gitignore`: append the lines
```
examples/*/index.js
examples/*/index.js.map
```

- [ ] **Step 6: Typecheck and build**

Run:
```bash
npm run typecheck
node_modules/.bin/tsc -p examples/taro-cell
(cd examples/taro-cell && node build.mjs)
test -f examples/taro-cell/index.js
```
Expected: no type errors; `index.js` exists.

- [ ] **Step 7: Load it with the real extension**

Run: `npm run build` then press F5 ("Run phy-vscode"), or install a fresh `.vsix`. In the host window add `<repo>/examples` to `phyVscode.pluginPaths` (User settings), run **Phy: Reload Plugins**, and expect the **phy-vscode** output channel to say `…/taro-cell/index.js: loaded`. Open `dataset/ks4-…/2026-05-07-R001A/params.py` with **Phy: Open Dataset…**, select a cluster, click **Taro cell** in the status bar.
Expected:
- A panel opens beside the editor and shows `…/cell/2026-05-07-R001A-C<id>` with an "Open in browser" link.
- It changes when you select another cluster, and with several selected it shows the first.
- With the sample dataset's folder renamed to something else, it shows the "is not named …" message.

- [ ] **Step 8: Decide on the embed, on a network that reaches taro-station**

The iframe either shows the page or stays blank (the webview's developer tools, **Developer: Open Webview Developer Tools**, name the reason: `Mixed Content` or `X-Frame-Options`/`frame-ancestors`).
- **It shows the page:** keep `EMBED = true`.
- **It is blocked:** set `const EMBED = false;` in `src/index.ts`, run `node build.mjs`, reload plugins, and confirm the panel still tracks the selection with a working "Open in browser" link. Commit that change and note the reason in `examples/taro-cell/README.md`.

- [ ] **Step 9: Document and commit**

Append to `docs/mods.md`:

```md
## Example

`examples/taro-cell/` is a complete plugin that adds a status-bar item and a webview panel showing an external page for the selected cluster. It uses only `activeSession()`, `onDidOpenSession` and `session.onDidChangeSelection`, plus the `vscode` module, which a plugin can `require` because it runs in the extension host. A plugin cannot contribute Command Palette entries, so it uses a status-bar item.
```

```bash
git add examples docs/mods.md .gitignore packages/extension/test/taroCell.test.ts
git commit -m "feat: taro-cell example plugin shows the taro-station page of the selected cluster"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| §6 `PhyApi` (`version`, `activeSession`, `onDidOpenSession`, `registerView`, `registerClusterMetric`, `registerHistogram`) | 1 (types), 2 (registry), 6 (`createPhyApi`, `activate` returns it) |
| §6 `PhySession`, `ViewDefinition` shapes | 1 (`rendererScript` is `UriLike`, which a `vscode.Uri` satisfies); `PhySession` already existed |
| §6 `api.version` checked at mod load | 1 (`satisfiesApi`), 7 (`apiVersion` check) |
| §6 channel 1: extension `exports`, `extensionDependencies`, `asWebviewUri`, `localResourceRoots`, CSP | 5 (CSP, renderer loading), 6 (roots, URIs), 11 (docs), 10 (real CSP) |
| §6 channel 2: plugin folder, `pluginPaths`, `activate(api)`, no TS compiler, never from dataset folders | 7, 9 |
| §6 `Phy: Reload Plugins` without restart | 7 (`reload`), 9 (command), 10 (smoke) |
| §6 `Phy: New Plugin` scaffold with an esbuild script | 8, 9 |
| §5 Cluster statistics "mods add panels with `api.registerHistogram`" | 2 (live list), 6 (`viewChanged` on change), 10 |
| §4 Session table "mod metrics" column | 3 |
| §4 commands `phy.reloadPlugins`, `phy.newPlugin` | 9; ruling on the `when` context under Global Constraints |
| §5 Shared plot layer "exported to mods via the API" | 1 (types and helpers), 8 (sample renderer uses them) |
| §6 mod renderers: `mount(el, plot)`, `update`, `dispose` | 5 (`moduleRenderer`) |
| §7 curation (`onDidChangeClusters`) | untouched: still declared, never fired |
| §8 testing: unit for pure logic, smoke for real VS Code | every task; 10 |
| Plan 2 deferral: column reordering | still deferred, unchanged |
| User request: a plugin showing the taro-station page of the selected cluster (first selected) | 12 |
