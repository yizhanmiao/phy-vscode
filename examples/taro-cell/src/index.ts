import * as vscode from 'vscode';
import type { Disposable, PhyApi, PhySession } from '@phy-vscode/api';
import { cellUrl, folderName, ORIGIN } from './url';

export const apiVersion = '^0.2.0';

// Set to false if taro-station refuses to be framed (http inside the https webview, or X-Frame-Options): the panel then
// shows the URL and an "Open in browser" link only.
const EMBED = true;
const TOGGLE = 'taroCell.toggle';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page for the first selected cluster of `session`, or a message saying why there is none. */
function pageFor(session: PhySession | undefined): string {
  if (!session) return `<p>Open a phy dataset first.</p>`;
  const id = session.selection[0];
  if (id === undefined) return `<p>Select a cluster.</p>`;
  const url = cellUrl(session.dataset.dir, id);
  if (!url) return `<p>The dataset folder <code>${esc(folderName(session.dataset.dir))}</code> is not named <code>&lt;year&gt;-&lt;month&gt;-&lt;day&gt;-R&lt;run&gt;&lt;shank&gt;</code>, e.g. <code>2026-05-07-R001A</code>.</p>`;
  return (
    `<p class="bar"><code>${esc(url)}</code> <a href="${esc(url)}">Open in browser</a></p>` +
    (EMBED ? `<iframe src="${esc(url)}"></iframe>` : '')
  );
}

const html = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src ${ORIGIN} ${ORIGIN.replace('http:', 'https:')};">` +
  `<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}` +
  `.bar,p{margin:6px 10px;font-size:12px}iframe{flex:1;border:0;background:#fff}</style></head><body>${body}</body></html>`;

export function activate(api: PhyApi): Disposable {
  const subs: Disposable[] = [];
  let panel: vscode.WebviewPanel | undefined;

  let shown = ''; // last html set: an identical re-render must not reload the iframe
  const render = () => {
    if (!panel) return;
    const next = html(pageFor(api.activeSession()));
    if (next !== shown) panel.webview.html = shown = next;
  };

  // The API has no "active session changed" event, so listen to every session that opens and act only on the active one.
  const watched = new WeakSet<PhySession>();
  const watch = (s: PhySession | undefined) => {
    if (!s || watched.has(s)) return;
    watched.add(s);
    subs.push(
      s.onDidChangeSelection(() => {
        if (s === api.activeSession()) render();
      }),
    );
  };
  watch(api.activeSession());
  subs.push(api.onDidOpenSession(watch));

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.text = '$(globe) Taro cell';
  item.tooltip = 'Show the taro-station page of the selected cluster';
  item.command = TOGGLE;
  item.show();

  const command = vscode.commands.registerCommand(TOGGLE, () => {
    if (panel) {
      panel.dispose();
      return;
    }
    watch(api.activeSession()); // e.g. a dataset that was already open when the plugin was reloaded
    // Our own page has no script and its CSP has no script-src, so none of it can run; the flag only lets the framed
    // page run its own scripts (a nested iframe inherits the webview's sandbox, so without it the page would be inert).
    panel = vscode.window.createWebviewPanel('taroCell', 'Taro cell', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
    panel.onDidDispose(() => {
      panel = undefined;
      shown = '';
    });
    render();
  });

  return {
    dispose() {
      for (const s of subs) s.dispose();
      command.dispose();
      item.dispose();
      panel?.dispose();
    },
  };
}
