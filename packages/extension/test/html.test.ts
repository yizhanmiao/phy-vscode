import { describe, expect, it } from 'vitest';
import { errorHtml, summaryHtml } from '../src/host/html';
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
