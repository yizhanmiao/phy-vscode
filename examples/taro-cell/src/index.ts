import * as vscode from 'vscode';
import type { Disposable, PhyApi, PhySession } from '@phy-vscode/api';
import { randomBytes } from 'node:crypto';
import { bodyOf, html, pageOf, panesMessage, structureOf } from './page';

export const apiVersion = '^0.2.0';

const TOGGLE = 'taroCell.toggle';

export function activate(api: PhyApi): Disposable {
  const subs: Disposable[] = [];
  let panel: vscode.WebviewPanel | undefined;

  let shown = ''; // structure of the page last set: the same structure with other URLs is sent to the live panel
  let urls: string[] = []; // the URLs the panel was last given
  const render = () => {
    if (!panel) return;
    const page = pageOf(api.activeSession());
    const structure = structureOf(page);
    const next = 'urls' in page ? page.urls : [];
    if (structure === shown && next.join() === urls.join()) return; // an identical re-render must not reload the iframes
    // A hidden panel has no live page to message; its html is shown again when it is revealed.
    if (structure === shown && panel.visible) void panel.webview.postMessage(panesMessage(next));
    else panel.webview.html = html(bodyOf(page), randomBytes(16).toString('base64'));
    shown = structure;
    urls = next;
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
  item.tooltip = 'Show the taro-station pages of the first two selected clusters side by side';
  item.command = TOGGLE;
  item.show();

  const command = vscode.commands.registerCommand(TOGGLE, () => {
    if (panel) {
      panel.dispose();
      return;
    }
    watch(api.activeSession()); // e.g. a dataset that was already open when the plugin was reloaded
    // Scripts are needed twice: our one nonce'd relay script (see page.ts), and the framed pages' own (a nested iframe
    // inherits the webview's sandbox, so without the flag the page would be inert).
    panel = vscode.window.createWebviewPanel('taroCell', 'Taro cell', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
    panel.onDidDispose(() => {
      panel = undefined;
      shown = '';
      urls = [];
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
