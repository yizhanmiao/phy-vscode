import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ViewResult } from '@theia-phy/api';
import { ClusterViewProvider } from './host/clusterView';
import { DatasetEditorProvider } from './host/editor';
import type { RenderEntry } from './host/plotPanel';
import type { Session } from './host/session';
import { WorkerPool } from './host/workerPool';
import { builtinViews } from './views';

export interface ExtensionApi {
  activeSession(): Session | undefined;
  runView(id: string, settings?: Record<string, unknown>): Promise<ViewResult>;
  renderLog(): readonly RenderEntry[];
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const pool = new WorkerPool(join(context.extensionPath, 'dist', 'worker.cjs'));
  const editor = new DatasetEditorProvider({ storage: context.globalStorageUri, extensionUri: context.extensionUri, state: context.workspaceState, compute: pool });
  const clusters = new ClusterViewProvider({ extensionUri: context.extensionUri, state: context.workspaceState });
  context.subscriptions.push(
    clusters,
    vscode.window.registerWebviewViewProvider('theiaPhy.clusters', clusters),
    editor.onDidChangeActiveSession((s) => clusters.setSession(s)),
    vscode.commands.registerCommand('phy.selectNext', () => clusters.step(1)),
    vscode.commands.registerCommand('phy.selectPrevious', () => clusters.step(-1)),
  );
  context.subscriptions.push(
    { dispose: () => void pool.dispose() },
    vscode.window.registerCustomEditorProvider('theiaPhy.dataset', editor, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('phy.openDataset', async (uri?: vscode.Uri) => {
      const target = uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Open Phy Dataset' }))?.[0];
      if (!target) return;
      const params = target.path.endsWith('/params.py') ? target : vscode.Uri.joinPath(target, 'params.py');
      await vscode.commands.executeCommand('vscode.openWith', params, 'theiaPhy.dataset');
    }),
    vscode.commands.registerCommand('phy.view.toggle', async (viewId?: string) => {
      const id = viewId ?? (await vscode.window.showQuickPick(builtinViews.map((v) => ({ label: v.title, id: v.id })), { placeHolder: 'Show or hide a view' }))?.id;
      if (id) editor.activePanel?.toggleView(id);
    }),
  );
  return {
    activeSession: () => editor.activeSession,
    renderLog: () => editor.activePanel?.renderLog ?? [],
    runView: (id, settings = {}) => {
      const session = editor.activeSession;
      const view = builtinViews.find((v) => v.id === id);
      if (!session) return Promise.reject(new Error('no active phy dataset'));
      if (!view) return Promise.reject(new Error(`unknown view ${id}`));
      return view.provider({ session, compute: pool, settings }, { isCancellationRequested: false });
    },
  };
}

export function deactivate(): void {}
