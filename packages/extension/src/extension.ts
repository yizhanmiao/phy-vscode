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
