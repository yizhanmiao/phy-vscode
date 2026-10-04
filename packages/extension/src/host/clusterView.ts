import * as vscode from 'vscode';
import type { HostToSidebar, SidebarToHost } from '@phy-vscode/api';
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
