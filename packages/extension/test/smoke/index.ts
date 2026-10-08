import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';

async function waitFor<T>(get: () => T | undefined, what: string): Promise<T> {
  const end = Date.now() + 30_000;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

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

export async function run(): Promise<void> {
  const pluginDir = mkdtempSync(join(tmpdir(), 'phy-plugins-'));
  try {
    await runWith(pluginDir);
  } finally {
    await vscode.workspace.getConfiguration('phyVscode').update('pluginPaths', undefined, vscode.ConfigurationTarget.Global);
    rmSync(pluginDir, { recursive: true, force: true });
  }
}

async function runWith(pluginDir: string): Promise<void> {
  const fixtures = process.env.PHY_FIXTURES!;
  const api = await vscode.extensions.getExtension<ExtensionApi>('phy-vscode.phy-vscode')!.activate();
  writeSmokePlugin(pluginDir, 'smoke_double');
  await vscode.workspace.getConfiguration('phyVscode').update('pluginPaths', [pluginDir], vscode.ConfigurationTarget.Global);
  // The user's own ~/.phy-vscode/plugins may hold plugins too, so judge only this one.
  const reload = async () => {
    const r = (await vscode.commands.executeCommand<{ loaded: number; problems: string[] }>('phy.reloadPlugins'))!;
    assert.deepEqual(r.problems.filter((p) => p.includes('phy-plugins-')), []);
    assert.ok(r.loaded >= 1);
  };
  await reload();
  /**
   * A module renderer's first `rendered` entry can precede its `import()` resolving; a load failure arrives later as another entry.
   * So let the page settle, then require some entry for `smoke_view` after `from` and none of them carrying an error.
   */
  const smokeViewClean = async (from: number, what: string) => {
    await new Promise((r) => setTimeout(r, 2000));
    const entries = api.renderLog().slice(from).filter((e) => e.viewId === 'smoke_view');
    assert.ok(entries.length > 0, `${what}: smoke_view never rendered`);
    for (const e of entries) assert.equal(e.error, undefined, `${what}: smoke_view: ${e.error}`);
  };
  const views = ['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics', 'smoke_view'];
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
  await vscode.commands.executeCommand('phy.selectNext');
  assert.deepEqual([...session.selection], [2]);
  await vscode.commands.executeCommand('phy.selectNext');
  assert.deepEqual([...session.selection], [7]);
  await vscode.commands.executeCommand('phy.selectPrevious');
  assert.deepEqual([...session.selection], [2]);
  await renderedAfter(0); // empty selection renders a message in every view
  let mark = api.renderLog().length;
  session.select([7, 2]);
  for (const [v, e] of await renderedAfter(mark)) assert.equal(e.error, undefined, `${v}: ${e.error}`);
  await smokeViewClean(mark, 'selection');
  for (const id of views) assert.ok((await api.runView(id)).buffers.length > 0, `${id} returned no buffers`);

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
  await smokeViewClean(mark, 'after reload');
  assert.deepEqual([...session.selection], [7, 2]);

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
}
