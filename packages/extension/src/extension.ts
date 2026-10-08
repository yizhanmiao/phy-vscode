import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { PhyApi, ViewResult } from '@phy-vscode/api';
import { ClusterViewProvider } from './host/clusterView';
import { DatasetEditorProvider } from './host/editor';
import { ModRegistry } from './host/modRegistry';
import { createPhyApi } from './host/phyApi';
import { PluginHost, pluginRoots, requireLoader, type LoadReport } from './host/plugins';
import type { RenderEntry } from './host/plotPanel';
import { PLUGIN_NAME, scaffoldPlugin } from './host/scaffold';
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
  context.subscriptions.push(
    clusters,
    vscode.window.registerWebviewViewProvider('phyVscode.clusters', clusters),
    editor.onDidChangeActiveSession((s) => clusters.setSession(s)),
    vscode.commands.registerCommand('phy.selectNext', () => clusters.step(1)),
    vscode.commands.registerCommand('phy.selectPrevious', () => clusters.step(-1)),
  );
  context.subscriptions.push(
    { dispose: () => void pool.dispose() },
    { dispose: () => plugins.dispose() }, // before `out`: subscriptions dispose in order, so the channel outlives the plugins' shutdown logging
    out,
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
  void plugins.load().then(report).catch((e) => log(`plugin loading failed: ${e instanceof Error ? e.message : String(e)}`)).finally(pluginsLoaded);
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
