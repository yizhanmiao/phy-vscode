import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ViewResult } from '@theia-phy/api';
import { DatasetEditorProvider } from './host/editor';
import type { Session } from './host/session';
import { WorkerPool } from './host/workerPool';
import { builtinViews } from './views';

export interface ExtensionApi {
  activeSession(): Session | undefined;
  runView(id: string, settings?: Record<string, unknown>): Promise<ViewResult>;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const pool = new WorkerPool(join(context.extensionPath, 'dist', 'worker.cjs'));
  const editor = new DatasetEditorProvider(context.globalStorageUri);
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
  );
  return {
    activeSession: () => editor.activeSession,
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
