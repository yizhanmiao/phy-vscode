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

export function summaryHtml(session: Session): string {
  const ds = session.dataset;
  const t = ds.templates;
  const rows: [string, string][] = [
    ['Folder', ds.dir],
    ['Spikes', String(ds.nSpikes)],
    ['Clusters', String(session.clusters.rows.length)],
    ['Channels', String(ds.nChannels)],
    ['Duration', `${ds.duration.toFixed(1)} s`],
    ['Sample rate', `${ds.sampleRate} Hz`],
    ['Raw data', ds.raw.ok ? `${ds.raw.raw.nSamples} samples × ${ds.raw.raw.nChannels} channels` : ds.raw.reason],
    ['Templates', t ? `${t.nTemplates} × ${t.nSamples} samples${t.cols ? ' (sparse)' : ''}` : 'missing'],
    ['Amplitudes', ds.amplitudes ? 'yes' : 'missing'],
    ['PC features', ds.features ? `${ds.features.nPcs} PCs × ${ds.features.nLoc} channels` : 'missing'],
  ];
  if (ds.metadataErrors.length) rows.push(['Skipped metadata', ds.metadataErrors.map((m) => `${m.file} (${m.error})`).join('; ')]);
  return page(`<h2>Phy dataset</h2><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`);
}

export const BASE_CSS =
  'html,body,#root{height:100%;margin:0;padding:0;overflow:hidden}' +
  'body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}' +
  '.phy-view{display:flex;flex-direction:column;height:100%}' +
  '.phy-header{font-size:11px;padding:2px 6px;min-height:16px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.phy-header.error{color:var(--vscode-errorForeground)}' +
  '.phy-body{flex:1;position:relative;min-height:0}' +
  '.phy-toolbar{position:absolute;top:2px;right:6px;z-index:2;display:flex;gap:8px;align-items:center;font-size:11px}' +
  '.phy-toolbar input[type=number]{width:4.5em;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}';

export const nonce = (): string => randomBytes(16).toString('base64');

export function webviewHtml(o: { cspSource: string; scriptUri: string; nonce: string; title: string }): string {
  const csp = `default-src 'none'; style-src ${o.cspSource} 'unsafe-inline'; img-src ${o.cspSource} data:; script-src 'nonce-${o.nonce}';`;
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(o.title)}</title><style>${BASE_CSS}</style></head>` +
    `<body><div id="root"></div><script nonce="${o.nonce}" src="${o.scriptUri}"></script></body></html>`
  );
}
