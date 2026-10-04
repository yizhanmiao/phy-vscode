import { describe, expect, it } from 'vitest';
import { errorHtml, summaryHtml, webviewHtml } from '../src/host/html';
import { openSession } from './helpers';

describe('pages', () => {
  it('escapes and shows the error', () => {
    const h = errorHtml('missing required file channel_map.npy <script>');
    expect(h).toContain('missing required file channel_map.npy');
    expect(h).not.toContain('<script>');
    expect(h).toContain("default-src 'none'");
  });
  it('summarises a dataset including the raw-data reason', async () => {
    const { session, ds } = await openSession('noraw');
    const h = summaryHtml(session);
    expect(h).toContain('raw data not found');
    expect(h).toContain(`<td>${ds.nSpikes}</td>`);
    expect(h).toContain('<td>5</td>');
  });
});

describe('webviewHtml', () => {
  it('allows scripts only from the nonce and never eval', () => {
    const h = webviewHtml({ cspSource: 'vscode-resource:', scriptUri: 'vscode-resource:/dist/webview/plot.js', nonce: 'abc123', title: 'Phy <x>' });
    expect(h).toContain("script-src 'nonce-abc123'");
    expect(h).toContain('<script nonce="abc123" src="vscode-resource:/dist/webview/plot.js">');
    expect(h).not.toContain('unsafe-eval');
    expect(h).toContain('<title>Phy &#60;x&#62;</title>');
    expect(h).toContain('<div id="root"></div>');
  });
});
