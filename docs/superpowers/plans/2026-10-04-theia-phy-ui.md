# Theia-Phy UI (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Phase L tasks are dispatched **in parallel** with superpowers:dispatching-parallel-agents, one agent per lane, each in its own git worktree.

**Goal:** Turn the Plan 1 core into the phy UI. A Cluster table goes in a sidebar. Five plot views are tiled in the dataset editor and drawn with a small WebGL2 plot layer. Selection, commands and keys work, and the layout and settings persist.

**Architecture:** The extension host keeps all state. Two webviews render it: the sidebar (`theiaPhy.clusters`) and the dataset editor's plot webview.
- **Host to webview.** A `ViewScheduler` runs only the visible views. It cancels stale work and posts `viewData {viewId, seq, meta, buffers, selection}`.
- **Plot webview.** It tiles views with `dockview-core`. Each view's `ViewRenderer` turns `meta` and `buffers` into a `Scene`, built by a pure function, and the shared plot layer draws it with WebGL2 plus a Canvas2D overlay.
- **Why the work splits into parallel lanes.** All pure logic (scene builders, filter grammar, table math, scheduling, ticks and geometry) is unit-tested in Node. Each view's renderer and scene live in that view's own folder. So after a sequential **foundation** (protocol, plot layer, scheduler, webview shells, commands), six **lanes** run in parallel without touching each other's files: the sidebar plus the five views.

**Tech Stack:** TypeScript, VS Code webview API, `dockview-core` 8.x (the only UI dependency), WebGL2, Canvas2D, esbuild (browser IIFE bundles), vitest, `@vscode/test-electron`.

**Spec:** `docs/superpowers/specs/2026-10-03-phy-vscode-extension-design.md` (§4 Session/selection/protocol, §5 Views, Shared plot layer, Tiling). Builds on Plan 1 (`docs/superpowers/plans/2026-10-03-theia-phy-core.md`), which is merged on `main`.

## Global Constraints

- "Layout: Hybrid: Cluster view in a sidebar webview; plot views tiled in one editor tab."
- "The extension host owns all state. Webviews are renderers that send user intents."
- "`dockview-core` (framework-free, zero dependencies) … It is the only UI dependency; all other webview code is vanilla TypeScript."
- "WebGL2 batches: scatter (per-point colour/alpha), polylines (many lines per draw call), bars. Canvas2D overlay for axes, ticks, labels. Subplot grid helper. Interaction: drag pan, wheel zoom, double-click reset. Colours from VS Code theme CSS variables (light/dark)."
  - Plan ruling: colour is per layer, i.e. per cluster or group, so the shaders stay one-uniform.
- "A new selection cancels in-flight requests (`CancellationToken`); results carry `seq` and stale ones are dropped. Only visible views compute; a hidden view computes when shown."
- "Colours: assigned by selection order (phy palette); all views use the Session-provided colours."
- "Every action is a VS Code command (`phy.openDataset`, `phy.selectNext`, `phy.selectPrevious`, `phy.view.toggle`, …) with `when` context `phyDatasetActive`."
  - `phy.reloadPlugins` and `phy.newPlugin` are Plan 3.
- "Plot layout, column order/sort, and per-view settings in `workspaceState`, keyed by absolute `params.py` path. Webviews use `setState` for instant restore."
- Cluster view filter grammar: "`<column> <op> <value>` joined by `and`/`or`, ops `== != < <= > >=`; no code evaluation."
- "Rendering: manual in v1". Pure scene builders are unit-tested; drawing is checked by the smoke test's render log and by screenshots.
- Webview CSP: scripts only from the extension's `dist/webview` root, with a per-load nonce. No `unsafe-eval`.
- Webview buffers posted to a webview must be plain `ArrayBuffer`s, never `SharedArrayBuffer` or subarray views. `toArrayBuffer` in the scheduler normalises them.
- **Lanes own only their listed files.** A lane that needs a foundation change reports `NEEDS_CONTEXT` instead of editing shared files.
- All commands run from the repo root unless a step says otherwise. Unit tests: `npm test -w packages/extension -- <filter>`.

## Review Focus

1. **Rapid selection changes (holding ↓ or Alt+↓).** Only the latest selection's data may render; stale results must never flash. *Pinned:* Task F3, "drops stale results and cancels the superseded run".
2. **Datasets missing optional files** (no amplitudes, templates or pc_features). Each dependent view shows "needs <file>" in its header; the other views still render. *Pinned:* Task F3 (`viewError` posted), and the Task F4 smoke test on the `minimal` fixture.
3. **Empty selection, a single-spike cluster, or a cluster with no usable channels.** Every scene builder returns a message scene ("Select a cluster"), never throws. *Pinned:* the "empty selection" test in each lane, L2–L6.
4. **10k+ clusters in the sidebar.** Only the visible rows go into the DOM, and sort and filter stay fast. *Pinned:* Lane L1's `visibleRange` and sort-10k tests.
5. **Closing or switching dataset editors while views are computing.** Late results go nowhere, the sidebar follows the active dataset, and nothing posts to a disposed webview. *Pinned:* Task F3's "ignores results after dispose", and the Task F4 smoke test switching from `base` to `noraw`.

---

## Execution model

| Phase | Tasks | How |
|---|---|---|
| **F: foundation** | F1–F5 | Sequential, on branch `theia-phy-ui`, with subagent-driven development and a review after each task. |
| **L: lanes** | L1–L6 | **Parallel.** One agent per lane, dispatched in a single message, each with `isolation: "worktree"` branched from the F5 head. Each lane starts with `npm install` in its worktree and commits to its own branch. |
| **I: integration** | I1 | Merge the six lane branches into `theia-phy-ui`, run the full suite, build, smoke test, take screenshots on the real dataset, then a final whole-branch review. |

Lane file ownership (disjoint, so merges are conflict-free):

| Lane | Owns |
|---|---|
| L1 Cluster sidebar | `src/webview/sidebar/**`, `test/sidebar.test.ts` |
| L2 Waveform | `src/views/waveform/**`, `test/waveform.test.ts`, `test/scene-waveform.test.ts` |
| L3 Feature | `src/views/feature/renderer.ts`, `src/views/feature/scene.ts`, `test/scene-feature.test.ts` |
| L4 Correlogram | `src/views/correlogram/renderer.ts`, `src/views/correlogram/scene.ts`, `test/scene-correlogram.test.ts` |
| L5 Amplitude | `src/views/amplitude/renderer.ts`, `src/views/amplitude/scene.ts`, `test/scene-amplitude.test.ts` |
| L6 Cluster statistics | `src/views/stats/renderer.ts`, `src/views/stats/scene.ts`, `test/scene-stats.test.ts` |

## File structure (new or changed in this plan)

```
packages/api/src/protocol.ts                 F1  message types (host ↔ webviews)
packages/api/src/index.ts                    F1  re-exports protocol types
packages/extension/
  package.json                               F1 dockview-core; F5 views container, commands, keybindings
  tsconfig.json                              F1 adds DOM lib
  esbuild.mjs                                F4 plot bundle; F5 sidebar bundle
  .vscodeignore                              F4 dist/webview; F5 media
  media/phy.svg                              F5 activity-bar icon
  src/host/html.ts                           F1 webviewHtml + nonce; F4 summaryHtml → datasetInfo
  src/host/viewScheduler.ts                  F3 visible-only, seq, cancellation
  src/host/plotPanel.ts                      F4 plot webview host side + persistence
  src/host/clusterView.ts                    F5 sidebar WebviewViewProvider
  src/host/editor.ts                         F4 uses PlotPanel; active-session events
  src/shared/order.ts                        F5 stepSelection (host commands + sidebar keys)
  src/extension.ts                           F4/F5 wiring, commands, test API
  src/webview/vscode.ts                      F4 acquireVsCodeApi typing
  src/webview/plot/scene.ts                  F2 Scene/Layer/Panel types, EMPTY
  src/webview/plot/geometry.ts               F2 grid rects, vertex packing, colours
  src/webview/plot/ticks.ts                  F2 nice ticks, tick labels
  src/webview/plot/view.ts                   F2 ranges: zoom, pan, padded
  src/webview/plot/plot.ts                   F2 WebGL2 + Canvas2D Plot
  src/webview/plot/renderer.ts               F2 ViewRenderer, RendererHost, sceneRenderer, addToolbar
  src/webview/plot/renderers.ts              F4 viewId → renderer factory registry
  src/webview/plot/main.ts                   F4 dockview shell
  src/webview/sidebar/main.ts                F5 minimal table → L1 full Cluster view
  src/views/<view>/renderer.ts               F4 interim → L2–L6 real renderers
  src/views/<view>/scene.ts                  L2–L6 pure scene builders
  test/smoke/index.ts                        F4/F5 render log, minimal fixture, selectNext
```

---

## Phase F — Foundation (sequential)

### Task F1: Protocol types, webview HTML helper, build prerequisites

**Files:**
- Create: `packages/api/src/protocol.ts`
- Modify: `packages/api/src/index.ts` (append re-export)
- Modify: `packages/extension/src/host/html.ts` (add `webviewHtml`, `nonce`)
- Modify: `packages/extension/tsconfig.json` (DOM lib)
- Modify: `packages/extension/package.json` (dependency `dockview-core`)
- Test: `packages/extension/test/html.test.ts` (append)

**Interfaces:**
- Produces (`@theia-phy/api`):
  - `SelectionMsg`, `TableState`, `ViewEventPayload`
  - `PlotToHost`, `HostToPlot`, `SidebarToHost`, `HostToSidebar`, with the exact text in Step 3
- Produces (`html.ts`):
  - `webviewHtml(o: { cspSource: string; scriptUri: string; nonce: string; title: string }): string`
  - `nonce(): string`
  - `BASE_CSS: string`

- [ ] **Step 1: Write the failing test** (append to `packages/extension/test/html.test.ts`, and add `webviewHtml` to its import from `../src/host/html`)

```ts
describe('webviewHtml', () => {
  it('allows scripts only from the nonce and never eval', () => {
    const h = webviewHtml({ cspSource: 'vscode-resource:', scriptUri: 'vscode-resource:/dist/webview/plot.js', nonce: 'abc123', title: 'Phy <x>' });
    expect(h).toContain("script-src 'nonce-abc123'");
    expect(h).toContain('<script nonce="abc123" src="vscode-resource:/dist/webview/plot.js">');
    expect(h).not.toContain('unsafe-eval');
    expect(h).toContain('<title>Phy &#60;x&#62;</title>');
    expect(h).toContain('<div id="root"></div>');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- html`
Expected: FAIL (`webviewHtml` is not exported).

- [ ] **Step 3: Implement**

`packages/api/src/protocol.ts`:
```ts
import type { Cell } from './index';

/** Selection snapshot: ids in selection order and their Session colours. */
export interface SelectionMsg {
  ids: number[];
  colors: string[];
}

/** Persisted Cluster-view state. */
export interface TableState {
  sort?: { column: string; descending: boolean };
  filter?: string;
}

export type ViewEventPayload =
  | { kind: 'settings'; settings: Record<string, unknown> } // provider settings: recompute
  | { kind: 'state'; state: unknown }; // renderer-only UI state: persist, no recompute

/** Plot webview → host. */
export type PlotToHost =
  | { type: 'ready' }
  | { type: 'visible'; viewIds: string[] }
  | { type: 'viewEvent'; viewId: string; payload: ViewEventPayload }
  | { type: 'persist'; layout: unknown }
  | { type: 'rendered'; viewId: string; seq: number; error?: string };

/** Host → plot webview. */
export type HostToPlot =
  | {
      type: 'init';
      views: { id: string; title: string }[];
      layout?: unknown;
      settings: Record<string, Record<string, unknown>>;
      states: Record<string, unknown>;
    }
  | { type: 'viewData'; viewId: string; seq: number; meta: unknown; buffers: ArrayBuffer[]; selection: SelectionMsg }
  | { type: 'viewError'; viewId: string; seq: number; message: string }
  | { type: 'toggleView'; viewId: string };

/** Cluster sidebar → host. */
export type SidebarToHost =
  | { type: 'ready' }
  | { type: 'select'; ids: number[] }
  | { type: 'order'; ids: number[] } // current sorted+filtered cluster order, for phy.selectNext/Previous
  | { type: 'persist'; table: TableState };

/** Host → Cluster sidebar. */
export type HostToSidebar =
  | { type: 'clusterTable'; columns: string[]; rows: Cell[][]; info: string; state: TableState }
  | { type: 'selection'; selection: SelectionMsg }
  | { type: 'empty' };
```

Append to `packages/api/src/index.ts`:
```ts
export type * from './protocol';
```

Add to `packages/extension/src/host/html.ts`:

- Change the first line to import `randomBytes`:
  ```ts
  import { randomBytes } from 'node:crypto';
  ```
- Append:
```ts
export const BASE_CSS =
  'html,body,#root{height:100%;margin:0;padding:0;overflow:hidden}' +
  'body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}' +
  '.phy-view{display:flex;flex-direction:column;height:100%}' +
  '.phy-header{font-size:11px;padding:2px 6px;min-height:16px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.phy-header.error{color:var(--vscode-errorForeground)}' +
  '.phy-body{flex:1;position:relative;min-height:0}' +
  '.phy-toolbar{position:absolute;top:2px;right:6px;z-index:2;display:flex;gap:8px;align-items:center;font-size:11px}' +
  '.phy-toolbar input[type=number]{width:4.5em;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}';

export const nonce = (): string => randomBytes(16).toString('base64');

export function webviewHtml(o: { cspSource: string; scriptUri: string; nonce: string; title: string }): string {
  const csp = `default-src 'none'; style-src ${o.cspSource} 'unsafe-inline'; img-src ${o.cspSource} data:; script-src 'nonce-${o.nonce}';`;
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(o.title)}</title><style>${BASE_CSS}</style></head>` +
    `<body><div id="root"></div><script nonce="${o.nonce}" src="${o.scriptUri}"></script></body></html>`
  );
}
```

In `packages/extension/tsconfig.json`, set `"compilerOptions": { "types": ["node", "vscode"], "lib": ["ES2022", "DOM"] }`.

Install the UI dependency: `npm install -w packages/extension dockview-core@^8.4.0`

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w packages/extension -- html` then `npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/protocol.ts packages/api/src/index.ts packages/extension/src/host/html.ts packages/extension/test/html.test.ts packages/extension/tsconfig.json packages/extension/package.json package-lock.json
git commit -m "feat: webview message protocol and CSP-safe webview HTML"
```

---

### Task F2: Plot layer (scene types, pure geometry, WebGL2/Canvas2D Plot, renderer contract)

**Files:**
- Create: `packages/extension/src/webview/plot/{scene,geometry,ticks,view,plot,renderer}.ts`
- Test: `packages/extension/test/plot.test.ts`

**Interfaces:**
- Produces (`view.ts`):
  - `interface Range { min: number; max: number }`
  - `zoomRange(r, factor, at): Range`
  - `panRange(r, fraction): Range`
  - `paddedRange(...arrays: ArrayLike<number>[]): Range` (finite values only, 5 % padding)
- Produces (`scene.ts`):
  - `type Rgba = readonly [number, number, number, number]` (each 0..1)
  - Layer types:
    - `ScatterLayer {kind:'scatter'; x; y: Float32Array; color: Rgba; size: number}`
    - `LinesLayer {kind:'lines'; x; y: Float32Array; color}` (polylines separated by NaN)
    - `BarsLayer {kind:'bars'; x0; dx: number; heights: Float32Array; color; horizontal?: boolean}`
    - `Layer` is the union of the three.
  - `Panel {row; col; x: Range; y: Range; layers: Layer[]; axes?: boolean; title?; xLabel?; yLabel?: string; vlines?; hlines?: number[]}`
  - `Scene {rows; cols; panels: Panel[]; colWeights?; rowWeights?: number[]; message?: string}`
  - `EMPTY(message): Scene`
- Produces (`geometry.ts`):
  - `Rect`, `gridRects(width, height, rows, cols, gap?, colWeights?, rowWeights?)`, `inset(rect, m)`, `AXIS_INSET`, `BARE_INSET`
  - `interleave(x, y)`, `polylineSegments(x, y)`, `barTriangles(x0, dx, heights, horizontal)`
  - `parseColor(css, alpha?)`, `withAlpha(c, a)`, `toCss(c)`
- Produces (`ticks.ts`): `niceTicks(min, max, target = 5): number[]`, `formatTick(v): string`
- Produces (`plot.ts`):
  - `interface Theme { fg; muted; bg: Rgba }`
  - `interface PlotClick { panel: number; x: number; y: number; shift: boolean; button: number }`
  - `interface Plot { setScene(scene: Scene): void; onClick(listener: (e: PlotClick) => void): void; theme(): Theme; dispose(): void }`
  - `createPlot(container: HTMLElement): Plot`
- Produces (`renderer.ts`):
  - `interface RendererHost { readonly settings; setSettings(s); getState<T>(); setState(s) }`
  - `interface ViewRenderer { mount(el, plot, host); update(meta, buffers, selection); dispose() }`
  - `type SceneBuilder = (meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme) => Scene`
  - `sceneRenderer(build): () => ViewRenderer`, `addToolbar(el): HTMLElement`, `colorOf(selection, id, alpha?): Rgba`

- [ ] **Step 1: Write the failing tests**

`packages/extension/test/plot.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { barTriangles, gridRects, inset, interleave, parseColor, polylineSegments, toCss, withAlpha } from '../src/webview/plot/geometry';
import { colorOf } from '../src/webview/plot/renderer';
import { formatTick, niceTicks } from '../src/webview/plot/ticks';
import { paddedRange, panRange, zoomRange } from '../src/webview/plot/view';

describe('ticks', () => {
  it('picks 1-2-5 steps', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(-0.023, 0.027)).toEqual([-0.02, -0.01, 0, 0.01, 0.02]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });
  it('formats compactly', () => {
    expect(formatTick(0.1 + 0.2)).toBe('0.3');
    expect(formatTick(25000)).toBe('2.5e+4');
    expect(formatTick(0)).toBe('0');
  });
});

describe('view ranges', () => {
  it('zooms around a point and pans by a fraction', () => {
    expect(zoomRange({ min: 0, max: 10 }, 0.5, 4)).toEqual({ min: 2, max: 7 });
    expect(panRange({ min: 0, max: 10 }, 0.1)).toEqual({ min: 1, max: 11 });
  });
  it('pads finite values and survives degenerate input', () => {
    expect(paddedRange(Float32Array.from([0, 10, NaN]))).toEqual({ min: -0.5, max: 10.5 });
    expect(paddedRange([2, 2])).toEqual({ min: 1, max: 3 });
    expect(paddedRange([], [NaN])).toEqual({ min: 0, max: 1 });
  });
});

describe('geometry', () => {
  it('lays out weighted grids row-major', () => {
    const r = gridRects(104, 50, 1, 2, 4, [3, 1]);
    expect(r).toEqual([{ x: 0, y: 0, w: 75, h: 50 }, { x: 79, y: 0, w: 25, h: 50 }]);
    expect(inset({ x: 0, y: 0, w: 10, h: 10 }, { left: 20, right: 0, top: 0, bottom: 0 }).w).toBe(0);
  });
  it('packs vertices, skipping NaN gaps', () => {
    expect(Array.from(interleave(Float32Array.from([1, NaN, 3]), Float32Array.from([4, 5, 6])))).toEqual([1, 4, 3, 6]);
    const seg = polylineSegments(Float32Array.from([0, 1, 2, NaN, 5, 6]), Float32Array.from([0, 1, 0, NaN, 5, 5]));
    expect(Array.from(seg)).toEqual([0, 0, 1, 1, 1, 1, 2, 0, 5, 5, 6, 5]);
  });
  it('builds two triangles per bar, optionally horizontal', () => {
    expect(Array.from(barTriangles(0, 1, Float32Array.from([2]), false))).toEqual([0, 0, 1, 0, 1, 2, 0, 0, 1, 2, 0, 2]);
    expect(Array.from(barTriangles(0, 1, Float32Array.from([2]), true))).toEqual([0, 0, 0, 1, 2, 1, 0, 0, 2, 1, 2, 0]);
  });
  it('parses theme colours', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(parseColor('#f00', 0.5)).toEqual([1, 0, 0, 0.5]);
    expect(parseColor('#00000080')[3]).toBeCloseTo(0.502, 3);
    expect(parseColor('rgba(0, 255, 0, 0.25)')).toEqual([0, 1, 0, 0.25]);
    expect(parseColor('nonsense')).toEqual([0.5, 0.5, 0.5, 1]);
    expect(toCss(withAlpha([1, 0, 0, 1], 0.5))).toBe('rgba(255,0,0,0.5)');
  });
  it('colours a cluster by its position in the selection', () => {
    const sel = { ids: [7, 2], colors: ['#0892fc', '#ff0202'] };
    expect(colorOf(sel, 2)).toEqual([1, 2 / 255, 2 / 255, 1]);
    expect(colorOf(sel, 99, 0.5)).toEqual([128 / 255, 128 / 255, 128 / 255, 0.5]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -w packages/extension -- plot`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the pure modules**

`packages/extension/src/webview/plot/view.ts`:
```ts
export interface Range {
  min: number;
  max: number;
}

/** Scale a range by `factor` around the data value `at` (factor < 1 zooms in). */
export const zoomRange = (r: Range, factor: number, at: number): Range => ({
  min: at - (at - r.min) * factor,
  max: at + (r.max - at) * factor,
});

/** Shift a range by `fraction` of its width. */
export const panRange = (r: Range, fraction: number): Range => {
  const d = (r.max - r.min) * fraction;
  return { min: r.min + d, max: r.max + d };
};

/** Finite min/max of all values with 5 % padding; never degenerate. */
export function paddedRange(...arrays: ArrayLike<number>[]): Range {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (lo === Infinity) return { min: 0, max: 1 };
  if (lo === hi) return { min: lo - 1, max: hi + 1 };
  const pad = (hi - lo) * 0.05;
  return { min: lo - pad, max: hi + pad };
}
```

`packages/extension/src/webview/plot/scene.ts`:
```ts
import type { Range } from './view';

export type Rgba = readonly [number, number, number, number];

export interface ScatterLayer {
  kind: 'scatter';
  x: Float32Array;
  y: Float32Array;
  color: Rgba;
  size: number; // CSS px
}
/** Polylines; consecutive polylines are separated by a NaN vertex. */
export interface LinesLayer {
  kind: 'lines';
  x: Float32Array;
  y: Float32Array;
  color: Rgba;
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

export const EMPTY = (message: string): Scene => ({ rows: 1, cols: 1, panels: [], message });
```

`packages/extension/src/webview/plot/ticks.ts`:
```ts
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

export function formatTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e4 || (a > 0 && a < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(6)));
}
```

`packages/extension/src/webview/plot/geometry.ts`:
```ts
import type { Rgba } from './scene';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export const AXIS_INSET: Insets = { left: 40, right: 6, top: 14, bottom: 18 };
export const BARE_INSET: Insets = { left: 2, right: 2, top: 12, bottom: 2 };

/** Cell rectangles (CSS px, y down), row-major. */
export function gridRects(width: number, height: number, rows: number, cols: number, gap = 4, colWeights?: number[], rowWeights?: number[]): Rect[] {
  const cw = colWeights ?? new Array<number>(cols).fill(1);
  const rw = rowWeights ?? new Array<number>(rows).fill(1);
  const tw = cw.reduce((a, b) => a + b, 0);
  const th = rw.reduce((a, b) => a + b, 0);
  const availW = Math.max(0, width - gap * (cols - 1));
  const availH = Math.max(0, height - gap * (rows - 1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let c = 0, x = 0; c < cols; c++) {
    xs.push(x);
    x += (availW * cw[c]) / tw + gap;
  }
  for (let r = 0, y = 0; r < rows; r++) {
    ys.push(y);
    y += (availH * rw[r]) / th + gap;
  }
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ x: xs[c], y: ys[r], w: (availW * cw[c]) / tw, h: (availH * rw[r]) / th });
  }
  return out;
}

export const inset = (r: Rect, m: Insets): Rect => ({
  x: r.x + m.left,
  y: r.y + m.top,
  w: Math.max(0, r.w - m.left - m.right),
  h: Math.max(0, r.h - m.top - m.bottom),
});

/** [x0,y0,x1,y1,…] for points whose x and y are finite. */
export function interleave(x: ArrayLike<number>, y: ArrayLike<number>): Float32Array {
  const out = new Float32Array(2 * x.length);
  let o = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      out[o++] = x[i];
      out[o++] = y[i];
    }
  }
  return out.slice(0, o);
}

/** Vertex pairs for gl.LINES from NaN-separated polylines. */
export function polylineSegments(x: ArrayLike<number>, y: ArrayLike<number>): Float32Array {
  const out = new Float32Array(4 * Math.max(0, x.length - 1));
  let o = 0;
  for (let i = 1; i < x.length; i++) {
    if (Number.isFinite(x[i - 1]) && Number.isFinite(y[i - 1]) && Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      out[o++] = x[i - 1];
      out[o++] = y[i - 1];
      out[o++] = x[i];
      out[o++] = y[i];
    }
  }
  return out.slice(0, o);
}

/** Two triangles per bar; horizontal bars swap x and y. */
export function barTriangles(x0: number, dx: number, heights: ArrayLike<number>, horizontal: boolean): Float32Array {
  const out = new Float32Array(12 * heights.length);
  for (let i = 0; i < heights.length; i++) {
    const a = x0 + i * dx;
    const b = a + dx;
    const h = heights[i];
    const quad = [a, 0, b, 0, b, h, a, 0, b, h, a, h];
    for (let k = 0; k < 12; k += 2) {
      out[12 * i + k] = horizontal ? quad[k + 1] : quad[k];
      out[12 * i + k + 1] = horizontal ? quad[k] : quad[k + 1];
    }
  }
  return out;
}

const GREY: Rgba = [0.5, 0.5, 0.5, 1];

/** CSS colour (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()) → RGBA in 0..1. */
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

export const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

export const toCss = (c: Rgba): string => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;
```

- [ ] **Step 4: Implement the Plot and the renderer contract**

`packages/extension/src/webview/plot/plot.ts`:
```ts
import { AXIS_INSET, BARE_INSET, barTriangles, gridRects, inset, interleave, parseColor, polylineSegments, toCss, withAlpha, type Rect } from './geometry';
import type { Layer, Panel, Rgba, Scene } from './scene';
import { formatTick, niceTicks } from './ticks';
import { panRange, zoomRange, type Range } from './view';

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
export interface Plot {
  setScene(scene: Scene): void;
  onClick(listener: (e: PlotClick) => void): void;
  theme(): Theme;
  dispose(): void;
}

const VS = `#version 300 es
in vec2 a_pos;
uniform vec2 u_min;
uniform vec2 u_max;
uniform float u_size;
void main() {
  gl_Position = vec4((a_pos - u_min) / (u_max - u_min) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = u_size;
}`;
const FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform float u_round;
out vec4 outColor;
void main() {
  if (u_round > 0.5 && length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
  outColor = u_color;
}`;

interface GpuLayer {
  mode: number;
  buffer: WebGLBuffer;
  count: number;
  color: Rgba;
  size: number;
  round: boolean;
}
interface PanelState {
  panel: Panel;
  view: { x: Range; y: Range };
  gpu: GpuLayer[];
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile error');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'shader link error');
  return p;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    fg: parseColor(v('--vscode-editor-foreground', '#cccccc')),
    muted: parseColor(v('--vscode-descriptionForeground', '#888888')),
    bg: parseColor(v('--vscode-editor-background', '#1e1e1e')),
  };
}

export function createPlot(container: HTMLElement): Plot {
  const glCanvas = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  for (const c of [glCanvas, overlay]) Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
  overlay.style.pointerEvents = 'none';
  container.append(glCanvas, overlay);
  const gl = glCanvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is not available in this webview');
  const ctx = overlay.getContext('2d')!;
  const program = link(gl);
  const loc = {
    pos: gl.getAttribLocation(program, 'a_pos'),
    min: gl.getUniformLocation(program, 'u_min'),
    max: gl.getUniformLocation(program, 'u_max'),
    size: gl.getUniformLocation(program, 'u_size'),
    color: gl.getUniformLocation(program, 'u_color'),
    round: gl.getUniformLocation(program, 'u_round'),
  };
  const vao = gl.createVertexArray();
  let scene: Scene = { rows: 1, cols: 1, panels: [] };
  let panels: PanelState[] = [];
  let areas: Rect[] = [];
  const listeners: ((e: PlotClick) => void)[] = [];
  let pending = 0;

  const upload = (layer: Layer): GpuLayer => {
    const data =
      layer.kind === 'scatter' ? interleave(layer.x, layer.y)
      : layer.kind === 'lines' ? polylineSegments(layer.x, layer.y)
      : barTriangles(layer.x0, layer.dx, layer.heights, !!layer.horizontal);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return {
      mode: layer.kind === 'scatter' ? gl.POINTS : layer.kind === 'lines' ? gl.LINES : gl.TRIANGLES,
      buffer,
      count: data.length / 2,
      color: layer.color,
      size: layer.kind === 'scatter' ? layer.size : 1,
      round: layer.kind === 'scatter',
    };
  };
  const release = () => panels.forEach((p) => p.gpu.forEach((g) => gl.deleteBuffer(g.buffer)));

  const layout = () => {
    const cells = gridRects(container.clientWidth, container.clientHeight, scene.rows, scene.cols, 4, scene.colWeights, scene.rowWeights);
    areas = panels.map(({ panel }) => inset(cells[panel.row * scene.cols + panel.col] ?? { x: 0, y: 0, w: 0, h: 0 }, panel.axes === false ? BARE_INSET : AXIS_INSET));
  };

  const draw = () => {
    pending = 0;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const c of [glCanvas, overlay]) {
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
    }
    layout();
    const theme = readTheme();
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(loc.pos);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px sans-serif';
    panels.forEach((p, i) => {
      const a = areas[i];
      if (a.w < 2 || a.h < 2) return;
      const vx = Math.round(a.x * dpr);
      const vy = Math.round((h - a.y - a.h) * dpr);
      const vw = Math.round(a.w * dpr);
      const vh = Math.round(a.h * dpr);
      gl.viewport(vx, vy, vw, vh);
      gl.scissor(vx, vy, vw, vh);
      gl.uniform2f(loc.min, p.view.x.min, p.view.y.min);
      gl.uniform2f(loc.max, p.view.x.max, p.view.y.max);
      for (const g of p.gpu) {
        if (g.count === 0) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, g.buffer);
        gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4f(loc.color, g.color[0], g.color[1], g.color[2], g.color[3]);
        gl.uniform1f(loc.size, g.size * dpr);
        gl.uniform1f(loc.round, g.round ? 1 : 0);
        gl.drawArrays(g.mode, 0, g.count);
      }
      decorate(p, a, theme);
    });
    gl.disable(gl.SCISSOR_TEST);
    if (scene.message) {
      ctx.fillStyle = toCss(theme.muted);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '12px sans-serif';
      ctx.fillText(scene.message, w / 2, h / 2);
    }
  };

  const decorate = (p: PanelState, a: Rect, theme: Theme) => {
    const { x, y } = p.view;
    const px = (v: number) => a.x + ((v - x.min) / (x.max - x.min)) * a.w;
    const py = (v: number) => a.y + a.h - ((v - y.min) / (y.max - y.min)) * a.h;
    ctx.strokeStyle = toCss(withAlpha(theme.muted, 0.5));
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = toCss(withAlpha(theme.fg, 0.6));
    for (const v of p.panel.vlines ?? []) {
      ctx.beginPath();
      ctx.moveTo(px(v), a.y);
      ctx.lineTo(px(v), a.y + a.h);
      ctx.stroke();
    }
    for (const v of p.panel.hlines ?? []) {
      ctx.beginPath();
      ctx.moveTo(a.x, py(v));
      ctx.lineTo(a.x + a.w, py(v));
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = toCss(theme.muted);
    if (p.panel.title) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.panel.title, a.x + 2, a.y - 2);
    }
    if (p.panel.axes === false) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of niceTicks(x.min, x.max, Math.max(2, Math.floor(a.w / 60)))) ctx.fillText(formatTick(t), px(t), a.y + a.h + 3);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of niceTicks(y.min, y.max, Math.max(2, Math.floor(a.h / 30)))) ctx.fillText(formatTick(t), a.x - 3, py(t));
    if (p.panel.xLabel) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.panel.xLabel, a.x + a.w - 2, a.y + a.h - 2);
    }
    if (p.panel.yLabel) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(p.panel.yLabel, a.x + 3, a.y + 2);
    }
  };

  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(draw);
  };

  const hit = (ev: MouseEvent) => {
    const b = glCanvas.getBoundingClientRect();
    const cx = ev.clientX - b.left;
    const cy = ev.clientY - b.top;
    const i = areas.findIndex((a) => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h);
    if (i < 0) return undefined;
    const a = areas[i];
    const { x, y } = panels[i].view;
    return { i, a, dataX: x.min + ((cx - a.x) / a.w) * (x.max - x.min), dataY: y.max - ((cy - a.y) / a.h) * (y.max - y.min) };
  };

  glCanvas.addEventListener('wheel', (ev) => {
    const t = hit(ev);
    if (!t) return;
    ev.preventDefault();
    const p = panels[t.i];
    const f = Math.exp(ev.deltaY * 0.002);
    p.view = { x: zoomRange(p.view.x, f, t.dataX), y: ev.shiftKey ? p.view.y : zoomRange(p.view.y, f, t.dataY) };
    schedule();
  }, { passive: false });

  let drag: { i: number; a: Rect; sx: number; sy: number; view: PanelState['view']; moved: boolean } | undefined;
  glCanvas.addEventListener('mousedown', (ev) => {
    const t = hit(ev);
    if (t) drag = { i: t.i, a: t.a, sx: ev.clientX, sy: ev.clientY, view: panels[t.i].view, moved: false };
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.sx;
    const dy = ev.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    panels[drag.i].view = { x: panRange(drag.view.x, -dx / drag.a.w), y: panRange(drag.view.y, dy / drag.a.h) };
    schedule();
  });
  window.addEventListener('mouseup', (ev) => {
    if (drag && !drag.moved) {
      const t = hit(ev);
      if (t) for (const l of listeners) l({ panel: t.i, x: t.dataX, y: t.dataY, shift: ev.shiftKey, button: ev.button });
    }
    drag = undefined;
  });
  glCanvas.addEventListener('dblclick', (ev) => {
    const t = hit(ev);
    if (!t) return;
    const p = panels[t.i];
    p.view = { x: p.panel.x, y: p.panel.y };
    schedule();
  });

  const resize = new ResizeObserver(schedule);
  resize.observe(container);

  return {
    setScene(next) {
      release();
      scene = next;
      panels = next.panels.map((panel) => ({ panel, view: { x: panel.x, y: panel.y }, gpu: panel.layers.map(upload) }));
      schedule();
    },
    onClick(listener) {
      listeners.push(listener);
    },
    theme: readTheme,
    dispose() {
      resize.disconnect();
      if (pending) cancelAnimationFrame(pending);
      release();
      glCanvas.remove();
      overlay.remove();
    },
  };
}
```

`packages/extension/src/webview/plot/renderer.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import { parseColor } from './geometry';
import type { Plot, Theme } from './plot';
import type { Rgba, Scene } from './scene';

/** What a renderer can ask of its host (the plot webview shell). */
export interface RendererHost {
  /** Provider settings for this view; `setSettings` recomputes the view on the host. */
  readonly settings: Readonly<Record<string, unknown>>;
  setSettings(settings: Record<string, unknown>): void;
  /** Renderer-only UI state, persisted per dataset; no recompute. */
  getState<T>(): T | undefined;
  setState(state: unknown): void;
}

/** Webview half of a view (spec §6: { mount(el, plot), update(meta, buffers, selection), dispose() }). */
export interface ViewRenderer {
  mount(el: HTMLElement, plot: Plot, host: RendererHost): void;
  update(meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg): void;
  dispose(): void;
}

export type SceneBuilder = (meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme) => Scene;

/** Renderer for views with no interaction: rebuild the scene on every update. */
export function sceneRenderer(build: SceneBuilder): () => ViewRenderer {
  return () => {
    let plot: Plot | undefined;
    return {
      mount(_el, p) {
        plot = p;
      },
      update(meta, buffers, selection) {
        if (plot) plot.setScene(build(meta, buffers, selection, plot.theme()));
      },
      dispose() {
        plot = undefined;
      },
    };
  };
}

/** Small control strip pinned to the top-right of a view body. */
export function addToolbar(el: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'phy-toolbar';
  el.append(bar);
  return bar;
}

/** The Session colour of `id` within this selection (grey when not selected). */
export function colorOf(selection: SelectionMsg, id: number, alpha?: number): Rgba {
  const i = selection.ids.indexOf(id);
  return parseColor(i < 0 ? '#808080' : selection.colors[i], alpha);
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -w packages/extension -- plot` then `npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/webview/plot packages/extension/test/plot.test.ts
git commit -m "feat: WebGL2/Canvas2D plot layer with pure scene geometry"
```

---

### Task F3: ViewScheduler (visible-only, seq, cancellation)

**Files:**
- Create: `packages/extension/src/host/viewScheduler.ts`
- Test: `packages/extension/test/viewScheduler.test.ts`

**Interfaces:**
- Consumes: `Cancelled` (`src/views/types.ts`); `HostToPlot`, `SelectionMsg`, `ViewResult`, `CancellationToken` (`@theia-phy/api`).
- Produces:
  - `type RunView = (viewId, settings, token) => Promise<ViewResult>`
  - `toArrayBuffer(b: ArrayBufferLike): ArrayBuffer`
  - `class ViewScheduler` with:
    - `constructor(run, post: (m: HostToPlot) => void, selection: () => SelectionMsg, settings = {})`
    - `setVisible(viewIds)`, `selectionChanged()`, `setSettings(viewId, patch)`, `settingsOf(viewId)`, `refresh(viewId)`, `dispose()`

- [ ] **Step 1: Write the failing test**

`packages/extension/test/viewScheduler.test.ts`:
```ts
import type { CancellationToken, HostToPlot, ViewResult } from '@theia-phy/api';
import { describe, expect, it } from 'vitest';
import { toArrayBuffer, ViewScheduler } from '../src/host/viewScheduler';
import { Cancelled } from '../src/views/types';

interface Call {
  viewId: string;
  settings: Readonly<Record<string, unknown>>;
  token: CancellationToken;
  resolve(r: ViewResult): void;
  reject(e: unknown): void;
}
function harness(settings = {}) {
  const calls: Call[] = [];
  const posted: HostToPlot[] = [];
  let ids: number[] = [];
  const s = new ViewScheduler(
    (viewId, st, token) => new Promise((resolve, reject) => calls.push({ viewId, settings: st, token, resolve, reject })),
    (m) => posted.push(m),
    () => ({ ids, colors: ids.map(() => '#fff') }),
    settings,
  );
  const select = (next: number[]) => {
    ids = next;
    s.selectionChanged();
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { s, calls, posted, select, flush };
}
const result = (tag: number): ViewResult => ({ meta: { tag }, buffers: [new Float32Array([tag]).buffer] });

describe('ViewScheduler', () => {
  it('computes only visible views on selection change', () => {
    const { s, calls, select } = harness();
    s.setVisible(['waveform']);
    calls.length = 0;
    select([1]);
    expect(calls.map((c) => c.viewId)).toEqual(['waveform']);
  });

  it('drops stale results and cancels the superseded run', async () => {
    const { s, calls, posted, select, flush } = harness();
    s.setVisible(['waveform']);
    select([1]);
    select([2]);
    const [, first, second] = calls;
    expect(first.token.isCancellationRequested).toBe(true);
    second.resolve(result(2));
    first.resolve(result(1));
    await flush();
    const data = posted.filter((m) => m.type === 'viewData');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ viewId: 'waveform', meta: { tag: 2 }, selection: { ids: [2] } });
  });

  it('computes a view when it becomes visible, once per selection', () => {
    const { s, calls, select } = harness();
    select([1]);
    expect(calls).toHaveLength(0);
    s.setVisible(['feature']);
    s.setVisible(['feature']);
    expect(calls.map((c) => c.viewId)).toEqual(['feature']);
    s.setVisible([]);
    select([2]);
    s.setVisible(['feature']);
    expect(calls).toHaveLength(2);
  });

  it('merges settings and recomputes', () => {
    const { s, calls } = harness({ correlogram: { binSec: 0.001 } });
    s.setVisible(['correlogram']);
    s.setSettings('correlogram', { windowSec: 0.1 });
    expect(calls.at(-1)!.settings).toEqual({ binSec: 0.001, windowSec: 0.1 });
    expect(s.settingsOf('correlogram')).toEqual({ binSec: 0.001, windowSec: 0.1 });
  });

  it('posts provider errors but not cancellations', async () => {
    const { s, calls, posted, flush } = harness();
    s.setVisible(['amplitude', 'feature']);
    calls[0].reject(new Error('needs amplitudes.npy'));
    calls[1].reject(new Cancelled());
    await flush();
    expect(posted).toEqual([{ type: 'viewError', viewId: 'amplitude', seq: 1, message: 'needs amplitudes.npy' }]);
  });

  it('ignores results after dispose', async () => {
    const { s, calls, posted, flush } = harness();
    s.setVisible(['waveform']);
    s.dispose();
    expect(calls[0].token.isCancellationRequested).toBe(true);
    calls[0].resolve(result(1));
    await flush();
    expect(posted).toEqual([]);
    s.setVisible(['feature']);
    expect(calls).toHaveLength(1);
  });

  it('never posts shared memory', () => {
    const sab = new SharedArrayBuffer(8);
    const ab = toArrayBuffer(sab);
    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(ab.byteLength).toBe(8);
    const plain = new ArrayBuffer(4);
    expect(toArrayBuffer(plain)).toBe(plain);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- viewScheduler`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/extension/src/host/viewScheduler.ts`:
```ts
import type { CancellationToken, HostToPlot, SelectionMsg, ViewResult } from '@theia-phy/api';
import { Cancelled } from '../views/types';

export type RunView = (viewId: string, settings: Readonly<Record<string, unknown>>, token: CancellationToken) => Promise<ViewResult>;

class TokenSource {
  private cancelled = false;
  readonly token: CancellationToken;
  constructor() {
    const self = this;
    this.token = {
      get isCancellationRequested() {
        return self.cancelled;
      },
    };
  }
  cancel(): void {
    this.cancelled = true;
  }
}

/** Webviews accept plain ArrayBuffers only (no SharedArrayBuffer). */
export const toArrayBuffer = (b: ArrayBufferLike): ArrayBuffer => (b instanceof ArrayBuffer ? b : new Uint8Array(b).slice().buffer);

/**
 * Runs view providers for the visible views only. Every run gets a fresh seq and token; a newer run for the
 * same view cancels the older one, and only the newest result is posted (spec §4).
 */
export class ViewScheduler {
  private visible = new Set<string>();
  private seq = 0;
  private version = 0; // bumps on every selection change
  private readonly current = new Map<string, { seq: number; source: TokenSource }>();
  private readonly computedFor = new Map<string, number>(); // viewId → selection version last computed
  private readonly settings: Record<string, Record<string, unknown>>;
  private disposed = false;

  constructor(
    private readonly run: RunView,
    private readonly post: (m: HostToPlot) => void,
    private readonly selection: () => SelectionMsg,
    settings: Record<string, Record<string, unknown>> = {},
  ) {
    this.settings = { ...settings };
  }

  settingsOf(viewId: string): Record<string, unknown> {
    return this.settings[viewId] ?? {};
  }

  setVisible(viewIds: string[]): void {
    this.visible = new Set(viewIds);
    for (const id of viewIds) if (this.computedFor.get(id) !== this.version) this.refresh(id);
  }

  selectionChanged(): void {
    this.version++;
    for (const id of this.visible) this.refresh(id);
  }

  setSettings(viewId: string, patch: Record<string, unknown>): void {
    this.settings[viewId] = { ...this.settingsOf(viewId), ...patch };
    this.computedFor.delete(viewId);
    if (this.visible.has(viewId)) this.refresh(viewId);
  }

  refresh(viewId: string): void {
    if (this.disposed) return;
    this.current.get(viewId)?.source.cancel();
    const seq = ++this.seq;
    const source = new TokenSource();
    this.current.set(viewId, { seq, source });
    this.computedFor.set(viewId, this.version);
    const selection = this.selection();
    const isCurrent = () => !this.disposed && this.current.get(viewId)?.seq === seq;
    this.run(viewId, this.settingsOf(viewId), source.token).then(
      (r) => {
        if (isCurrent()) this.post({ type: 'viewData', viewId, seq, meta: r.meta, buffers: r.buffers.map(toArrayBuffer), selection });
      },
      (e: unknown) => {
        if (isCurrent() && !(e instanceof Cancelled)) this.post({ type: 'viewError', viewId, seq, message: e instanceof Error ? e.message : String(e) });
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.current.values()) c.source.cancel();
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w packages/extension -- viewScheduler`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/viewScheduler.ts packages/extension/test/viewScheduler.test.ts
git commit -m "feat: view scheduler with visible-only runs, seq and cancellation"
```

---

### Task F4: Plot webview shell, plot panel host, editor integration, view toggle, layout persistence

**Files:**
- Create: `packages/extension/src/webview/vscode.ts`
- Create: `packages/extension/src/webview/plot/main.ts`, `packages/extension/src/webview/plot/renderers.ts`
- Create: interim renderers `packages/extension/src/views/{waveform,feature,correlogram,amplitude,stats}/renderer.ts`
- Create: `packages/extension/src/host/plotPanel.ts`
- Modify: `packages/extension/src/host/editor.ts`, `packages/extension/src/host/html.ts` (replace `summaryHtml` by `datasetInfo`), `packages/extension/src/extension.ts`, `packages/extension/esbuild.mjs`, `packages/extension/.vscodeignore`, `packages/extension/package.json` (command `phy.view.toggle`)
- Test: `packages/extension/test/html.test.ts` (replace the summary test), `packages/extension/test/smoke/index.ts`

**Interfaces:**
- Consumes: F1 protocol and `webviewHtml`; F2 `createPlot`, `ViewRenderer`, `sceneRenderer`, `EMPTY`; F3 `ViewScheduler`; Plan 1 `builtinViews`, `Session`.
- Produces:
  - `src/host/plotPanel.ts`:
    - `Persisted`, `persistKey(paramsPath)`, `loadPersisted(state, paramsPath)`, `savePersisted(state, paramsPath, patch)`
    - `selectionMsg(session): SelectionMsg`, `RenderEntry`
    - `class PlotPanel { renderLog: RenderEntry[]; toggleView(viewId); dispose() }`
  - `src/host/html.ts`: `datasetInfo(session): string`. `summaryHtml` is removed.
  - `src/host/editor.ts`: `DatasetEditorProvider(ctx: { storage; extensionUri; state: vscode.Memento; compute: Compute })`, with `activeSession`, `activePanel` and `onDidChangeActiveSession`.
  - `src/webview/plot/renderers.ts`: `renderers: Record<string, () => ViewRenderer>`
  - `src/webview/vscode.ts`: `vscodeApi<S>(): VsCodeApi<S>`
  - Every `src/views/<view>/renderer.ts` default-exports `() => ViewRenderer`. These are the interim versions; lanes L2–L6 replace them.
  - `ExtensionApi` adds `renderLog(): readonly RenderEntry[]`.

- [ ] **Step 1: Update tests first**

In `packages/extension/test/html.test.ts`:
- Replace the import of `summaryHtml` with `datasetInfo`.
- Replace the test `'summarises a dataset including the raw-data reason'` with:
```ts
  it('summarises a dataset in one line including the raw-data reason', async () => {
    const { session, ds } = await openSession('noraw');
    const s = datasetInfo(session);
    expect(s).toContain(`${ds.nSpikes} spikes`);
    expect(s).toContain('5 clusters');
    expect(s).toMatch(/raw: raw data not found/);
  });
```

In `packages/extension/test/smoke/index.ts`, replace the body of `run()` with:
```ts
  const fixtures = process.env.PHY_FIXTURES!;
  const api = await vscode.extensions.getExtension<ExtensionApi>('theia-phy.theia-phy')!.activate();
  const views = ['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics'];
  /** Wait until every view rendered once after log index `from`; returns the latest entry per view. */
  const renderedAfter = (from: number) =>
    waitFor(() => {
      const log = api.renderLog().slice(from);
      const last = new Map(log.map((e) => [e.viewId, e]));
      return views.every((v) => last.has(v)) ? last : undefined;
    }, 'all views rendered');

  await vscode.commands.executeCommand('phy.openDataset', vscode.Uri.file(join(fixtures, 'base')));
  const session = await waitFor(() => api.activeSession(), 'base session');
  assert.equal(session.clusters.rows.length, 5);
  await renderedAfter(0); // empty selection renders a message in every view
  let mark = api.renderLog().length;
  session.select([7, 2]);
  for (const [v, e] of await renderedAfter(mark)) assert.equal(e.error, undefined, `${v}: ${e.error}`);
  for (const id of views) assert.ok((await api.runView(id)).buffers.length > 0, `${id} returned no buffers`);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => (api.activeSession() ? undefined : true), 'editor to close');
  await vscode.commands.executeCommand('phy.openDataset', vscode.Uri.file(join(fixtures, 'noraw')));
  const noraw = await waitFor(() => api.activeSession(), 'noraw session');
  mark = api.renderLog().length;
  noraw.select([7]);
  assert.equal((await renderedAfter(mark)).get('waveform')!.error, undefined);
  const meta = (await api.runView('waveform')).meta as { source: string; notice: string };
  assert.equal(meta.source, 'template');
  assert.match(meta.notice, /raw data not found/);

  // A dataset with only the required files: dependent views say what they need, the rest render.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => (api.activeSession() ? undefined : true), 'editor to close');
  await vscode.commands.executeCommand('phy.openDataset', vscode.Uri.file(join(fixtures, 'minimal')));
  const minimal = await waitFor(() => api.activeSession(), 'minimal session');
  mark = api.renderLog().length;
  minimal.select([0]);
  const m = await renderedAfter(mark);
  assert.match(m.get('amplitude')!.error ?? '', /needs amplitudes\.npy/);
  assert.match(m.get('waveform')!.error ?? '', /needs templates\.npy/);
  assert.equal(m.get('correlogram')!.error, undefined);
  assert.equal(m.get('cluster_statistics')!.error, undefined);
```

- [ ] **Step 2: Run the unit test and confirm it fails**

Run: `npm test -w packages/extension -- html`
Expected: FAIL (`datasetInfo` is not exported).

- [ ] **Step 3: Implement the host side**

In `packages/extension/src/host/html.ts`, replace `summaryHtml` with:
```ts
/** One-line dataset description for the Cluster view header. */
export function datasetInfo(session: Session): string {
  const ds = session.dataset;
  return [
    `${ds.nSpikes} spikes`,
    `${session.clusters.rows.length} clusters`,
    `${ds.nChannels} channels`,
    `${ds.duration.toFixed(1)} s`,
    `raw: ${ds.raw.ok ? 'ok' : ds.raw.reason}`,
  ].join(' · ');
}
```

`packages/extension/src/host/plotPanel.ts`:
```ts
import * as vscode from 'vscode';
import type { HostToPlot, PlotToHost, SelectionMsg, TableState } from '@theia-phy/api';
import type { Compute } from '../compute';
import { builtinViews } from '../views';
import { nonce, webviewHtml } from './html';
import type { Session } from './session';
import { ViewScheduler } from './viewScheduler';

/** Per-dataset UI state in workspaceState (spec §4 Persistence). */
export interface Persisted {
  layout?: unknown;
  settings: Record<string, Record<string, unknown>>;
  states: Record<string, unknown>;
  table?: TableState;
}
export const persistKey = (paramsPath: string): string => `theiaPhy:${paramsPath}`;
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

  constructor(private readonly panel: vscode.WebviewPanel, private readonly session: Session, private readonly ctx: PanelContext) {
    const webview = panel.webview;
    const root = vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [root] };
    webview.html = webviewHtml({
      cspSource: webview.cspSource,
      nonce: nonce(),
      title: 'Phy',
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'plot.js')).toString(),
    });
    this.scheduler = new ViewScheduler(
      (viewId, settings, token) => {
        const view = builtinViews.find((v) => v.id === viewId);
        if (!view) return Promise.reject(new Error(`unknown view ${viewId}`));
        return view.provider({ session, compute: ctx.compute, settings }, token);
      },
      (m) => this.post(m),
      () => selectionMsg(session),
      loadPersisted(ctx.state, session.dataset.paramsPath).settings,
    );
    this.subs.push(
      session.onDidChangeSelection(() => this.scheduler.selectionChanged()),
      webview.onDidReceiveMessage((m: PlotToHost) => this.onMessage(m)),
    );
  }

  toggleView(viewId: string): void {
    this.post({ type: 'toggleView', viewId });
  }

  private post(m: HostToPlot): void {
    void this.panel.webview.postMessage(m);
  }

  private onMessage(m: PlotToHost): void {
    const { state } = this.ctx;
    const paramsPath = this.session.dataset.paramsPath;
    switch (m.type) {
      case 'ready': {
        const saved = loadPersisted(state, paramsPath);
        this.post({ type: 'init', views: builtinViews.map(({ id, title }) => ({ id, title })), layout: saved.layout, settings: saved.settings, states: saved.states });
        break;
      }
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

Replace `packages/extension/src/host/editor.ts` with:
```ts
import * as vscode from 'vscode';
import type { Compute } from '../compute';
import { openDataset } from './dataset/dataset';
import { errorHtml } from './html';
import { PlotPanel } from './plotPanel';
import { Session } from './session';

class DatasetDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri, readonly session: Session | undefined, readonly error: string | undefined) {}
  dispose(): void {
    this.session?.dispose();
    void this.session?.dataset.close();
  }
}

export interface EditorContext {
  storage: vscode.Uri;
  extensionUri: vscode.Uri;
  state: vscode.Memento;
  compute: Compute;
}

export class DatasetEditorProvider implements vscode.CustomReadonlyEditorProvider<DatasetDocument> {
  activeSession: Session | undefined;
  activePanel: PlotPanel | undefined;
  private readonly activeEmitter = new vscode.EventEmitter<Session | undefined>();
  readonly onDidChangeActiveSession = this.activeEmitter.event;

  constructor(private readonly ctx: EditorContext) {}

  async openCustomDocument(uri: vscode.Uri): Promise<DatasetDocument> {
    try {
      const dataset = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Opening phy dataset' },
        (progress) =>
          openDataset(uri.fsPath, {
            cacheDir: vscode.Uri.joinPath(this.ctx.storage, 'cache').fsPath,
            onProgress: (message, f) => progress.report({ message: f === undefined ? message : `${message} ${Math.round(f * 100)}%` }),
          }),
      );
      if (dataset.metadataErrors.length) {
        void vscode.window.showWarningMessage(`Phy: skipped metadata ${dataset.metadataErrors.map((m) => `${m.file} (${m.error})`).join('; ')}`);
      }
      try {
        return new DatasetDocument(uri, new Session(dataset), undefined);
      } catch (e) {
        await dataset.close();
        throw e;
      }
    } catch (e) {
      return new DatasetDocument(uri, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  resolveCustomEditor(doc: DatasetDocument, panel: vscode.WebviewPanel): void {
    const session = doc.session;
    if (!session) {
      panel.webview.html = errorHtml(doc.error ?? 'unknown error');
      return;
    }
    const plot = new PlotPanel(panel, session, this.ctx);
    const activate = () => {
      this.activePanel = plot;
      this.setActive(session);
      void vscode.commands.executeCommand('setContext', 'phyDatasetActive', true);
    };
    activate();
    panel.onDidChangeViewState(() => {
      if (panel.active) activate();
      else if (this.activePanel === plot) void vscode.commands.executeCommand('setContext', 'phyDatasetActive', false);
    });
    panel.onDidDispose(() => {
      plot.dispose();
      if (this.activePanel === plot) {
        this.activePanel = undefined;
        this.setActive(undefined);
        void vscode.commands.executeCommand('setContext', 'phyDatasetActive', false);
      }
    });
  }

  private setActive(session: Session | undefined): void {
    if (this.activeSession === session) return;
    this.activeSession = session;
    this.activeEmitter.fire(session);
  }
}
```

In `packages/extension/src/extension.ts`, make these changes:
1. Construct the editor with `new DatasetEditorProvider({ storage: context.globalStorageUri, extensionUri: context.extensionUri, state: context.workspaceState, compute: pool })`.
2. Add `renderLog(): readonly RenderEntry[]` to `ExtensionApi`, implemented as `() => editor.activePanel?.renderLog ?? []`. Import `type RenderEntry` from `./host/plotPanel`.
3. Register the toggle command:
```ts
    vscode.commands.registerCommand('phy.view.toggle', async (viewId?: string) => {
      const id = viewId ?? (await vscode.window.showQuickPick(builtinViews.map((v) => ({ label: v.title, id: v.id })), { placeHolder: 'Show or hide a view' }))?.id;
      if (id) editor.activePanel?.toggleView(id);
    }),
```
In `packages/extension/package.json`:
- Add `{ "command": "phy.view.toggle", "title": "Phy: Toggle View…" }` to `contributes.commands`.
- Add `"menus": { "commandPalette": [{ "command": "phy.view.toggle", "when": "phyDatasetActive" }] }`.

- [ ] **Step 4: Implement the webview side**

`packages/extension/src/webview/vscode.ts`:
```ts
export interface VsCodeApi<S> {
  postMessage(message: unknown): void;
  getState(): S | undefined;
  setState(state: S): void;
}
declare function acquireVsCodeApi<S>(): VsCodeApi<S>;
/** Call once per webview page. */
export const vscodeApi = <S>(): VsCodeApi<S> => acquireVsCodeApi<S>();
```

Create one interim renderer per view. Lanes L2–L6 replace these files. `packages/extension/src/views/waveform/renderer.ts`:
```ts
import { sceneRenderer } from '../../webview/plot/renderer';
import { EMPTY } from '../../webview/plot/scene';

export default sceneRenderer((_meta, buffers, selection) => EMPTY(selection.ids.length ? `Waveform: ${buffers.length} buffers received` : 'Select a cluster'));
```
Create the same file for `feature`, `correlogram`, `amplitude` and `stats` (in `src/views/<folder>/renderer.ts`). Only the label differs: `Feature`, `Correlogram`, `Amplitude`, `Cluster statistics`.

`packages/extension/src/webview/plot/renderers.ts`:
```ts
import amplitude from '../../views/amplitude/renderer';
import correlogram from '../../views/correlogram/renderer';
import feature from '../../views/feature/renderer';
import stats from '../../views/stats/renderer';
import waveform from '../../views/waveform/renderer';
import { sceneRenderer, type ViewRenderer } from './renderer';
import { EMPTY } from './scene';

export const renderers: Record<string, () => ViewRenderer> = { waveform, feature, correlogram, amplitude, cluster_statistics: stats };
export const missingRenderer = sceneRenderer(() => EMPTY('No renderer for this view'));
```

`packages/extension/src/webview/plot/main.ts`:
```ts
import { createDockview, themeDark, themeLight, type DockviewApi, type GroupPanelPartInitParameters, type IContentRenderer, type SerializedDockview } from 'dockview-core';
import type { HostToPlot, PlotToHost } from '@theia-phy/api';
import { vscodeApi } from '../vscode';
import { createPlot, type Plot } from './plot';
import type { RendererHost, ViewRenderer } from './renderer';
import { missingRenderer, renderers } from './renderers';
import { EMPTY } from './scene';

interface LocalState {
  layout?: unknown;
  settings: Record<string, Record<string, unknown>>;
  states: Record<string, unknown>;
}
interface Slot {
  viewId: string;
  renderer: ViewRenderer;
  plot: Plot;
  header: HTMLElement;
  visible: boolean;
  lastSeq: number;
}

const vscode = vscodeApi<LocalState>();
const post = (m: PlotToHost) => vscode.postMessage(m);
const root = document.getElementById('root')!;
const slots = new Map<string, Slot>();
let local: LocalState = vscode.getState() ?? { settings: {}, states: {} };
let titles = new Map<string, string>();
let api: DockviewApi | undefined;

/** Default tiling: Waveform left; Feature, Correlogram, Amplitude, Cluster statistics around it. */
const DEFAULT_POSITION: Record<string, { referencePanel: string; direction: 'right' | 'below' } | undefined> = {
  waveform: undefined,
  feature: { referencePanel: 'waveform', direction: 'right' },
  correlogram: { referencePanel: 'feature', direction: 'below' },
  amplitude: { referencePanel: 'waveform', direction: 'below' },
  cluster_statistics: { referencePanel: 'correlogram', direction: 'right' },
};

const saveLocal = () => vscode.setState({ ...local, layout: api?.toJSON() });
const reportVisible = () => post({ type: 'visible', viewIds: [...slots.values()].filter((s) => s.visible).map((s) => s.viewId) });

function hostFor(viewId: string): RendererHost {
  return {
    get settings() {
      return local.settings[viewId] ?? {};
    },
    setSettings(settings) {
      local.settings = { ...local.settings, [viewId]: { ...local.settings[viewId], ...settings } };
      saveLocal();
      post({ type: 'viewEvent', viewId, payload: { kind: 'settings', settings } });
    },
    getState<T>() {
      return local.states[viewId] as T | undefined;
    },
    setState(state) {
      local.states = { ...local.states, [viewId]: state };
      saveLocal();
      post({ type: 'viewEvent', viewId, payload: { kind: 'state', state } });
    },
  };
}

class ViewPanel implements IContentRenderer {
  readonly element = document.createElement('div');
  private viewId = '';
  init(params: GroupPanelPartInitParameters): void {
    this.viewId = String(params.params.viewId);
    this.element.className = 'phy-view';
    const header = document.createElement('div');
    header.className = 'phy-header';
    const body = document.createElement('div');
    body.className = 'phy-body';
    this.element.append(header, body);
    const plot = createPlot(body);
    const renderer = (renderers[this.viewId] ?? missingRenderer)();
    const slot: Slot = { viewId: this.viewId, renderer, plot, header, visible: params.api.isVisible, lastSeq: 0 };
    slots.set(this.viewId, slot);
    renderer.mount(body, plot, hostFor(this.viewId));
    params.api.onDidVisibilityChange((e) => {
      slot.visible = e.isVisible;
      reportVisible();
    });
    reportVisible();
  }
  dispose(): void {
    const slot = slots.get(this.viewId);
    if (!slot) return;
    slot.renderer.dispose();
    slot.plot.dispose();
    slots.delete(this.viewId);
    reportVisible();
  }
}

function addView(id: string, position?: { referencePanel: string; direction: 'right' | 'below' }): void {
  if (!api || api.getPanel(id)) return;
  const usable = position && api.getPanel(position.referencePanel) ? position : undefined;
  api.addPanel({ id, component: 'view', title: titles.get(id) ?? id, params: { viewId: id }, ...(usable ? { position: usable } : {}) });
}

function init(m: Extract<HostToPlot, { type: 'init' }>): void {
  titles = new Map(m.views.map((v) => [v.id, v.title]));
  local = { settings: { ...m.settings, ...local.settings }, states: { ...m.states, ...local.states }, layout: local.layout ?? m.layout };
  if (api) return;
  api = createDockview(root, {
    createComponent: () => new ViewPanel(),
    theme: document.body.classList.contains('vscode-light') ? themeLight : themeDark,
  });
  let restored = false;
  if (local.layout) {
    try {
      api.fromJSON(local.layout as SerializedDockview);
      restored = true;
    } catch {
      api.clear();
    }
  }
  if (!restored) for (const v of m.views) addView(v.id, DEFAULT_POSITION[v.id]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  api.onDidLayoutChange(() => {
    saveLocal();
    clearTimeout(timer);
    timer = setTimeout(() => post({ type: 'persist', layout: api!.toJSON() }), 500);
  });
}

function setHeader(slot: Slot, text: string, error: boolean): void {
  slot.header.textContent = text;
  slot.header.classList.toggle('error', error);
}

window.addEventListener('message', (e: MessageEvent<HostToPlot>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      init(m);
      break;
    case 'viewData': {
      const slot = slots.get(m.viewId);
      if (!slot || m.seq < slot.lastSeq) return;
      slot.lastSeq = m.seq;
      const notice = (m.meta as { notice?: unknown } | null)?.notice;
      setHeader(slot, typeof notice === 'string' ? notice : '', false);
      try {
        slot.renderer.update(m.meta, m.buffers, m.selection);
        post({ type: 'rendered', viewId: m.viewId, seq: m.seq });
      } catch (err) {
        const message = `render error: ${err instanceof Error ? err.message : String(err)}`;
        setHeader(slot, message, true);
        post({ type: 'rendered', viewId: m.viewId, seq: m.seq, error: message });
      }
      break;
    }
    case 'viewError': {
      const slot = slots.get(m.viewId);
      if (!slot || m.seq < slot.lastSeq) return;
      slot.lastSeq = m.seq;
      setHeader(slot, m.message, true);
      slot.plot.setScene(EMPTY(m.message));
      post({ type: 'rendered', viewId: m.viewId, seq: m.seq, error: m.message });
      break;
    }
    case 'toggleView': {
      const panel = api?.getPanel(m.viewId);
      if (panel) api!.removePanel(panel);
      else addView(m.viewId);
      break;
    }
  }
});

post({ type: 'ready' });
```

In `packages/extension/esbuild.mjs`:
- Add a browser config:
  ```js
  const web = { bundle: true, platform: 'browser', format: 'iife', target: 'es2022', sourcemap: true, logLevel: 'info' };
  ```
- Add this build to the `Promise.all` list:
  ```js
  build({ ...web, entryPoints: ['src/webview/plot/main.ts'], outfile: 'dist/webview/plot.js' })
  ```

In `packages/extension/.vscodeignore`, add the line `!dist/webview/**`.

- [ ] **Step 5: Run the unit tests, typecheck, build and the smoke test**

Run: `npm test` then `npm run typecheck` then `npm run test:smoke -w packages/extension`
Expected:
- **Unit tests:** all pass.
- **Typecheck:** clean.
- **Smoke test:** exit code 0. The render log shows all five views for `base`, the waveform rendering for `noraw`, and the "needs" errors for `minimal`.

If the smoke test times out waiting for renders, debug the webview with **Developer: Open Webview Developer Tools** in the F5 dev host.

- [ ] **Step 6: Manual check**

Press F5, open the `base` fixture folder (`packages/extension/test/fixtures/out/base`) and select clusters with the smoke API, or use the sidebar once F5 lands. Check these four things:
- the five tiles appear and can be dragged and docked;
- the interim message updates on selection;
- the layout survives closing and reopening the dataset;
- **Phy: Toggle View…** removes and re-adds a tile.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/webview packages/extension/src/views/*/renderer.ts packages/extension/src/host/plotPanel.ts packages/extension/src/host/editor.ts packages/extension/src/host/html.ts packages/extension/src/extension.ts packages/extension/esbuild.mjs packages/extension/.vscodeignore packages/extension/package.json packages/extension/test/html.test.ts packages/extension/test/smoke/index.ts
git commit -m "feat: tiled plot editor with scheduler, toggle and layout persistence"
```

---

### Task F5: Cluster sidebar host, minimal sidebar, selection commands and keys

**Files:**
- Create: `packages/extension/src/shared/order.ts`, `packages/extension/src/host/clusterView.ts`, `packages/extension/src/webview/sidebar/main.ts` (minimal; L1 replaces it), `packages/extension/media/phy.svg`
- Modify: `packages/extension/src/extension.ts`, `packages/extension/package.json`, `packages/extension/esbuild.mjs`, `packages/extension/.vscodeignore`
- Test: `packages/extension/test/order.test.ts`, `packages/extension/test/smoke/index.ts`

**Interfaces:**
- Consumes: F1 protocol, `datasetInfo`, `webviewHtml`; F4 `loadPersisted`, `savePersisted`, `selectionMsg`.
- Produces:
  - `stepSelection(order: number[], selected: readonly number[], delta: 1 | -1, extend: boolean): number[] | undefined`. Lane L1 reuses it for ↑/↓.
  - `class ClusterViewProvider implements vscode.WebviewViewProvider { setSession(s); step(delta) }`
  - Commands `phy.selectNext` and `phy.selectPrevious`, bound to Alt+↓ and Alt+↑ when `phyDatasetActive`.
  - The sidebar webview bundle `dist/webview/sidebar.js`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/order.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { stepSelection } from '../src/shared/order';

describe('stepSelection', () => {
  const order = [5, 2, 9];
  it('starts at the ends when nothing is selected', () => {
    expect(stepSelection(order, [], 1, false)).toEqual([5]);
    expect(stepSelection(order, [], -1, false)).toEqual([9]);
  });
  it('moves after the last selected cluster in the current order', () => {
    expect(stepSelection(order, [9, 5], 1, false)).toEqual([2]);
    expect(stepSelection(order, [2], -1, false)).toEqual([5]);
  });
  it('stops at the ends and on an empty order', () => {
    expect(stepSelection(order, [9], 1, false)).toBeUndefined();
    expect(stepSelection([], [], 1, false)).toBeUndefined();
  });
  it('extends the selection when asked', () => {
    expect(stepSelection(order, [5], 1, true)).toEqual([5, 2]);
  });
  it('restarts from the ends when the last selected cluster is filtered out', () => {
    expect(stepSelection(order, [42], 1, false)).toEqual([5]);
  });
});
```

Append to the smoke `run()`, just after the base session is asserted and before `session.select([7, 2])`:
```ts
  await vscode.commands.executeCommand('phy.selectNext');
  assert.deepEqual([...session.selection], [2]);
  await vscode.commands.executeCommand('phy.selectNext');
  assert.deepEqual([...session.selection], [7]);
  await vscode.commands.executeCommand('phy.selectPrevious');
  assert.deepEqual([...session.selection], [2]);
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- order`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/extension/src/shared/order.ts`:
```ts
/**
 * Next selection when stepping through `order` (the Cluster view's sorted+filtered ids): one step after the
 * last selected cluster; from the start/end when none is selected or it is not in `order`.
 */
export function stepSelection(order: number[], selected: readonly number[], delta: 1 | -1, extend: boolean): number[] | undefined {
  if (order.length === 0) return undefined;
  const last = selected[selected.length - 1];
  const i = last === undefined ? -1 : order.indexOf(last);
  const j = i < 0 ? (delta > 0 ? 0 : order.length - 1) : i + delta;
  if (j < 0 || j >= order.length) return undefined;
  const next = order[j];
  return extend ? [...selected.filter((x) => x !== next), next] : [next];
}
```

`packages/extension/src/host/clusterView.ts`:
```ts
import * as vscode from 'vscode';
import type { HostToSidebar, SidebarToHost } from '@theia-phy/api';
import { stepSelection } from '../shared/order';
import { datasetInfo, nonce, webviewHtml } from './html';
import { loadPersisted, savePersisted, selectionMsg } from './plotPanel';
import type { Session } from './session';

/** Sidebar Cluster view: shows the active dataset's cluster table and forwards selection intents. */
export class ClusterViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private session: Session | undefined;
  private order: number[] = [];
  private sub: vscode.Disposable | undefined;

  constructor(private readonly ctx: { extensionUri: vscode.Uri; state: vscode.Memento }) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const root = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [root] };
    view.webview.html = webviewHtml({
      cspSource: view.webview.cspSource,
      nonce: nonce(),
      title: 'Clusters',
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'sidebar.js')).toString(),
    });
    view.webview.onDidReceiveMessage((m: SidebarToHost) => this.onMessage(m));
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.view = view;
  }

  setSession(session: Session | undefined): void {
    if (session === this.session) return;
    this.sub?.dispose();
    this.session = session;
    this.order = session ? session.clusters.rows.map((r) => r[0] as number) : [];
    this.sub = session?.onDidChangeSelection(() => this.post({ type: 'selection', selection: selectionMsg(session) }));
    this.push();
  }

  step(delta: 1 | -1): void {
    const s = this.session;
    const next = s && stepSelection(this.order, s.selection, delta, false);
    if (s && next) s.select(next);
  }

  private push(): void {
    const s = this.session;
    if (!s) {
      this.post({ type: 'empty' });
      return;
    }
    const state = loadPersisted(this.ctx.state, s.dataset.paramsPath).table ?? {};
    this.post({ type: 'clusterTable', columns: s.clusters.columns, rows: s.clusters.rows, info: datasetInfo(s), state });
    this.post({ type: 'selection', selection: selectionMsg(s) });
  }

  private onMessage(m: SidebarToHost): void {
    const s = this.session;
    switch (m.type) {
      case 'ready':
        this.push();
        break;
      case 'select':
        s?.select(m.ids);
        break;
      case 'order':
        this.order = m.ids;
        break;
      case 'persist':
        if (s) savePersisted(this.ctx.state, s.dataset.paramsPath, { table: m.table });
        break;
    }
  }

  private post(m: HostToSidebar): void {
    void this.view?.webview.postMessage(m);
  }

  dispose(): void {
    this.sub?.dispose();
  }
}
```

Minimal sidebar, `packages/extension/src/webview/sidebar/main.ts`. Lane L1 replaces it with the full Cluster view.
```ts
import type { Cell, HostToSidebar, SelectionMsg, SidebarToHost } from '@theia-phy/api';
import { vscodeApi } from '../vscode';

const api = vscodeApi<unknown>();
const post = (m: SidebarToHost) => api.postMessage(m);
const root = document.getElementById('root')!;
root.style.overflow = 'auto';
let columns: string[] = [];
let rows: Cell[][] = [];
let info = '';
let selection: SelectionMsg = { ids: [], colors: [] };

function render(): void {
  if (!columns.length) {
    root.textContent = 'Open a phy dataset (Phy: Open Dataset…)';
    return;
  }
  const head = document.createElement('div');
  head.textContent = info;
  const table = document.createElement('table');
  const hr = table.insertRow();
  for (const c of columns) hr.insertCell().textContent = c;
  for (const r of rows) {
    const id = r[0] as number;
    const tr = table.insertRow();
    const si = selection.ids.indexOf(id);
    if (si >= 0) tr.style.background = 'var(--vscode-list-activeSelectionBackground)';
    for (const c of r) tr.insertCell().textContent = c === null ? '' : String(c);
    tr.onclick = (ev) => post({ type: 'select', ids: ev.ctrlKey || ev.metaKey ? [...selection.ids.filter((x) => x !== id), ...(si >= 0 ? [] : [id])] : [id] });
  }
  root.replaceChildren(head, table);
}

window.addEventListener('message', (e: MessageEvent<HostToSidebar>) => {
  const m = e.data;
  if (m.type === 'clusterTable') ({ columns, rows, info } = m);
  else if (m.type === 'selection') selection = m.selection;
  else columns = [];
  render();
});
post({ type: 'ready' });
```

`packages/extension/media/phy.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12h4l2-6 3 12 3-9 2 3h6"/></svg>
```

In `packages/extension/package.json`:
- Extend `contributes` with the views container, the sidebar view, the keybindings, and the command-palette entries:
```json
"viewsContainers": { "activitybar": [{ "id": "theiaPhy", "title": "Phy", "icon": "media/phy.svg" }] },
"views": { "theiaPhy": [{ "type": "webview", "id": "theiaPhy.clusters", "name": "Clusters" }] },
"keybindings": [
  { "command": "phy.selectNext", "key": "alt+down", "when": "phyDatasetActive" },
  { "command": "phy.selectPrevious", "key": "alt+up", "when": "phyDatasetActive" }
]
```
- Add these commands:
  ```json
  { "command": "phy.selectNext", "title": "Phy: Select Next Cluster" }
  { "command": "phy.selectPrevious", "title": "Phy: Select Previous Cluster" }
  ```
- Add both to `menus.commandPalette` with `"when": "phyDatasetActive"`.

In `packages/extension/src/extension.ts`:
- Import `ClusterViewProvider`.
- After creating `editor`, add:
```ts
  const clusters = new ClusterViewProvider({ extensionUri: context.extensionUri, state: context.workspaceState });
  context.subscriptions.push(
    clusters,
    vscode.window.registerWebviewViewProvider('theiaPhy.clusters', clusters),
    editor.onDidChangeActiveSession((s) => clusters.setSession(s)),
    vscode.commands.registerCommand('phy.selectNext', () => clusters.step(1)),
    vscode.commands.registerCommand('phy.selectPrevious', () => clusters.step(-1)),
  );
```

In `packages/extension/esbuild.mjs`, add:
```js
build({ ...web, entryPoints: ['src/webview/sidebar/main.ts'], outfile: 'dist/webview/sidebar.js' })
```
In `.vscodeignore`, add `!media/**`.

- [ ] **Step 4: Run the tests and the smoke test**

Run: `npm test`, `npm run typecheck`, `npm run test:smoke -w packages/extension`
Expected: all pass. The smoke test now also checks `phy.selectNext`/`phy.selectPrevious`.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/shared packages/extension/src/host/clusterView.ts packages/extension/src/webview/sidebar packages/extension/media packages/extension/src/extension.ts packages/extension/package.json packages/extension/esbuild.mjs packages/extension/.vscodeignore packages/extension/test/order.test.ts packages/extension/test/smoke/index.ts
git commit -m "feat: cluster sidebar, selection commands and keybindings"
```

---

## Phase L — Parallel lanes

Dispatch all six lanes **in one message**. Each lane runs in its own git worktree, created with `isolation: "worktree"` from the F5 head. Each lane agent:
1. runs `npm install` in its worktree;
2. touches only the files its lane owns (see the ownership table);
3. follows its task's TDD steps;
4. runs `npm test` and `npm run typecheck`;
5. commits on its branch;
6. reports the branch name and commits.

If a foundation file needs changing, the lane reports `NEEDS_CONTEXT` instead of editing it.

### Task L1: Cluster view (virtualized table, sort, multi-select, keys, group tint, filter grammar)

**Files (owned):** `packages/extension/src/webview/sidebar/{main,table,filter,selection}.ts`, `packages/extension/test/sidebar.test.ts`

**Interfaces:**
- Consumes:
  - `HostToSidebar` / `SidebarToHost` / `TableState` / `SelectionMsg` / `Cell` (`@theia-phy/api`)
  - `vscodeApi` (`src/webview/vscode.ts`)
  - `stepSelection` (`src/shared/order.ts`)
- Produces:
  - `table.ts`: `sortRows(rows, col, descending)` (nulls last), `visibleRange(scrollTop, viewport, rowH, n, overscan = 5)`, `formatCell(c)`, `groupTint(g)`
  - `filter.ts`: `parseFilter(text, columns): { ok: true; test: RowTest | null } | { ok: false; error }`
  - `selection.ts`: `clickSelect(order, selected, anchor, id, { ctrl, shift }): { selected; anchor }`

- [ ] **Step 1: Write the failing test**

`packages/extension/test/sidebar.test.ts`:
```ts
import type { Cell } from '@theia-phy/api';
import { describe, expect, it } from 'vitest';
import { parseFilter } from '../src/webview/sidebar/filter';
import { clickSelect } from '../src/webview/sidebar/selection';
import { formatCell, groupTint, sortRows, visibleRange } from '../src/webview/sidebar/table';

const columns = ['id', 'n_spikes', 'group', 'ContamPct', 'KSLabel'];
const rows: Cell[][] = [
  [2, 250, 'good', 1.5, 'good'],
  [7, 130, 'mua', 20, 'mua'],
  [11, 30, 'noise', 85.4, 'mua'],
  [40, 200, 'good', 0, 'good'],
  [50, 1, null, null, 'mua'],
];
const ids = (rs: Cell[][]) => rs.map((r) => r[0]);
const filter = (text: string) => {
  const f = parseFilter(text, columns);
  if (!f.ok) throw new Error(f.error);
  return f.test ? ids(rows.filter(f.test)) : ids(rows);
};

describe('filter grammar', () => {
  it('compares numbers and words, with and binding tighter than or', () => {
    expect(filter('n_spikes > 100 and group == good')).toEqual([2, 40]);
    expect(filter('KSLabel == "mua" or ContamPct < 1')).toEqual([7, 11, 40, 50]);
    expect(filter('group == good or group == noise and n_spikes < 50')).toEqual([2, 11, 40]);
    expect(filter('  ')).toEqual([2, 7, 11, 40, 50]);
  });
  it('treats empty cells as matching only !=', () => {
    expect(filter('ContamPct >= 0')).toEqual([2, 7, 11, 40]);
    expect(filter('group != good')).toEqual([7, 11, 50]);
  });
  it('accepts quoted values with spaces and is case-insensitive for and/or', () => {
    expect(filter("group == 'good' OR id == 50")).toEqual([2, 40, 50]);
  });
  it('reports errors instead of evaluating anything', () => {
    expect(parseFilter('depth > 3', columns)).toEqual({ ok: false, error: "unknown column 'depth'" });
    expect(parseFilter('n_spikes >', columns)).toMatchObject({ ok: false, error: "expected a value after '>'" });
    expect(parseFilter('n_spikes ~ 3', columns).ok).toBe(false);
    expect(parseFilter('n_spikes > 3 junk', columns)).toMatchObject({ ok: false, error: "unexpected 'junk'" });
  });
});

describe('table', () => {
  it('sorts numbers and strings with empty cells last in both directions', () => {
    expect(ids(sortRows(rows, 3, false))).toEqual([40, 2, 7, 11, 50]);
    expect(ids(sortRows(rows, 3, true))).toEqual([11, 7, 2, 40, 50]);
    expect(ids(sortRows(rows, 2, false))).toEqual([2, 40, 7, 11, 50]);
  });
  it('renders only a window of rows for very large tables', () => {
    expect(visibleRange(0, 220, 22, 10_000)).toEqual({ start: 0, end: 15 });
    expect(visibleRange(22_000, 220, 22, 10_000)).toEqual({ start: 995, end: 1015 });
    expect(visibleRange(219_900, 220, 22, 10_000)).toEqual({ start: 9990, end: 10_000 });
  });
  it('sorts 10k rows quickly', () => {
    const big: Cell[][] = Array.from({ length: 10_000 }, (_, i) => [i, (i * 7919) % 10_007, i % 3 ? 'good' : 'mua']);
    const t = performance.now();
    sortRows(big, 1, true);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it('formats cells and tints rows by group', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(12)).toBe('12');
    expect(formatCell(3.14159)).toBe('3.142');
    expect(formatCell('mua')).toBe('mua');
    expect(groupTint('good')).toMatch(/^rgba\(134, 209, 109/);
    expect(groupTint(null)).toBe('');
  });
});

describe('clickSelect', () => {
  const order = [5, 2, 9, 4];
  it('replaces, toggles with ctrl, and ranges with shift from the anchor', () => {
    expect(clickSelect(order, [9], undefined, 2, { ctrl: false, shift: false })).toEqual({ selected: [2], anchor: 2 });
    expect(clickSelect(order, [2], 2, 9, { ctrl: true, shift: false })).toEqual({ selected: [2, 9], anchor: 9 });
    expect(clickSelect(order, [2, 9], 9, 2, { ctrl: true, shift: false })).toEqual({ selected: [9], anchor: 2 });
    expect(clickSelect(order, [2], 2, 4, { ctrl: false, shift: true })).toEqual({ selected: [2, 9, 4], anchor: 2 });
    expect(clickSelect(order, [9], 9, 5, { ctrl: false, shift: true })).toEqual({ selected: [9, 2, 5], anchor: 9 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- sidebar`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the pure modules**

`packages/extension/src/webview/sidebar/filter.ts`:
```ts
import type { Cell } from '@theia-phy/api';

export type RowTest = (row: Cell[]) => boolean;
export type FilterResult = { ok: true; test: RowTest | null } | { ok: false; error: string };
type Tok = { kind: 'op'; v: string } | { kind: 'word'; v: string; quoted: boolean };

function tokenize(s: string): Tok[] {
  const re = /\s*(?:(==|!=|<=|>=|<|>)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s=!<>"']+))/y;
  const out: Tok[] = [];
  let i = 0;
  while (s.slice(i).trim() !== '') {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`unexpected '${s.slice(i).trim()[0]}'`);
    i = re.lastIndex;
    if (m[1]) out.push({ kind: 'op', v: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ kind: 'word', v: (m[2] ?? m[3]).replace(/\\(.)/g, '$1'), quoted: true });
    else out.push({ kind: 'word', v: m[4], quoted: false });
  }
  return out;
}

function compare(cell: Cell, op: string, value: number | string): boolean {
  if (cell === null) return op === '!=';
  let c: number;
  if (typeof cell === 'number' && typeof value === 'number') c = cell - value;
  else {
    const a = String(cell);
    const b = String(value);
    c = a === b ? 0 : a < b ? -1 : 1;
  }
  switch (op) {
    case '==': return c === 0;
    case '!=': return c !== 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    default: return c >= 0;
  }
}

/** `<column> <op> <value>` terms joined by and/or (and binds tighter). Builds closures; never evaluates code. */
export function parseFilter(text: string, columns: string[]): FilterResult {
  try {
    const toks = tokenize(text);
    if (toks.length === 0) return { ok: true, test: null };
    let i = 0;
    const isKw = (t: Tok | undefined, kw: string) => t?.kind === 'word' && !t.quoted && t.v.toLowerCase() === kw;
    const cmp = (): RowTest => {
      const col = toks[i++];
      const op = toks[i++];
      const val = toks[i++];
      if (col?.kind !== 'word' || col.quoted) throw new Error('expected a column name');
      const ci = columns.indexOf(col.v);
      if (ci < 0) throw new Error(`unknown column '${col.v}'`);
      if (op?.kind !== 'op') throw new Error(`expected == != < <= > >= after '${col.v}'`);
      if (val?.kind !== 'word') throw new Error(`expected a value after '${op.v}'`);
      const value: number | string = !val.quoted && Number.isFinite(Number(val.v)) ? Number(val.v) : val.v;
      return (row) => compare(row[ci], op.v, value);
    };
    const term = (): RowTest => {
      let t = cmp();
      while (isKw(toks[i], 'and')) {
        i++;
        const a = t;
        const b = cmp();
        t = (r) => a(r) && b(r);
      }
      return t;
    };
    let e = term();
    while (isKw(toks[i], 'or')) {
      i++;
      const a = e;
      const b = term();
      e = (r) => a(r) || b(r);
    }
    if (i < toks.length) throw new Error(`unexpected '${toks[i].v}'`);
    return { ok: true, test: e };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
```

`packages/extension/src/webview/sidebar/table.ts`:
```ts
import type { Cell } from '@theia-phy/api';

/** Stable sort by one column; numbers numerically, strings lexically, empty cells last either way. */
export function sortRows(rows: Cell[][], col: number, descending: boolean): Cell[][] {
  const dir = descending ? -1 : 1;
  return [...rows].sort((ra, rb) => {
    const a = ra[col];
    const b = rb[col];
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
    const sa = String(a);
    const sb = String(b);
    return (sa === sb ? 0 : sa < sb ? -1 : 1) * dir;
  });
}

/** Row index window to render for a virtualized list. */
export function visibleRange(scrollTop: number, viewport: number, rowH: number, n: number, overscan = 5): { start: number; end: number } {
  return {
    start: Math.max(0, Math.floor(scrollTop / rowH) - overscan),
    end: Math.min(n, Math.ceil((scrollTop + viewport) / rowH) + overscan),
  };
}

export function formatCell(c: Cell): string {
  if (c === null) return '';
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(Number(c.toPrecision(4)));
  return c;
}

/** Row background by phy cluster group. */
export function groupTint(g: Cell): string {
  if (g === 'good') return 'rgba(134, 209, 109, 0.15)';
  if (g === 'mua') return 'rgba(128, 128, 128, 0.15)';
  if (g === 'noise') return 'rgba(102, 102, 102, 0.35)';
  return '';
}
```

`packages/extension/src/webview/sidebar/selection.ts`:
```ts
/** phy-style click selection over the visible `order`: plain replaces, ctrl toggles, shift ranges from the anchor. */
export function clickSelect(
  order: number[],
  selected: readonly number[],
  anchor: number | undefined,
  id: number,
  mods: { ctrl: boolean; shift: boolean },
): { selected: number[]; anchor: number } {
  if (mods.shift && anchor !== undefined) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      return { selected: a <= b ? range : range.reverse(), anchor };
    }
  }
  if (mods.ctrl) return { selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], anchor: id };
  return { selected: [id], anchor: id };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w packages/extension -- sidebar`
Expected: PASS.

- [ ] **Step 5: Implement the Cluster view DOM**

Replace `packages/extension/src/webview/sidebar/main.ts`:
```ts
import type { Cell, HostToSidebar, SelectionMsg, SidebarToHost, TableState } from '@theia-phy/api';
import { stepSelection } from '../../shared/order';
import { vscodeApi } from '../vscode';
import { parseFilter } from './filter';
import { clickSelect } from './selection';
import { formatCell, groupTint, sortRows, visibleRange } from './table';

const ROW_H = 22;
const api = vscodeApi<TableState>();
const post = (m: SidebarToHost) => api.postMessage(m);
const root = document.getElementById('root')!;

const style = document.createElement('style');
style.textContent = `
#root{display:flex;flex-direction:column;font-size:12px}
.info{padding:4px 6px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.filter{margin:0 6px 4px;padding:2px 4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}
.filter.error{border-color:var(--vscode-inputValidation-errorBorder,red)}
.hdr,.row{display:grid;grid-template-columns:var(--cols);align-items:center}
.hdr{font-weight:600;border-bottom:1px solid var(--vscode-panel-border,#444);cursor:pointer;user-select:none}
.hdr>div,.row>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scroll{flex:1;overflow:auto;position:relative;outline:none}
.row{position:absolute;left:0;right:0;height:${ROW_H}px;cursor:default;border-left:3px solid transparent}
.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.empty{padding:8px;color:var(--vscode-descriptionForeground)}`;
document.head.append(style);

const info = Object.assign(document.createElement('div'), { className: 'info' });
const filterInput = Object.assign(document.createElement('input'), { className: 'filter', placeholder: 'filter, e.g. n_spikes > 100 and group == good' });
const header = Object.assign(document.createElement('div'), { className: 'hdr' });
const scroller = Object.assign(document.createElement('div'), { className: 'scroll', tabIndex: 0 });
const spacer = document.createElement('div');
const body = document.createElement('div');
scroller.append(spacer, body);

let columns: string[] = [];
let rows: Cell[][] = [];
let view: Cell[][] = [];
let state: TableState = api.getState() ?? {};
let selection: SelectionMsg = { ids: [], colors: [] };
let anchor: number | undefined;

const order = () => view.map((r) => r[0] as number);

function persist(): void {
  api.setState(state);
  post({ type: 'persist', table: state });
}

function recompute(): void {
  const f = parseFilter(state.filter ?? '', columns);
  filterInput.classList.toggle('error', !f.ok);
  filterInput.title = f.ok ? '' : f.error;
  let out = f.ok && f.test ? rows.filter(f.test) : rows;
  const ci = state.sort ? columns.indexOf(state.sort.column) : -1;
  if (ci >= 0) out = sortRows(out, ci, state.sort!.descending);
  view = out;
  post({ type: 'order', ids: order() });
}

function renderHeader(): void {
  root.style.setProperty('--cols', `repeat(${columns.length}, minmax(48px, 1fr))`);
  header.replaceChildren(
    ...columns.map((c) => {
      const d = document.createElement('div');
      const arrow = state.sort?.column === c ? (state.sort.descending ? ' ▼' : ' ▲') : '';
      d.textContent = c + arrow;
      d.title = c;
      d.onclick = () => {
        state = { ...state, sort: { column: c, descending: state.sort?.column === c ? !state.sort.descending : false } };
        persist();
        recompute();
        renderHeader();
        renderRows();
      };
      return d;
    }),
  );
}

function renderRows(): void {
  spacer.style.height = `${view.length * ROW_H}px`;
  const { start, end } = visibleRange(scroller.scrollTop, scroller.clientHeight, ROW_H, view.length);
  const gi = columns.indexOf('group');
  const els: HTMLElement[] = [];
  for (let i = start; i < end; i++) {
    const r = view[i];
    const id = r[0] as number;
    const el = document.createElement('div');
    el.className = 'row';
    el.style.top = `${i * ROW_H}px`;
    const si = selection.ids.indexOf(id);
    if (si >= 0) {
      el.classList.add('selected');
      el.style.borderLeftColor = selection.colors[si];
    } else {
      el.style.background = groupTint(gi >= 0 ? r[gi] : null);
    }
    el.replaceChildren(
      ...r.map((c) => {
        const d = document.createElement('div');
        d.textContent = formatCell(c);
        return d;
      }),
    );
    el.onclick = (ev) => {
      const res = clickSelect(order(), selection.ids, anchor, id, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey });
      anchor = res.anchor;
      post({ type: 'select', ids: res.selected });
    };
    els.push(el);
  }
  body.replaceChildren(...els);
}

function scrollTo(id: number): void {
  const i = order().indexOf(id);
  if (i < 0) return;
  const top = i * ROW_H;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H - scroller.clientHeight;
}

scroller.addEventListener('scroll', renderRows);
new ResizeObserver(renderRows).observe(scroller);
scroller.addEventListener('keydown', (ev) => {
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
  ev.preventDefault();
  const next = stepSelection(order(), selection.ids, ev.key === 'ArrowDown' ? 1 : -1, ev.shiftKey);
  if (!next) return;
  anchor = ev.shiftKey ? anchor : next[next.length - 1];
  post({ type: 'select', ids: next });
  scrollTo(next[next.length - 1]);
});
let debounce: ReturnType<typeof setTimeout> | undefined;
filterInput.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state = { ...state, filter: filterInput.value };
    persist();
    recompute();
    renderRows();
  }, 150);
});

window.addEventListener('message', (e: MessageEvent<HostToSidebar>) => {
  const m = e.data;
  if (m.type === 'clusterTable') {
    ({ columns, rows } = m);
    info.textContent = m.info;
    state = { ...m.state, ...api.getState() };
    filterInput.value = state.filter ?? '';
    root.replaceChildren(info, filterInput, header, scroller);
    recompute();
    renderHeader();
    renderRows();
  } else if (m.type === 'selection') {
    selection = m.selection;
    renderRows();
  } else {
    columns = [];
    rows = [];
    view = [];
    const empty = Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Open a phy dataset (Phy: Open Dataset…)' });
    root.replaceChildren(empty);
  }
});
post({ type: 'ready' });
```

Note: `api.getState()` is per sidebar webview, not per dataset. When the sidebar switches datasets, prefer the host's per-dataset `m.state` by clearing local state on a dataset change. Do that by keying it on `m.info`: store `{ ...state, key: m.info }` and ignore stale local state whose `key` differs. If you take this route, add `key?: string` to the local-state type here; do not change `TableState` in the api package.

- [ ] **Step 6: Run all tests, typecheck and build; then check manually**

Run: `npm test`, `npm run typecheck`, `npm run build`
Expected: pass.

Then press F5, open the `base` fixture and check:
- sorting by each column, then sorting again to reverse;
- Ctrl+click and Shift+click selection;
- ↑/↓ and Shift+↓ navigation;
- the filter `n_spikes > 100 and group == good`, and that an invalid filter gives a red border with a tooltip;
- group tints;
- the filter and sort survive reopening the dataset.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/webview/sidebar packages/extension/test/sidebar.test.ts
git commit -m "feat: virtualized cluster view with sort, filter grammar and multi-select"
```

---

### Task L2: Waveform renderer (probe layout, spikes + mean, mean-only and template toggles)

**Files (owned):** `packages/extension/src/views/waveform/{provider,scene,renderer}.ts`, `packages/extension/test/waveform.test.ts`, `packages/extension/test/scene-waveform.test.ts`

**Interfaces:**
- Consumes: F2 `Scene`, `EMPTY`, `Layer`, `parseColor`, `withAlpha`, `colorOf`, `addToolbar`, `ViewRenderer`, `Theme`, `Plot`; Plan 1 `WaveformMeta`.
- Produces:
  - The provider adds a third buffer per cluster: the template. This is the mean unwhitened template on the cluster's channels, scaled by the mean amplitude, with shape `templateSamples × nCh`. It adds `templateSamples: number` to `WaveformMeta`.
  - `buildWaveformScene(meta, buffers, selection, theme, opts: WaveformOptions): Scene`
  - `boxSize(positions, channels): { w; h }`
  - `WaveformOptions { meanOnly: boolean; showTemplate: boolean }`

- [ ] **Step 1: Write the failing tests**

`packages/extension/test/scene-waveform.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { LinesLayer } from '../src/webview/plot/scene';
import { boxSize, buildWaveformScene } from '../src/views/waveform/scene';
import type { WaveformMeta } from '../src/views/waveform/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const sel = { ids: [7], colors: ['#ff0000'] };
// 1 cluster on channels 0 (0,0) and 1 (0,20); 3 samples; 1 spike.
const meta: WaveformMeta = {
  source: 'raw', nSamples: 3, templateSamples: 2, channelPositions: [0, 0, 0, 20],
  clusters: [{ id: 7, channels: [0, 1], spikeIds: [3] }],
};
const mean = Float32Array.from([0, 0, -2, 1, 0, 0]); // (nS × nCh): ch0 [0,-2,0], ch1 [0,1,0]
const buffers = [mean.slice().buffer, mean.slice().buffer, Float32Array.from([1, 1, 1, 1]).buffer];
const arr = (a: Float32Array) => Array.from(a, (v) => (Number.isNaN(v) ? null : Number(v.toFixed(3))));

describe('waveform scene', () => {
  it('sizes boxes from the probe spacing', () => {
    expect(boxSize([0, 0, 0, 20], [0, 1])).toEqual({ w: 36, h: 18 });
    expect(boxSize([0, 0, 16, 0, 0, 20], [0, 1, 2]).w).toBeCloseTo(14.4);
  });

  it('draws each channel at its probe position, spikes faint and the mean opaque', () => {
    const s = buildWaveformScene(meta, buffers, sel, theme, { meanOnly: false, showTemplate: false });
    expect(s.panels).toHaveLength(1);
    const p = s.panels[0];
    expect(p.axes).toBe(false);
    expect(p.x).toEqual({ min: -36, max: 36 });
    expect(p.y).toEqual({ min: -18, max: 38 });
    const [spikes, m] = p.layers as LinesLayer[];
    expect(spikes.color[3]).toBeCloseTo(0.15);
    expect(m.color).toEqual([1, 0, 0, 1]);
    // yScale = (18/2)/max|mean| = 4.5
    expect(arr(m.x)).toEqual([-18, 0, 18, null, -18, 0, 18, null]);
    expect(arr(m.y)).toEqual([0, -9, 0, null, 20, 24.5, 20, null]);
  });

  it('honours mean-only and template overlay', () => {
    const s = buildWaveformScene(meta, buffers, sel, theme, { meanOnly: true, showTemplate: true });
    const layers = s.panels[0].layers as LinesLayer[];
    expect(layers).toHaveLength(2);
    expect(arr(layers[1].x)).toEqual([-18, 18, null, -18, 18, null]);
  });

  it('shows a message for an empty selection', () => {
    expect(buildWaveformScene({ ...meta, clusters: [] }, [], { ids: [], colors: [] }, theme, { meanOnly: false, showTemplate: false }).message).toBe('Select a cluster');
  });
});
```

In `packages/extension/test/waveform.test.ts`:
- In the test `'handles an empty selection and a single-spike cluster'`, change `expect(r.buffers).toHaveLength(2);` to `expect(r.buffers).toHaveLength(3);`.
- Append:
```ts
  it('adds the cluster template on its channels, scaled by the mean amplitude', async () => {
    const { session, ds } = await openSession('noraw', [7]);
    const r = await waveformView.provider(viewContext(session), live);
    const meta = r.meta as WaveformMeta;
    expect(meta.templateSamples).toBe(NS_TEMPLATE);
    const c = meta.clusters[0];
    const tmpl = new Float32Array(r.buffers[2]);
    expect(tmpl).toHaveLength(NS_TEMPLATE * c.channels.length);
    const mean = golden('templates.json').base['7'].mean as number[][];
    const amp = c.spikeIds.reduce((s, id) => s + ds.amplitudes![id], 0) / c.spikeIds.length;
    expect(tmpl[10 * c.channels.length]).toBeCloseTo(mean[10][c.channels[0]] * amp, 2);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -w packages/extension -- waveform`
Expected: FAIL. `scene.ts` is missing and the provider has no template buffer.

- [ ] **Step 3: Implement the provider change**

In `packages/extension/src/views/waveform/provider.ts`:
- add `templateSamples: number;` to `WaveformMeta`;
- set `templateSamples: ds.templates.nSamples` when building `meta`;
- replace the `buffers.push(...)` line inside the cluster loop with:
```ts
      buffers.push(wf.buffer, meanWaveform(wf, ids.length, nSamples * channels.length).buffer, templateOnChannels(ctx, id, ids, channels).buffer);
```
Then append:
```ts
/** Mean unwhitened template of the cluster on `channels`, scaled by the mean amplitude of the sampled spikes. */
function templateOnChannels(ctx: HostViewContext, id: number, ids: Int32Array, channels: Int32Array): Float32Array {
  const { session } = ctx;
  const ds = session.dataset;
  const m = session.meanTemplate(id);
  if (!m || !ds.templates) return new Float32Array(0);
  let amp = 1;
  if (ds.amplitudes && ids.length) {
    amp = 0;
    for (const s of ids) amp += ds.amplitudes[s];
    amp /= ids.length;
  }
  const ns = ds.templates.nSamples;
  const nc = channels.length;
  const out = new Float32Array(ns * nc);
  for (let s = 0; s < ns; s++) for (let j = 0; j < nc; j++) out[s * nc + j] = m[s * ds.nChannels + channels[j]] * amp;
  return out;
}
```

- [ ] **Step 4: Implement the scene and the renderer**

`packages/extension/src/views/waveform/scene.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import { withAlpha } from '../../webview/plot/geometry';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Layer, type Scene } from '../../webview/plot/scene';
import type { WaveformMeta } from './provider';

export interface WaveformOptions {
  meanOnly: boolean;
  showTemplate: boolean;
}

const BUFFERS_PER_CLUSTER = 3; // waveforms, mean, template

/** Box per channel: 90 % of the smallest spacing between distinct x (and y) positions; 40 µm when single. */
export function boxSize(positions: number[], channels: number[]): { w: number; h: number } {
  const gap = (axis: 0 | 1) => {
    const v = [...new Set(channels.map((c) => positions[2 * c + axis]))].sort((a, b) => a - b);
    let g = Infinity;
    for (let i = 1; i < v.length; i++) g = Math.min(g, v[i] - v[i - 1]);
    return Number.isFinite(g) ? g : 40;
  };
  return { w: 0.9 * gap(0), h: 0.9 * gap(1) };
}

/** phy Waveform view: every channel's traces drawn in a box at its probe position. */
export function buildWaveformScene(meta: WaveformMeta, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme, opts: WaveformOptions): Scene {
  if (meta.clusters.length === 0) return EMPTY('Select a cluster');
  const pos = meta.channelPositions;
  const all = [...new Set(meta.clusters.flatMap((c) => c.channels))];
  if (all.length === 0) return EMPTY('No channels for this selection');
  const box = boxSize(pos, all);
  const means = meta.clusters.map((_, k) => new Float32Array(buffers[k * BUFFERS_PER_CLUSTER + 1]));
  let maxAbs = 0;
  for (const m of means) for (const v of m) if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
  const yScale = maxAbs > 0 ? box.h / 2 / maxAbs : 1;
  const xs = all.map((c) => pos[2 * c]);
  const ys = all.map((c) => pos[2 * c + 1]);
  const layers: Layer[] = [];

  meta.clusters.forEach((cluster, k) => {
    const nc = cluster.channels.length;
    const traces = (data: Float32Array, nTraces: number, nSamp: number) => {
      const n = nTraces * nc * (nSamp + 1);
      const x = new Float32Array(n);
      const y = new Float32Array(n);
      let o = 0;
      for (let t = 0; t < nTraces; t++) {
        for (let j = 0; j < nc; j++) {
          const cx = pos[2 * cluster.channels[j]];
          const cy = pos[2 * cluster.channels[j] + 1];
          for (let s = 0; s < nSamp; s++) {
            x[o] = cx - box.w / 2 + (nSamp > 1 ? (box.w * s) / (nSamp - 1) : 0);
            y[o] = cy + data[(t * nSamp + s) * nc + j] * yScale;
            o++;
          }
          x[o] = NaN;
          y[o] = NaN;
          o++;
        }
      }
      return { x, y };
    };
    const color = colorOf(selection, cluster.id);
    if (!opts.meanOnly && cluster.spikeIds.length) {
      layers.push({ kind: 'lines', ...traces(new Float32Array(buffers[k * BUFFERS_PER_CLUSTER]), cluster.spikeIds.length, meta.nSamples), color: withAlpha(color, 0.15) });
    }
    layers.push({ kind: 'lines', ...traces(means[k], 1, meta.nSamples), color });
    const tmpl = new Float32Array(buffers[k * BUFFERS_PER_CLUSTER + 2] ?? new ArrayBuffer(0));
    if (opts.showTemplate && tmpl.length && meta.templateSamples) {
      layers.push({ kind: 'lines', ...traces(tmpl, 1, meta.templateSamples), color: withAlpha(theme.fg, 0.7) });
    }
  });

  return {
    rows: 1,
    cols: 1,
    panels: [
      {
        row: 0,
        col: 0,
        x: { min: Math.min(...xs) - box.w, max: Math.max(...xs) + box.w },
        y: { min: Math.min(...ys) - box.h, max: Math.max(...ys) + box.h },
        layers,
        axes: false,
      },
    ],
  };
}
```

Replace `packages/extension/src/views/waveform/renderer.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import type { Plot } from '../../webview/plot/plot';
import { addToolbar, type RendererHost, type ViewRenderer } from '../../webview/plot/renderer';
import type { WaveformMeta } from './provider';
import { buildWaveformScene, type WaveformOptions } from './scene';

export default (): ViewRenderer => {
  let plot: Plot | undefined;
  let host: RendererHost | undefined;
  let last: { meta: WaveformMeta; buffers: ArrayBuffer[]; selection: SelectionMsg } | undefined;
  const opts = (): WaveformOptions => ({ meanOnly: false, showTemplate: false, ...host?.getState<Partial<WaveformOptions>>() });
  const redraw = () => {
    if (plot && last) plot.setScene(buildWaveformScene(last.meta, last.buffers, last.selection, plot.theme(), opts()));
  };
  return {
    mount(el, p, h) {
      plot = p;
      host = h;
      const bar = addToolbar(el);
      for (const [key, label] of [['meanOnly', 'mean only'], ['showTemplate', 'template']] as const) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = opts()[key];
        box.onchange = () => {
          h.setState({ ...opts(), [key]: box.checked });
          redraw();
        };
        const lab = document.createElement('label');
        lab.append(box, ` ${label}`);
        bar.append(lab);
      }
    },
    update(meta, buffers, selection) {
      last = { meta: meta as WaveformMeta, buffers, selection };
      redraw();
    },
    dispose() {
      last = undefined;
      plot = undefined;
    },
  };
};
```

- [ ] **Step 5: Run the tests, typecheck and build; check manually**

Run: `npm test`, `npm run typecheck`, `npm run build`
Expected: pass.

Then press F5, open the `base` fixture, select clusters 7 and 2, and check:
- faint spikes with an opaque mean, laid out in probe geometry;
- both toggles work and persist;
- wheel zoom, drag pan and double-click reset;
- for the `noraw` fixture, the header shows the "showing templates" notice.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/views/waveform packages/extension/test/waveform.test.ts packages/extension/test/scene-waveform.test.ts
git commit -m "feat: waveform view with probe layout, mean and template overlay"
```

---

### Task L3: Feature renderer (phy 4×4 grid, background spikes, click to change axes)

**Files (owned):** `packages/extension/src/views/feature/{scene,renderer}.ts`, `packages/extension/test/scene-feature.test.ts`

**Interfaces:**
- Consumes: F2 plot layer; Plan 1 `FeatureMeta`. The buffers per group are `[features (n × nCh × nPcs, NaN when absent), times (n, s)]`, and group 0 is the background.
- Produces:
  - `DEFAULT_GRID: string[][]`
  - `parseDim(s): Dim`, `formatDim(d): string`
  - `dimValues(d, feats, times, nCh, nPcs): Float32Array`
  - `cycleDim(s, by: 'pc' | 'channel', nCh, nPcs): string`
  - `buildFeatureScene(meta, buffers, selection, theme, grid = DEFAULT_GRID): Scene`

- [ ] **Step 1: Write the failing test**

`packages/extension/test/scene-feature.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { ScatterLayer } from '../src/webview/plot/scene';
import { buildFeatureScene, cycleDim, DEFAULT_GRID, dimValues, parseDim } from '../src/views/feature/scene';
import type { FeatureMeta } from '../src/views/feature/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
// 2 channels × 2 PCs; background 1 spike, cluster 7 with 2 spikes.
const meta: FeatureMeta = { channels: [12, 13], nPcs: 2, groups: [{ id: null, n: 1 }, { id: 7, n: 2 }] };
const bgF = Float32Array.from([1, 2, 3, NaN]);
const bgT = Float32Array.from([0.5]);
const cF = Float32Array.from([10, 20, 30, 40, 11, 21, 31, 41]);
const cT = Float32Array.from([1, 2]);
const buffers = [bgF.buffer, bgT.buffer, cF.buffer, cT.buffer];
const sel = { ids: [7], colors: ['#00ff00'] };

describe('feature scene', () => {
  it('parses and cycles grid dimensions', () => {
    expect(parseDim('time')).toEqual({ kind: 'time' });
    expect(parseDim('1B')).toEqual({ kind: 'pc', ch: 1, pc: 1 });
    expect(() => parseDim('x')).toThrow(/bad feature dimension/);
    expect(cycleDim('0A', 'pc', 2, 3)).toBe('0B');
    expect(cycleDim('0C', 'pc', 2, 3)).toBe('0A');
    expect(cycleDim('1A', 'channel', 2, 3)).toBe('0A');
    expect(cycleDim('time', 'pc', 2, 3)).toBe('time');
  });

  it('reads PC values and times, NaN when out of range', () => {
    expect(Array.from(dimValues(parseDim('1A'), cF, cT, 2, 2))).toEqual([30, 31]);
    expect(Array.from(dimValues(parseDim('time'), cF, cT, 2, 2))).toEqual([1, 2]);
    expect(Array.from(dimValues(parseDim('0C'), cF, cT, 2, 2)).every(Number.isNaN)).toBe(true);
  });

  it('builds phy’s 4×4 grid with a grey background and coloured clusters', () => {
    const s = buildFeatureScene(meta, buffers, sel, theme);
    expect([s.rows, s.cols, s.panels.length]).toEqual([4, 4, 16]);
    const cell = s.panels[1]; // "1A,0A"
    expect(cell.title).toBe('ch13A / ch12A');
    const [bg, c7] = cell.layers as ScatterLayer[];
    expect(Array.from(bg.x)).toEqual([3]);
    expect(Array.from(c7.y)).toEqual([10, 11]);
    expect(bg.color[3]).toBeCloseTo(0.35);
    expect(c7.color).toEqual([0, 1, 0, 0.8]);
    expect(s.panels[0].title).toBe('time / ch12A');
  });

  it('shows a message for an empty selection', () => {
    expect(buildFeatureScene({ channels: [], nPcs: 0, groups: [] }, [], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });

  it('keeps the default grid shape', () => {
    expect(DEFAULT_GRID.map((r) => r.length)).toEqual([4, 4, 4, 4]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- scene-feature`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/extension/src/views/feature/scene.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import { withAlpha } from '../../webview/plot/geometry';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Layer, type Panel, type Scene } from '../../webview/plot/scene';
import { paddedRange } from '../../webview/plot/view';
import type { FeatureMeta } from './provider';

export type Dim = { kind: 'time' } | { kind: 'pc'; ch: number; pc: number };

/** phy's default feature grid: "<x>,<y>" per cell; <ch index><PC letter> or "time". */
export const DEFAULT_GRID: string[][] = [
  ['time,0A', '1A,0A', '0B,0A', '1B,0A'],
  ['0A,1A', 'time,1A', '0B,1A', '1B,1A'],
  ['0A,0B', '1A,0B', 'time,0B', '1B,0B'],
  ['0A,1B', '1A,1B', '0B,1B', 'time,1B'],
];

export function parseDim(s: string): Dim {
  if (s === 'time') return { kind: 'time' };
  const m = /^(\d+)([A-Z])$/.exec(s);
  if (!m) throw new Error(`bad feature dimension '${s}'`);
  return { kind: 'pc', ch: Number(m[1]), pc: m[2].charCodeAt(0) - 65 };
}

export const formatDim = (d: Dim): string => (d.kind === 'time' ? 'time' : `${d.ch}${String.fromCharCode(65 + d.pc)}`);

export function dimValues(d: Dim, feats: Float32Array, times: Float32Array, nCh: number, nPcs: number): Float32Array {
  if (d.kind === 'time') return times;
  const out = new Float32Array(times.length);
  if (d.ch >= nCh || d.pc >= nPcs) return out.fill(NaN);
  for (let i = 0; i < times.length; i++) out[i] = feats[(i * nCh + d.ch) * nPcs + d.pc];
  return out;
}

export function cycleDim(s: string, by: 'pc' | 'channel', nCh: number, nPcs: number): string {
  const d = parseDim(s);
  if (d.kind === 'time') return s;
  return formatDim(by === 'pc' ? { ...d, pc: (d.pc + 1) % Math.max(1, nPcs) } : { ...d, ch: (d.ch + 1) % Math.max(1, nCh) });
}

export function buildFeatureScene(meta: FeatureMeta, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme, grid: string[][] = DEFAULT_GRID): Scene {
  if (meta.groups.length === 0 || meta.nPcs === 0) return EMPTY('Select a cluster');
  const nCh = meta.channels.length;
  const nPcs = meta.nPcs;
  const groups = meta.groups.map((g, k) => ({ g, feats: new Float32Array(buffers[2 * k]), times: new Float32Array(buffers[2 * k + 1]) }));
  const label = (d: Dim) => (d.kind === 'time' ? 'time' : `ch${meta.channels[d.ch] ?? '?'}${String.fromCharCode(65 + d.pc)}`);
  const panels: Panel[] = [];
  grid.forEach((row, r) =>
    row.forEach((cell, c) => {
      const [sx, sy] = cell.split(',');
      const dx = parseDim(sx);
      const dy = parseDim(sy);
      const xs: Float32Array[] = [];
      const ys: Float32Array[] = [];
      const layers: Layer[] = groups.map(({ g, feats, times }) => {
        const x = dimValues(dx, feats, times, nCh, nPcs);
        const y = dimValues(dy, feats, times, nCh, nPcs);
        xs.push(x);
        ys.push(y);
        return g.id === null
          ? { kind: 'scatter', x, y, color: withAlpha(theme.muted, 0.35), size: 2 }
          : { kind: 'scatter', x, y, color: colorOf(selection, g.id, 0.8), size: 3 };
      });
      panels.push({ row: r, col: c, x: paddedRange(...xs), y: paddedRange(...ys), layers, axes: false, title: `${label(dx)} / ${label(dy)}` });
    }),
  );
  return { rows: grid.length, cols: grid[0]?.length ?? 0, panels };
}
```

Note the test's background layer: `x` for cell `1A,0A` is `dimValues('1A')`. That gives `[3]` because the background spike's value at `(ch1, pc0)` is 3. The scatter's NaN filtering happens at upload (`interleave`), so the scene keeps raw arrays.

Replace `packages/extension/src/views/feature/renderer.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import type { Plot } from '../../webview/plot/plot';
import type { RendererHost, ViewRenderer } from '../../webview/plot/renderer';
import type { FeatureMeta } from './provider';
import { buildFeatureScene, cycleDim, DEFAULT_GRID } from './scene';

/** Click a subplot to cycle its y feature's PC; shift-click cycles its channel. */
export default (): ViewRenderer => {
  let plot: Plot | undefined;
  let host: RendererHost | undefined;
  let last: { meta: FeatureMeta; buffers: ArrayBuffer[]; selection: SelectionMsg } | undefined;
  const grid = (): string[][] => host?.getState<{ grid: string[][] }>()?.grid ?? DEFAULT_GRID;
  const redraw = () => {
    if (plot && last) plot.setScene(buildFeatureScene(last.meta, last.buffers, last.selection, plot.theme(), grid()));
  };
  return {
    mount(_el, p, h) {
      plot = p;
      host = h;
      p.onClick((e) => {
        if (!last) return;
        const g = grid().map((row) => [...row]);
        const cols = g[0].length;
        const r = Math.floor(e.panel / cols);
        const c = e.panel % cols;
        const [x, y] = g[r][c].split(',');
        g[r][c] = `${x},${cycleDim(y, e.shift ? 'channel' : 'pc', last.meta.channels.length, last.meta.nPcs)}`;
        h.setState({ grid: g });
        redraw();
      });
    },
    update(meta, buffers, selection) {
      last = { meta: meta as FeatureMeta, buffers, selection };
      redraw();
    },
    dispose() {
      last = undefined;
      plot = undefined;
    },
  };
};
```

- [ ] **Step 4: Run all tests, typecheck and build; check manually**

Run: `npm test`, `npm run typecheck`, `npm run build`
Expected: pass.

Then press F5, open `base`, select clusters 7 and 2, and check:
- the grey background with coloured clusters, and time on the diagonal;
- click and shift-click change a subplot's y axis, and the change persists;
- zoom and pan per subplot.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/views/feature/scene.ts packages/extension/src/views/feature/renderer.ts packages/extension/test/scene-feature.test.ts
git commit -m "feat: feature view with phy grid, background spikes and axis cycling"
```

---

### Task L4: Correlogram renderer (n×n bars, refractory and baseline guides, bin/window controls)

**Files (owned):** `packages/extension/src/views/correlogram/{scene,renderer}.ts`, `packages/extension/test/scene-correlogram.test.ts`

**Interfaces:**
- Consumes: F2 plot layer; Plan 1 `CorrelogramMeta`, which carries `clusters`, `binSec`, `windowSec`, `nBins`, `firingRates` and `baseline` (n×n), plus one buffer, `Int32Array` n×n×nBins.
- Produces:
  - `REFRACTORY_MS = 2`
  - `buildCorrelogramScene(meta, buffers, selection, theme): Scene`
  - Renderer controls call `host.setSettings({ binSec, windowSec })`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/scene-correlogram.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { BarsLayer } from '../src/webview/plot/scene';
import { buildCorrelogramScene } from '../src/views/correlogram/scene';
import type { CorrelogramMeta } from '../src/views/correlogram/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const meta: CorrelogramMeta = { clusters: [7, 2], binSec: 0.001, windowSec: 0.005, nBins: 5, firingRates: [10, 20], baseline: [0.5, 1, 1, 2] };
const counts = Int32Array.from({ length: 20 }, (_, i) => i);
const sel = { ids: [7, 2], colors: ['#ff0000', '#0000ff'] };

describe('correlogram scene', () => {
  it('lays out an n×n grid of centred bars with refractory and baseline guides', () => {
    const s = buildCorrelogramScene(meta, [counts.buffer], sel, theme);
    expect([s.rows, s.cols, s.panels.length]).toEqual([2, 2, 4]);
    const p01 = s.panels[1];
    const bars = p01.layers[0] as BarsLayer;
    expect(bars.x0).toBeCloseTo(-2.5);
    expect(bars.dx).toBeCloseTo(1);
    expect(Array.from(bars.heights)).toEqual([5, 6, 7, 8, 9]);
    expect(p01.x).toEqual({ min: -2.5, max: 2.5 });
    expect(p01.y.max).toBeCloseTo(9 * 1.05);
    expect(p01.vlines).toEqual([-2, 2]);
    expect(p01.hlines).toEqual([1]);
    expect(p01.title).toBe('2');
    expect((s.panels[0].layers[0] as BarsLayer).color).toEqual([1, 0, 0, 1]); // auto-correlogram in cluster colour
    expect((s.panels[3].layers[0] as BarsLayer).color).toEqual([0, 0, 1, 1]);
    expect((p01.layers[0] as BarsLayer).color[3]).toBeCloseTo(0.55);
    expect(s.panels[2].title).toBeUndefined();
  });

  it('never makes a degenerate y range', () => {
    const s = buildCorrelogramScene({ ...meta, clusters: [7], baseline: [0], nBins: 5 }, [new Int32Array(5).buffer], { ids: [7], colors: ['#ff0000'] }, theme);
    expect(s.panels[0].y).toEqual({ min: 0, max: 1.05 });
  });

  it('shows a message for an empty selection', () => {
    expect(buildCorrelogramScene({ ...meta, clusters: [] }, [new ArrayBuffer(0)], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- scene-correlogram`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/extension/src/views/correlogram/scene.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import { withAlpha } from '../../webview/plot/geometry';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Panel, type Scene } from '../../webview/plot/scene';
import type { CorrelogramMeta } from './provider';

export const REFRACTORY_MS = 2;

/** n×n auto/cross-correlograms; bars centred on 0 lag, in ms. */
export function buildCorrelogramScene(meta: CorrelogramMeta, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme): Scene {
  const n = meta.clusters.length;
  if (n === 0) return EMPTY('Select a cluster');
  const counts = new Int32Array(buffers[0]);
  const nb = meta.nBins;
  const binMs = meta.binSec * 1000;
  const half = (nb * binMs) / 2;
  const showAxes = n <= 3;
  const panels: Panel[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const heights = Float32Array.from(counts.subarray((i * n + j) * nb, (i * n + j + 1) * nb));
      const base = meta.baseline[i * n + j] ?? 0;
      let ymax = base;
      for (const v of heights) if (v > ymax) ymax = v;
      panels.push({
        row: i,
        col: j,
        x: { min: -half, max: half },
        y: { min: 0, max: (ymax > 0 ? ymax : 1) * 1.05 },
        layers: [{ kind: 'bars', x0: -half, dx: binMs, heights, color: i === j ? colorOf(selection, meta.clusters[i]) : withAlpha(theme.fg, 0.55) }],
        vlines: [-REFRACTORY_MS, REFRACTORY_MS],
        hlines: [base],
        axes: showAxes,
        title: i === 0 ? String(meta.clusters[j]) : undefined,
        xLabel: showAxes && i === n - 1 ? 'ms' : undefined,
      });
    }
  }
  return { rows: n, cols: n, panels };
}
```

Replace `packages/extension/src/views/correlogram/renderer.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import type { Plot } from '../../webview/plot/plot';
import { addToolbar, type RendererHost, type ViewRenderer } from '../../webview/plot/renderer';
import type { CorrelogramMeta } from './provider';
import { buildCorrelogramScene } from './scene';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Bin and window inputs (ms) recompute on the host via provider settings; values are clamped to sane ranges. */
export default (): ViewRenderer => {
  let plot: Plot | undefined;
  let bin: HTMLInputElement | undefined;
  let win: HTMLInputElement | undefined;
  return {
    mount(el, p, host: RendererHost) {
      plot = p;
      const bar = addToolbar(el);
      const input = (label: string, value: unknown, fallback: number) => {
        const i = document.createElement('input');
        i.type = 'number';
        i.step = 'any';
        i.value = String(typeof value === 'number' ? value * 1000 : fallback);
        const l = document.createElement('label');
        l.append(`${label} `, i);
        bar.append(l);
        return i;
      };
      bin = input('bin ms', host.settings.binSec, 1);
      win = input('window ms', host.settings.windowSec, 50);
      const apply = () => {
        const b = clamp(Number(bin!.value) || 1, 0.1, 100);
        const w = clamp(Number(win!.value) || 50, 2 * b, 2000);
        bin!.value = String(b);
        win!.value = String(w);
        host.setSettings({ binSec: b / 1000, windowSec: w / 1000 });
      };
      bin.onchange = apply;
      win.onchange = apply;
    },
    update(meta, buffers, selection: SelectionMsg) {
      const m = meta as CorrelogramMeta;
      if (bin && document.activeElement !== bin) bin.value = String(m.binSec * 1000);
      if (win && document.activeElement !== win) win.value = String(m.windowSec * 1000);
      if (plot) plot.setScene(buildCorrelogramScene(m, buffers, selection, plot.theme()));
    },
    dispose() {
      plot = undefined;
    },
  };
};
```

- [ ] **Step 4: Run all tests, typecheck and build; check manually**

Run: `npm test`, `npm run typecheck`, `npm run build`
Expected: pass.

Then press F5, open `base`, select clusters 2, 7 and 40, and check:
- coloured auto-correlograms on the diagonal and grey cross-correlograms;
- dashed lines at ±2 ms and a baseline line;
- changing the bin to 2 ms recomputes, and the setting persists across reopen.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/views/correlogram/scene.ts packages/extension/src/views/correlogram/renderer.ts packages/extension/test/scene-correlogram.test.ts
git commit -m "feat: correlogram view with refractory/baseline guides and bin controls"
```

---

### Task L5: Amplitude renderer (amplitude vs time + marginal histogram)

**Files (owned):** `packages/extension/src/views/amplitude/{scene,renderer}.ts`, `packages/extension/test/scene-amplitude.test.ts`

**Interfaces:**
- Consumes: F2 plot layer; Plan 1 `AmplitudeMeta`, whose buffers per cluster are `[times s, amplitudes]`; Plan 1 `histogram` (`src/compute/histograms.ts`, pure).
- Produces: `AMP_BINS = 50`, `buildAmplitudeScene(meta, buffers, selection, theme): Scene`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/scene-amplitude.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { BarsLayer, ScatterLayer } from '../src/webview/plot/scene';
import { AMP_BINS, buildAmplitudeScene } from '../src/views/amplitude/scene';
import type { AmplitudeMeta } from '../src/views/amplitude/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const meta: AmplitudeMeta = { clusters: [{ id: 7, n: 4 }] };
const times = Float32Array.from([0, 1, 2, 10]);
const amps = Float32Array.from([10, 20, 20, 30]);
const sel = { ids: [7], colors: ['#ff0000'] };

describe('amplitude scene', () => {
  it('plots amplitude over time with a marginal histogram sharing the y range', () => {
    const s = buildAmplitudeScene(meta, [times.buffer, amps.buffer], sel, theme);
    expect([s.rows, s.cols, s.colWeights]).toEqual([1, 2, [4, 1]]);
    const [main, side] = s.panels;
    expect((main.layers[0] as ScatterLayer).y).toEqual(amps);
    expect(main.x).toEqual({ min: -0.5, max: 10.5 });
    expect(main.y).toEqual({ min: 9, max: 31 });
    expect(side.y).toEqual(main.y);
    expect(side.axes).toBe(false);
    const hist = side.layers[0] as BarsLayer;
    expect(hist.horizontal).toBe(true);
    expect(hist.heights).toHaveLength(AMP_BINS);
    expect(Math.max(...hist.heights)).toBe(1);
    expect(hist.heights.reduce((a, b) => a + b, 0)).toBeCloseTo(4 / 2); // counts normalised by the peak bin (2)
  });

  it('shows a message for an empty selection', () => {
    expect(buildAmplitudeScene({ clusters: [] }, [], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- scene-amplitude`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/extension/src/views/amplitude/scene.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import { histogram } from '../../compute/histograms';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Layer, type Scene } from '../../webview/plot/scene';
import { paddedRange } from '../../webview/plot/view';
import type { AmplitudeMeta } from './provider';

export const AMP_BINS = 50;

export function buildAmplitudeScene(meta: AmplitudeMeta, buffers: ArrayBuffer[], selection: SelectionMsg, _theme: Theme): Scene {
  if (meta.clusters.length === 0) return EMPTY('Select a cluster');
  const times = meta.clusters.map((_, k) => new Float32Array(buffers[2 * k]));
  const amps = meta.clusters.map((_, k) => new Float32Array(buffers[2 * k + 1]));
  const x = paddedRange(...times);
  const y = paddedRange(...amps);
  const dy = (y.max - y.min) / AMP_BINS;
  const scatter: Layer[] = meta.clusters.map((c, k) => ({ kind: 'scatter', x: times[k], y: amps[k], color: colorOf(selection, c.id, 0.6), size: 2 }));
  const hists: Layer[] = meta.clusters.map((c, k) => {
    const h = histogram(amps[k], y.min, y.max, AMP_BINS);
    let peak = 0;
    for (const v of h) if (v > peak) peak = v;
    return { kind: 'bars', x0: y.min, dx: dy, heights: Float32Array.from(h, (v) => v / (peak || 1)), color: colorOf(selection, c.id, 0.5), horizontal: true };
  });
  return {
    rows: 1,
    cols: 2,
    colWeights: [4, 1],
    panels: [
      { row: 0, col: 0, x, y, layers: scatter, xLabel: 'time (s)', yLabel: 'amplitude' },
      { row: 0, col: 1, x: { min: 0, max: 1.05 }, y, layers: hists, axes: false },
    ],
  };
}
```

Replace `packages/extension/src/views/amplitude/renderer.ts`:
```ts
import { sceneRenderer } from '../../webview/plot/renderer';
import type { AmplitudeMeta } from './provider';
import { buildAmplitudeScene } from './scene';

export default sceneRenderer((meta, buffers, selection, theme) => buildAmplitudeScene(meta as AmplitudeMeta, buffers, selection, theme));
```

- [ ] **Step 4: Run all tests, typecheck and build; check manually**

Run: `npm test`, `npm run typecheck`, `npm run build`
Expected: pass.

Then press F5 with the `base` fixture. Check that the scatter appears per cluster with a marginal histogram on the right. With the `minimal` fixture, check that the header says "needs amplitudes.npy".

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/views/amplitude/scene.ts packages/extension/src/views/amplitude/renderer.ts packages/extension/test/scene-amplitude.test.ts
git commit -m "feat: amplitude view with marginal histogram"
```

---

### Task L6: Cluster statistics renderer (stacked histogram panels)

**Files (owned):** `packages/extension/src/views/stats/{scene,renderer}.ts`, `packages/extension/test/scene-stats.test.ts`

**Interfaces:**
- Consumes: F2 plot layer; Plan 1 `StatsMeta`. Its buffers run histogram-major then cluster, as `Float64Array`. `range` gives the x extent and `unit` the x unit.
- Produces: `stepLine(h, x0, dx): { x; y: Float32Array }`, `buildStatsScene(meta, buffers, selection, theme): Scene`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/scene-stats.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { LinesLayer } from '../src/webview/plot/scene';
import { buildStatsScene, stepLine } from '../src/views/stats/scene';
import type { StatsMeta } from '../src/views/stats/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const meta: StatsMeta = {
  clusters: [7, 2],
  histograms: [
    { id: 'isi', label: 'ISI', unit: 'ms', range: [0, 50] },
    { id: 'firing_rate', label: 'Firing rate (Hz)', unit: 's' },
  ],
};
const h = (...v: number[]) => Float64Array.from(v).buffer;
const buffers = [h(1, 3), h(2, 0), h(4, 4, 4, 4), h(0, 1, 0, 1)];
const sel = { ids: [7, 2], colors: ['#ff0000', '#0000ff'] };

describe('stats scene', () => {
  it('draws step outlines', () => {
    const s = stepLine(Float64Array.from([1, 3]), 0, 25);
    expect(Array.from(s.x)).toEqual([0, 25, 25, 50]);
    expect(Array.from(s.y)).toEqual([1, 1, 3, 3]);
  });

  it('stacks one panel per histogram with one coloured outline per cluster', () => {
    const s = buildStatsScene(meta, buffers, sel, theme);
    expect([s.rows, s.cols]).toEqual([2, 1]);
    const [isi, fr] = s.panels;
    expect(isi.title).toBe('ISI');
    expect(isi.xLabel).toBe('ms');
    expect(isi.x).toEqual({ min: 0, max: 50 });
    expect(isi.y.max).toBeCloseTo(3 * 1.05);
    const [a, b] = isi.layers as LinesLayer[];
    expect(a.color).toEqual([1, 0, 0, 1]);
    expect(b.color).toEqual([0, 0, 1, 1]);
    expect(fr.x).toEqual({ min: 0, max: 4 }); // no range: bin indices
    expect(fr.row).toBe(1);
  });

  it('survives an empty range and all-zero histograms', () => {
    const s = buildStatsScene({ clusters: [7], histograms: [{ id: 'x', label: 'x', range: [3, 3] }] }, [h(0, 0)], { ids: [7], colors: ['#fff'] }, theme);
    expect(s.panels[0].x).toEqual({ min: 3, max: 4 });
    expect(s.panels[0].y).toEqual({ min: 0, max: 1.05 });
  });

  it('shows a message for an empty selection', () => {
    expect(buildStatsScene({ ...meta, clusters: [] }, [], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- scene-stats`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/extension/src/views/stats/scene.ts`:
```ts
import type { SelectionMsg } from '@theia-phy/api';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Panel, type Scene } from '../../webview/plot/scene';
import type { StatsMeta } from './provider';

/** Outline of a histogram as a polyline: each bin's top edge, joined by vertical steps. */
export function stepLine(h: Float64Array, x0: number, dx: number): { x: Float32Array; y: Float32Array } {
  const x = new Float32Array(2 * h.length);
  const y = new Float32Array(2 * h.length);
  for (let i = 0; i < h.length; i++) {
    x[2 * i] = x0 + i * dx;
    x[2 * i + 1] = x0 + (i + 1) * dx;
    y[2 * i] = h[i];
    y[2 * i + 1] = h[i];
  }
  return { x, y };
}

export function buildStatsScene(meta: StatsMeta, buffers: ArrayBuffer[], selection: SelectionMsg, _theme: Theme): Scene {
  const nc = meta.clusters.length;
  if (nc === 0 || meta.histograms.length === 0) return EMPTY('Select a cluster');
  const panels: Panel[] = meta.histograms.map((def, r) => {
    const hs = meta.clusters.map((_, k) => new Float64Array(buffers[r * nc + k] ?? new ArrayBuffer(0)));
    const nb = hs[0]?.length ?? 0;
    const [lo, hiRaw] = def.range ?? [0, nb];
    const hi = hiRaw > lo ? hiRaw : lo + 1;
    const dx = nb ? (hi - lo) / nb : 1;
    let ymax = 0;
    for (const h of hs) for (const v of h) if (v > ymax) ymax = v;
    return {
      row: r,
      col: 0,
      x: { min: lo, max: hi },
      y: { min: 0, max: (ymax > 0 ? ymax : 1) * 1.05 },
      layers: hs.map((h, k) => ({ kind: 'lines' as const, ...stepLine(h, lo, dx), color: colorOf(selection, meta.clusters[k]) })),
      title: def.label,
      xLabel: def.unit,
    };
  });
  return { rows: panels.length, cols: 1, panels };
}
```

Replace `packages/extension/src/views/stats/renderer.ts`:
```ts
import { sceneRenderer } from '../../webview/plot/renderer';
import type { StatsMeta } from './provider';
import { buildStatsScene } from './scene';

export default sceneRenderer((meta, buffers, selection, theme) => buildStatsScene(meta as StatsMeta, buffers, selection, theme));
```

- [ ] **Step 4: Run all tests, typecheck and build; check manually**

Run: `npm test`, `npm run typecheck`, `npm run build`
Expected: pass.

Then press F5 with `base` and select clusters 7 and 2. Check that the ISI panel (0–50 ms) and the firing-rate-over-time panel appear, with one outline per cluster in its selection colour.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/views/stats/scene.ts packages/extension/src/views/stats/renderer.ts packages/extension/test/scene-stats.test.ts
git commit -m "feat: cluster statistics view with stacked histograms"
```

---

## Phase I — Integration

### Task I1: Merge lanes, verify, screenshot, final review

**Files:**
- Modify: `README.md` (usage: sidebar, keys, view toggle)
- Create: `docs/screenshots/theia-phy-ui.png`

- [ ] **Step 1: Merge each lane branch into `theia-phy-ui`**

Merge in order L1–L6 with `git merge --no-ff <lane-branch>`. The ownership table makes the lanes conflict-free. If a conflict appears anyway, a lane edited a file outside its ownership: resolve it in favour of the owner and record it.

- [ ] **Step 2: Verify the integrated branch**

Run: `npm test`, `npm run typecheck`, `npm run build`, `npm run test:smoke -w packages/extension`
Expected: all pass, and the smoke render log is clean for `base` and `noraw`, with the expected "needs" errors for `minimal`.

- [ ] **Step 3: Screenshot on the real dataset**

1. Open `dataset/ks4-…/2026-05-07-R001A` in the dev host. Use `--dat` through a temp `params.py` override if you want raw waveforms; otherwise templates are shown with a notice.
2. Select the three largest clusters with Alt+↓ and Shift+↓ in the sidebar.
3. Capture the window with `screencapture -x -o -l <window id>`.
4. Save it as `docs/screenshots/theia-phy-ui.png`.

Check visually, in both a dark and a light theme:
- the waveforms sit at probe positions;
- the feature grid is populated;
- the correlogram guides are visible;
- the amplitude scatter has its marginal histogram;
- the ISI and firing-rate panels are drawn.

- [ ] **Step 4: README usage update**

Add to the **Usage** section:
> The **Phy** activity-bar icon opens the **Clusters** view, a sortable, filterable table of the active dataset.
> - **Selecting:** click to select, Ctrl/Cmd-click to add, Shift-click for a range; ↑/↓ move through the table and Shift+↑/↓ extend.
> - **Next/previous anywhere:** **Alt+↓ / Alt+↑** (`phy.selectNext` / `phy.selectPrevious`) select the next or previous cluster in the table's current order from anywhere in the dataset editor. You can rebind them in Keyboard Shortcuts.
> - **Filter syntax:** for example `n_spikes > 100 and group == good`.
>
> The dataset editor tiles the Waveform, Feature, Correlogram, Amplitude and Cluster statistics views.
> - **Layout:** drag tabs to re-dock. **Phy: Toggle View…** hides or shows a view.
> - **Interaction:** wheel zooms (Shift+wheel zooms x only), dragging pans, double-click resets.
> - **Persistence:** layout, table sort and filter, and view settings are remembered per dataset.

- [ ] **Step 5: Commit, then run the final whole-branch review**

```bash
git add README.md docs/screenshots/theia-phy-ui.png
git commit -m "docs: UI usage and screenshot"
```
Dispatch the final whole-branch review over `main..theia-phy-ui` on the most capable model. Then merge as the user chooses.

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| §4 message protocol: ready, select, viewEvent; clusterTable, selection, viewData, viewError | F1, F4, F5 |
| §4 stale-seq drop, cancellation, visible-only compute | F3 (scheduler) and F4 (webview `lastSeq` guard) |
| §4 commands `phy.openDataset`, `phy.selectNext`, `phy.selectPrevious`, `phy.view.toggle` with `phyDatasetActive` | Plan 1, F5, F4 |
| §4 persistence: layout, sort/filter, per-view settings in workspaceState by params.py path; webview setState | F4 (layout, settings, states), F5 (table) and L1 (table state) |
| §4 colours by selection order | Plan 1 Session → `SelectionMsg` → `colorOf` (F2) |
| §5 Cluster view: virtualized 10k+, sortable, Ctrl/Shift multi-select, ↑/↓, group tint, safe filter grammar | L1 |
| §5 Waveform: ≤100 spikes + mean at channel positions; toggles mean-only, template overlay | L2 |
| §5 Feature: 4×4 PC grid with time, grey background, click to change axes | L3 |
| §5 Correlogram: n×n bars, ±2 ms refractory, baseline, adjustable bin/window | L4 |
| §5 Amplitude: scatter + marginal histogram, "needs amplitudes.npy" | L5 (and F4 header for errors) |
| §5 Cluster statistics: stacked histogram panels (ISI, firing rate) | L6 |
| §5 plot layer: WebGL2 scatter/polylines/bars, Canvas2D axes, subplot grid, pan/zoom/reset, theme colours | F2 |
| §5 tiling with dockview-core as the only UI dependency | F1, F4 |
| §6 mods, `registerView`/`registerHistogram` renderers from extensions/plugin folder | **Plan 3**; the `ViewRenderer` contract (F2) is what Plan 3 exposes |
| Column *reordering* (spec says column order persisted) | Deferred: no reorder UI in v1; sort and filter persist. Ruling to record at execution. |
