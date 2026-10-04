import * as vscode from 'vscode';
import type { Compute } from '../compute';
import { openDataset } from './dataset/dataset';
import { errorHtml } from './html';
import { PlotPanel } from './plotPanel';
import { Session } from './session';

class DatasetDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri, readonly session: Session | undefined, readonly error: string | undefined) {}
  dispose(): void {
    this.session?.dispose();
    void this.session?.dataset.close();
  }
}

export interface EditorContext {
  storage: vscode.Uri;
  extensionUri: vscode.Uri;
  state: vscode.Memento;
  compute: Compute;
}

export class DatasetEditorProvider implements vscode.CustomReadonlyEditorProvider<DatasetDocument> {
  activeSession: Session | undefined;
  activePanel: PlotPanel | undefined;
  private readonly activeEmitter = new vscode.EventEmitter<Session | undefined>();
  readonly onDidChangeActiveSession = this.activeEmitter.event;

  constructor(private readonly ctx: EditorContext) {}

  async openCustomDocument(uri: vscode.Uri): Promise<DatasetDocument> {
    try {
      const dataset = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Opening phy dataset' },
        (progress) =>
          openDataset(uri.fsPath, {
            cacheDir: vscode.Uri.joinPath(this.ctx.storage, 'cache').fsPath,
            onProgress: (message, f) => progress.report({ message: f === undefined ? message : `${message} ${Math.round(f * 100)}%` }),
          }),
      );
      if (dataset.metadataErrors.length) {
        void vscode.window.showWarningMessage(`Phy: skipped metadata ${dataset.metadataErrors.map((m) => `${m.file} (${m.error})`).join('; ')}`);
      }
      try {
        return new DatasetDocument(uri, new Session(dataset), undefined);
      } catch (e) {
        await dataset.close();
        throw e;
      }
    } catch (e) {
      return new DatasetDocument(uri, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  resolveCustomEditor(doc: DatasetDocument, panel: vscode.WebviewPanel): void {
    const session = doc.session;
    if (!session) {
      panel.webview.html = errorHtml(doc.error ?? 'unknown error');
      return;
    }
    const plot = new PlotPanel(panel, session, this.ctx);
    const activate = () => {
      this.activePanel = plot;
      this.setActive(session);
      void vscode.commands.executeCommand('setContext', 'phyDatasetActive', true);
    };
    activate();
    panel.onDidChangeViewState(() => {
      if (panel.active) activate();
      else if (this.activePanel === plot) void vscode.commands.executeCommand('setContext', 'phyDatasetActive', false);
    });
    panel.onDidDispose(() => {
      plot.dispose();
      if (this.activePanel === plot) {
        this.activePanel = undefined;
        this.setActive(undefined);
        void vscode.commands.executeCommand('setContext', 'phyDatasetActive', false);
      }
    });
  }

  private setActive(session: Session | undefined): void {
    if (this.activeSession === session) return;
    this.activeSession = session;
    this.activeEmitter.fire(session);
  }
}
