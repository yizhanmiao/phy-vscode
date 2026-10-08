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

/** What the panel shows: the pages of the first PANES selected clusters, or a message saying why there are none. */
export type Page = { message: string } | { urls: string[] };

export function pageOf(session: SessionLike | undefined): Page {
  if (!session) return { message: `<p>Open a phy dataset first.</p>` };
  const ids = session.selection.slice(0, PANES);
  if (!ids.length) return { message: `<p>Select a cluster.</p>` };
  const dir = session.dataset.dir;
  const urls = ids.map((id) => cellUrl(dir, id));
  if (urls.some((u) => !u))
    return { message: `<p>The dataset folder <code>${esc(folderName(dir))}</code> is not named <code>&lt;year&gt;-&lt;month&gt;-&lt;day&gt;-R&lt;run&gt;&lt;shank&gt;</code>, e.g. <code>2026-05-07-R001A</code>.</p>` };
  return { urls: urls as string[] };
}

/** The panel body for `page`. */
export function bodyOf(page: Page): string {
  if ('message' in page) return page.message;
  const panes = page.urls.map(
    (url) => `<section><p class="bar"><code>${esc(url)}</code> <a href="${esc(url)}">Open in browser</a></p>${EMBED ? `<iframe src="${esc(url)}"></iframe>` : ''}</section>`,
  );
  return `<div class="panes">${panes.join('')}</div>`;
}

/** Same key = same page structure: a new `urls` can then be sent to the live panel instead of reloading it. */
export const structureOf = (page: Page): string => ('message' in page ? page.message : `panes:${page.urls.length}`);

/** The message that moves a live panel to new `urls` (the same number as it shows). */
export const panesMessage = (urls: string[]) => ({ type: 'taro-panes', urls });

interface Win {
  parent: unknown;
  addEventListener(type: string, fn: (e: any) => void, capture?: boolean): void;
  document: { querySelectorAll(sel: string): ArrayLike<any> };
}

/**
 * Runs inside the panel. Forwards a `{type: 'taro-scroll', y}` message from one framed page to the others, and only
 * what a page of ours (an iframe of this document, from an allowed origin) says, as exactly {type, y in 0..1}. Greets
 * each page that loads with `taro-hello` so it learns who to report to. Applies a `taro-panes` message from VS Code
 * (the only window above us) by pointing the iframes at new URLs, so a pane whose URL did not change is not reloaded.
 * Self-contained, because it is shipped to the webview as source text (`relayScript`).
 */
export function relay(win: Win, origins: string[]): void {
  win.addEventListener('message', (e) => {
    const d = e.data;
    if (!d) return;
    if (d.type === 'taro-panes') {
      const sections = Array.from(win.document.querySelectorAll('section')) as any[];
      if (e.source !== win.parent || !Array.isArray(d.urls) || d.urls.length !== sections.length) return;
      sections.forEach((sec, i) => {
        const url = String(d.urls[i]);
        const frame = sec.querySelector('iframe');
        if (frame && frame.getAttribute('src') !== url) frame.setAttribute('src', url);
        sec.querySelector('code').textContent = url;
        sec.querySelector('a').setAttribute('href', url);
      });
      return;
    }
    if (!origins.includes(e.origin) || d.type !== 'taro-scroll' || typeof d.y !== 'number' || !isFinite(d.y)) return;
    const frames = Array.from(win.document.querySelectorAll('iframe')) as any[];
    if (!frames.some((f) => f.contentWindow === e.source)) return;
    const y = Math.min(1, Math.max(0, d.y));
    for (const f of frames) if (f.contentWindow !== e.source) f.contentWindow?.postMessage({ type: 'taro-scroll', y }, e.origin);
  });
  win.addEventListener(
    'load',
    (e) => {
      const w = e.target?.contentWindow;
      if (w && Array.from(win.document.querySelectorAll('iframe')).includes(e.target)) for (const o of origins) w.postMessage({ type: 'taro-hello' }, o);
    },
    true, // an iframe's load event does not bubble
  );
}
export const relayScript = `(${relay.toString()})(window, ${JSON.stringify(ORIGINS)});`;

export const html = (body: string, nonce: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src ${ORIGINS.join(' ')};">` +
  `<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}` +
  `.bar,p{margin:6px 10px;font-size:12px}.panes{flex:1;display:flex;min-height:0}section{flex:1;display:flex;flex-direction:column;min-width:0}` +
  `section+section{border-left:1px solid var(--vscode-panel-border)}iframe{flex:1;border:0;background:#fff}</style></head>` +
  `<body>${body}<script nonce="${nonce}">${relayScript}</script></body></html>`;
