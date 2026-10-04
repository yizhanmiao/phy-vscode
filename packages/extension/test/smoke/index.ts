import * as assert from 'node:assert/strict';
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

export async function run(): Promise<void> {
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
}
