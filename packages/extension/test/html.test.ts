import { describe, expect, it } from 'vitest';
import { BASE_CSS, datasetInfo, errorHtml, webviewHtml } from '../src/host/html';
import { openSession } from './helpers';

describe('pages', () => {
  it('escapes and shows the error', () => {
    const h = errorHtml('missing required file channel_map.npy <script>');
    expect(h).toContain('missing required file channel_map.npy');
    expect(h).not.toContain('<script>');
    expect(h).toContain("default-src 'none'");
  });
  it('summarises a dataset in one line including the raw-data reason', async () => {
    const { session, ds } = await openSession('noraw');
    const s = datasetInfo(session);
    expect(s).toContain(`${ds.nSpikes} spikes`);
    expect(s).toContain('5 clusters');
    expect(s).toMatch(/raw: raw data not found/);
  });
});

describe('webviewHtml', () => {
  it('allows scripts only from the webview roots and the nonce, never eval', () => {
    const h = webviewHtml({ cspSource: 'vscode-resource:', scriptUri: 'vscode-resource:/dist/webview/plot.js', nonce: 'abc123', title: 'Phy <x>' });
    expect(h).toContain("script-src vscode-resource: 'nonce-abc123'");
    expect(h).toContain('<script nonce="abc123" src="vscode-resource:/dist/webview/plot.js">');
    expect(h).not.toContain('unsafe-eval');
    expect(h).toContain('<title>Phy &#60;x&#62;</title>');
    expect(h).toContain('<div id="root"></div>');
  });
});

describe('BASE_CSS', () => {
  it('lays the view toolbar out as a row in the flow, not over the plot', () => {
    const rule = /\.phy-toolbar\{([^}]*)\}/.exec(BASE_CSS)?.[1] ?? '';
    expect(rule).toContain('display:flex');
    expect(rule).toContain('justify-content:flex-end');
    expect(rule).not.toMatch(/position|top:|right:|z-index/);
  });
});
