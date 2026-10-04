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
  return page(`<h2>Phy dataset</h2><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`);
}
