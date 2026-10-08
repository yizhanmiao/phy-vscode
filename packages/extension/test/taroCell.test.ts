import { describe, expect, it } from 'vitest';
import { html, ORIGINS, pageBody, relay } from '../../../examples/taro-cell/src/page';
import { BASE_URL, cellUrl, folderName } from '../../../examples/taro-cell/src/url';

describe('cellUrl', () => {
  it('is the dataset folder name plus the zero-padded cluster id', () => {
    expect(cellUrl('/data/ks4-x/2026-05-07-R001A', 12)).toBe(`${BASE_URL}2026-05-07-R001A-C0012`);
    expect(cellUrl('/data/ks4-x/2026-05-07-R001A/', 0)).toBe(`${BASE_URL}2026-05-07-R001A-C0000`);
    expect(cellUrl('2026-12-31-R123B', 9999)).toBe(`${BASE_URL}2026-12-31-R123B-C9999`);
  });
  it('lets a wider id through, like printf %04d', () => {
    expect(cellUrl('/d/2026-05-07-R001A', 12345)).toBe(`${BASE_URL}2026-05-07-R001A-C12345`);
  });
  it('is undefined when the folder is not <year>-<month>-<day>-R<run><shank>', () => {
    for (const dir of ['/d/ks4-019e7fd7', '/d/2026-05-07-R01A', '/d/2026-05-07-R001', '/d/2026-5-7-R001A', '/d/2026-05-07-R001A-extra', '/d/x2026-05-07-R001A']) {
      expect(cellUrl(dir, 1), dir).toBeUndefined();
    }
  });
  it('is undefined for an id that is not a non-negative integer', () => {
    for (const id of [-1, 1.5, NaN, Infinity]) expect(cellUrl('/d/2026-05-07-R001A', id), String(id)).toBeUndefined();
  });
  it('folderName ignores trailing separators', () => {
    expect(folderName('/a/b/2026-05-07-R001A//')).toBe('2026-05-07-R001A');
  });
});

describe('pageBody', () => {
  const session = (selection: number[], dir = '/d/2026-05-07-R001A') => ({ selection, dataset: { dir } });
  const panes = (body: string) => body.match(/<iframe src="([^"]+)"/g) ?? [];

  it('shows a message without a dataset, a selection or a well-named folder', () => {
    expect(pageBody(undefined)).toContain('Open a phy dataset');
    expect(pageBody(session([]))).toContain('Select a cluster');
    expect(pageBody(session([1], '/d/ks4-x'))).toContain('is not named');
  });
  it('shows one pane for one cluster and the first two for more', () => {
    expect(panes(pageBody(session([12])))).toEqual([`<iframe src="${BASE_URL}2026-05-07-R001A-C0012"`]);
    expect(panes(pageBody(session([12, 7, 3])))).toEqual([`<iframe src="${BASE_URL}2026-05-07-R001A-C0012"`, `<iframe src="${BASE_URL}2026-05-07-R001A-C0007"`]);
  });
  it('gives the page a script nonce that its CSP allows, and no other script source', () => {
    const doc = html('<p>x</p>', 'N0NC3');
    expect(doc).toContain(`script-src 'nonce-N0NC3'`);
    expect(doc).toContain(`<script nonce="N0NC3">`);
  });
});

describe('relay (runs inside the panel)', () => {
  // A fake window with two framed pages; `post` delivers a message to the relay and reports what each frame was sent.
  function setup() {
    const sent: unknown[][] = [[], []];
    const frames = [0, 1].map((i) => ({ contentWindow: { postMessage: (m: unknown, o: string) => sent[i]!.push([m, o]) } }));
    let listener!: (e: unknown) => void;
    relay({ addEventListener: (_t, fn) => (listener = fn), document: { querySelectorAll: () => frames } }, ORIGINS);
    const post = (data: unknown, from: unknown = frames[0]!.contentWindow, origin = ORIGINS[0]!) => listener({ data, source: from, origin });
    return { sent, frames, post };
  }

  it("forwards one frame's scroll to the other frame only, as exactly {type, y}", () => {
    const { sent, post } = setup();
    post({ type: 'taro-scroll', y: 0.25, extra: 'dropped' });
    expect(sent[0]).toEqual([]);
    expect(sent[1]).toEqual([[{ type: 'taro-scroll', y: 0.25 }, ORIGINS[0]]]);
  });
  it('clamps y to 0..1', () => {
    const { sent, post } = setup();
    post({ type: 'taro-scroll', y: 7 });
    post({ type: 'taro-scroll', y: -1 });
    expect(sent[1]!.map((s: any) => s[0].y)).toEqual([1, 0]);
  });
  it('ignores other origins, other senders, other messages and bad numbers', () => {
    const { sent, post } = setup();
    post({ type: 'taro-scroll', y: 0.5 }, undefined, 'http://evil.example');
    post({ type: 'taro-scroll', y: 0.5 }, {});
    post({ type: 'other', y: 0.5 });
    post({ type: 'taro-scroll', y: '0.5' });
    post({ type: 'taro-scroll', y: NaN });
    post(null);
    expect(sent).toEqual([[], []]);
  });
});
