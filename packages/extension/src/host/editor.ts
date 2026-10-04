import * as vscode from 'vscode';
import { openDataset } from './dataset/dataset';
import { errorHtml, summaryHtml } from './html';
import { Session } from './session';

class DatasetDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri, readonly session: Session | undefined, readonly error: string | undefined) {}
  dispose(): void {
    this.session?.dispose();
    void this.session?.dataset.close();
  }
}

export class DatasetEditorProvider implements vscode.CustomReadonlyEditorProvider<DatasetDocument> {
  activeSession: Session | undefined;

  constructor(private readonly storage: vscode.Uri) {}

  async openCustomDocument(uri: vscode.Uri): Promise<DatasetDocument> {
    try {
      const dataset = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Opening phy dataset' },
        (progress) =>
          openDataset(uri.fsPath, {
            cacheDir: vscode.Uri.joinPath(this.storage, 'cache').fsPath,
            onProgress: (message, f) => progress.report({ message: f === undefined ? message : `${message} ${Math.round(f * 100)}%` }),
          }),
      );
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
    panel.webview.html = doc.session ? summaryHtml(doc.session) : errorHtml(doc.error ?? 'unknown error');
    this.activeSession = doc.session;
    panel.onDidChangeViewState(() => {
      if (panel.active) this.activeSession = doc.session;
    });
    panel.onDidDispose(() => {
      if (this.activeSession === doc.session) this.activeSession = undefined;
    });
  }
}
