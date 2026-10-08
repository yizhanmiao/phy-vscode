import { dirname } from 'node:path';
import * as vscode from 'vscode';
import type { HostToPlot, PlotToHost, SelectionMsg, TableState } from '@phy-vscode/api';
import type { Compute } from '../compute';
import { nonce, webviewHtml } from './html';
import type { ModRegistry, RegistryChange } from './modRegistry';
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
  mods: ModRegistry;
  /** Resolves once the first plugin load finished, so the webview starts with every plugin's views. */
  ready: Promise<void>;
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
  /** The view list the webview was last initialised with (JSON); undefined until it asks. */
  private shown: string | undefined;
  private disposed = false;

  constructor(private readonly panel: vscode.WebviewPanel, private readonly session: Session, private readonly ctx: PanelContext) {
    this.scheduler = new ViewScheduler(
      (viewId, settings, token) => {
        const view = ctx.mods.view(viewId);
        if (!view) return Promise.reject(new Error(`unknown view ${viewId}`));
        return view.provider({ session, compute: ctx.compute, settings }, token);
      },
      (m) => this.post(m),
      () => selectionMsg(session),
      loadPersisted(ctx.state, session.dataset.paramsPath).settings,
    );
    this.load();
    this.subs.push(
      session.onDidChangeSelection(() => this.scheduler.selectionChanged()),
      panel.webview.onDidReceiveMessage((m: PlotToHost) => this.onMessage(m)),
      ctx.mods.onDidChange((c) => this.onModsChanged(c)),
    );
  }

  toggleView(viewId: string): void {
    this.post({ type: 'toggleView', viewId });
  }

  /** The webview may read dist/webview and the folder of every mod renderer. */
  private setRoots(): void {
    const dirs = new Set(this.ctx.mods.views().flatMap((v) => (v.rendererScript ? [dirname(v.rendererScript.fsPath)] : [])));
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview'), ...[...dirs].map((d) => vscode.Uri.file(d))],
    };
  }

  /** (Re)load the page. */
  private load(): void {
    const webview = this.panel.webview;
    this.setRoots();
    webview.html = webviewHtml({
      cspSource: webview.cspSource,
      nonce: nonce(),
      title: 'Phy',
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview', 'plot.js')).toString(),
    });
  }

  private views(): { id: string; title: string; rendererUri?: string }[] {
    return this.ctx.mods.views().map((v) => ({
      id: v.id,
      title: v.title,
      ...(v.rendererScript
        ? { rendererUri: this.panel.webview.asWebviewUri(vscode.Uri.file(v.rendererScript.fsPath)).with({ query: `v=${v.generation}` }).toString() }
        : {}),
    }));
  }

  private onModsChanged(c: RegistryChange): void {
    if (c.views) {
      this.setRoots();
      if (this.shown !== undefined && this.shown !== JSON.stringify(this.views())) {
        // The view list or a renderer changed under a live page: start it afresh. Layout, settings and selection come back from state.
        this.shown = undefined;
        this.scheduler.reset();
        this.load();
        return;
      }
    }
    if (c.histograms) this.scheduler.viewChanged('cluster_statistics');
  }

  private post(m: HostToPlot): void {
    void this.panel.webview.postMessage(m);
  }

  private onMessage(m: PlotToHost): void {
    const { state } = this.ctx;
    const paramsPath = this.session.dataset.paramsPath;
    switch (m.type) {
      case 'ready':
        void this.ctx.ready.then(() => {
          if (this.disposed) return;
          const saved = loadPersisted(state, paramsPath);
          const views = this.views();
          this.shown = JSON.stringify(views);
          this.post({ type: 'init', views, layout: saved.layout, settings: saved.settings, states: saved.states });
        });
        break;
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
    this.disposed = true;
    this.scheduler.dispose();
    for (const s of this.subs) s.dispose();
  }
}
