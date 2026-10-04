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

  await vscode.commands.executeCommand('phy.openDataset', vscode.Uri.file(join(fixtures, 'base')));
  const session = await waitFor(() => api.activeSession(), 'base session');
  assert.equal(session.clusters.rows.length, 5);
  session.select([7, 2]);
  for (const id of ['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics']) {
    const r = await api.runView(id);
    assert.ok(r.buffers.length > 0, `${id} returned no buffers`);
  }
  assert.equal(((await api.runView('waveform')).meta as { source: string }).source, 'raw');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => (api.activeSession() ? undefined : true), 'editor to close');
  await vscode.commands.executeCommand('phy.openDataset', vscode.Uri.file(join(fixtures, 'noraw')));
  const noraw = await waitFor(() => api.activeSession(), 'noraw session');
  noraw.select([7]);
  const meta = (await api.runView('waveform')).meta as { source: string; notice: string };
  assert.equal(meta.source, 'template');
  assert.match(meta.notice, /raw data not found/);
}
