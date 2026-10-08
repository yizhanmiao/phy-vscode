import { randomBytes } from 'node:crypto';
import type { Session } from './session';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">` +
  `<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:1em}` +
  `td{padding:0 1.5em 0 0}.err{color:var(--vscode-errorForeground)}</style></head><body>${body}</body></html>`;

export function errorHtml(message: string): string {
  return page(`<h2 class="err">Could not open dataset</h2><p>${esc(message)}</p>`);
}

/** One-line dataset description for the Cluster view header. */
export function datasetInfo(session: Session): string {
  const ds = session.dataset;
  return [
    `${ds.nSpikes} spikes`,
    `${session.clusters.rows.length} clusters`,
    `${ds.nChannels} channels`,
    `${ds.duration.toFixed(1)} s`,
    `raw: ${ds.raw.ok ? 'ok' : ds.raw.reason}`,
  ].join(' · ');
}

export const BASE_CSS =
  'html,body,#root{height:100%;margin:0;padding:0;overflow:hidden}' +
  'body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}' +
  '.phy-view{display:flex;flex-direction:column;height:100%}' +
  '.phy-header{font-size:11px;padding:2px 6px;min-height:16px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.phy-header.error{color:var(--vscode-errorForeground)}' +
  '.phy-body{flex:1;position:relative;min-height:0}' +
  '.phy-toolbar{display:flex;justify-content:flex-end;gap:8px;align-items:center;font-size:11px;padding:0 6px}' +
  '.phy-toolbar input[type=number]{width:4.5em;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}';

export const nonce = (): string => randomBytes(16).toString('base64');

export function webviewHtml(o: { cspSource: string; scriptUri: string; nonce: string; title: string }): string {
  const csp = `default-src 'none'; style-src ${o.cspSource} 'unsafe-inline'; img-src ${o.cspSource} data:; script-src ${o.cspSource} 'nonce-${o.nonce}';`;
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(o.title)}</title><style>${BASE_CSS}</style></head>` +
    `<body><div id="root"></div><script nonce="${o.nonce}" src="${o.scriptUri}"></script></body></html>`
  );
}
