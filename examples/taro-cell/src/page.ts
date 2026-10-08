import { cellUrl, folderName, ORIGIN } from './url';

// Set to false if taro-station refuses to be framed (http inside the https webview, or X-Frame-Options): the panel then
// shows the URLs and "Open in browser" links only.
export const EMBED = true;
/** How many clusters are shown side by side: the first PANES of the selection. */
export const PANES = 2;
/** Origins the framed page may report from (the plain-http page, or its https twin). */
export const ORIGINS = [ORIGIN, ORIGIN.replace('http:', 'https:')];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface SessionLike {
  readonly selection: readonly number[];
  readonly dataset: { readonly dir: string };
}

/** The panel body for `session`: the pages of its first PANES selected clusters, or a message saying why there are none. */
export function pageBody(session: SessionLike | undefined): string {
  if (!session) return `<p>Open a phy dataset first.</p>`;
  const ids = session.selection.slice(0, PANES);
  if (!ids.length) return `<p>Select a cluster.</p>`;
  const dir = session.dataset.dir;
  if (!cellUrl(dir, ids[0]!))
    return `<p>The dataset folder <code>${esc(folderName(dir))}</code> is not named <code>&lt;year&gt;-&lt;month&gt;-&lt;day&gt;-R&lt;run&gt;&lt;shank&gt;</code>, e.g. <code>2026-05-07-R001A</code>.</p>`;
  const panes = ids.map((id) => {
    const url = cellUrl(dir, id)!;
    return `<section><p class="bar"><code>${esc(url)}</code> <a href="${esc(url)}">Open in browser</a></p>${EMBED ? `<iframe src="${esc(url)}"></iframe>` : ''}</section>`;
  });
  return `<div class="panes">${panes.join('')}</div>`;
}

/**
 * Runs inside the panel: forwards a `{type: 'taro-scroll', y}` message from one framed page to the others. It only
 * relays what a page of ours (an iframe of this document, from an allowed origin) says, as exactly {type, y in 0..1}.
 * Self-contained, because it is shipped to the webview as source text (`relayScript`).
 */
export function relay(win: { addEventListener(type: 'message', fn: (e: any) => void): void; document: { querySelectorAll(sel: string): ArrayLike<any> } }, origins: string[]): void {
  win.addEventListener('message', (e) => {
    const d = e.data;
    if (!origins.includes(e.origin) || !d || d.type !== 'taro-scroll' || typeof d.y !== 'number' || !isFinite(d.y)) return;
    const frames = Array.from(win.document.querySelectorAll('iframe'));
    if (!frames.some((f: any) => f.contentWindow === e.source)) return;
    const y = Math.min(1, Math.max(0, d.y));
    for (const f of frames as any[]) if (f.contentWindow !== e.source) f.contentWindow?.postMessage({ type: 'taro-scroll', y }, e.origin);
  });
}
export const relayScript = `(${relay.toString()})(window, ${JSON.stringify(ORIGINS)});`;

export const html = (body: string, nonce: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src ${ORIGINS.join(' ')};">` +
  `<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}` +
  `.bar,p{margin:6px 10px;font-size:12px}.panes{flex:1;display:flex;min-height:0}section{flex:1;display:flex;flex-direction:column;min-width:0}` +
  `section+section{border-left:1px solid var(--vscode-panel-border)}iframe{flex:1;border:0;background:#fff}</style></head>` +
  `<body>${body}<script nonce="${nonce}">${relayScript}</script></body></html>`;
