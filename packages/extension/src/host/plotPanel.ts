import * as vscode from 'vscode';
import type { HostToPlot, PlotToHost, SelectionMsg, TableState } from '@phy-vscode/api';
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
