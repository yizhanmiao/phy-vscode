import { describe, expect, it } from 'vitest';
import { bodyOf, html, ORIGINS, pageOf, panesMessage, relay, structureOf } from '../../../examples/taro-cell/src/page';
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

describe('pageOf / bodyOf', () => {
  const session = (selection: number[], dir = '/d/2026-05-07-R001A') => ({ selection, dataset: { dir } });
  const body = (selection: number[], dir?: string) => bodyOf(pageOf(session(selection, dir)));
  const panes = (b: string) => b.match(/<iframe src="([^"]+)"/g) ?? [];

  it('shows a message without a dataset, a selection or a well-named folder', () => {
    expect(bodyOf(pageOf(undefined))).toContain('Open a phy dataset');
    expect(body([])).toContain('Select a cluster');
    expect(body([1], '/d/ks4-x')).toContain('is not named');
  });
  it('shows one pane for one cluster and the first two for more', () => {
    expect(panes(body([12]))).toEqual([`<iframe src="${BASE_URL}2026-05-07-R001A-C0012"`]);
    expect(panes(body([12, 7, 3]))).toEqual([`<iframe src="${BASE_URL}2026-05-07-R001A-C0012"`, `<iframe src="${BASE_URL}2026-05-07-R001A-C0007"`]);
  });
  it('keeps its structure when only a cluster changes, so the live panel can be updated in place', () => {
    const key = (sel: number[]) => structureOf(pageOf(session(sel)));
    expect(key([1, 2])).toBe(key([5, 2]));
    expect(key([1, 2])).not.toBe(key([1]));
    expect(key([1])).not.toBe(key([]));
  });
  it('gives the page a script nonce that its CSP allows, and no other script source', () => {
    const doc = html('<p>x</p>', 'N0NC3');
    expect(doc).toContain(`script-src 'nonce-N0NC3'`);
    expect(doc).toContain(`<script nonce="N0NC3">`);
  });
});

describe('relay (runs inside the panel)', () => {
  const HOST = { host: 'window above us' };
  // A fake window holding two framed pages. `deliver` hands an event to the relay's listener of that type.
  function setup() {
    const sent: unknown[][] = [[], []];
    const frames = [0, 1].map((i) => ({ contentWindow: { postMessage: (m: unknown, o: string) => sent[i]!.push([m, o]) } }));
    const sections = [0, 1].map((i) => {
      const el = { src: 'old' + i, writes: 0, code: { textContent: '' }, a: { href: '' } };
      return {
        el,
        section: {
          querySelector: (q: string) =>
            q === 'iframe'
              ? { getAttribute: () => el.src, setAttribute: (_: string, v: string) => (el.writes++, (el.src = v)) }
              : q === 'code'
                ? el.code
                : { setAttribute: (_: string, v: string) => (el.a.href = v) },
        },
      };
    });
    const listeners: Record<string, (e: unknown) => void> = {};
    relay(
      { parent: HOST, addEventListener: (t, fn) => (listeners[t] = fn), document: { querySelectorAll: (q) => (q === 'iframe' ? frames : sections.map((s) => s.section)) } },
      ORIGINS,
    );
    const post = (data: unknown, from: unknown = frames[0]!.contentWindow, origin = ORIGINS[0]!) => listeners.message!({ data, source: from, origin });
    return { sent, frames, sections, post, load: (target: unknown) => listeners.load!({ target }) };
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
  it('greets a page that finishes loading, on each allowed origin, and nothing else', () => {
    const { sent, frames, load } = setup();
    load(frames[1]);
    load({ contentWindow: { postMessage: () => sent[0]!.push('stranger') } });
    expect(sent[1]).toEqual(ORIGINS.map((o) => [{ type: 'taro-hello' }, o]));
    expect(sent[0]).toEqual([]);
  });
  it('points the iframes at new URLs when the window above says so, leaving an unchanged one alone', () => {
    const { sections, post } = setup();
    post(panesMessage(['u1', 'old1']), HOST, 'vscode-webview://x');
    expect(sections[0]!.el).toMatchObject({ src: 'u1', writes: 1, code: { textContent: 'u1' }, a: { href: 'u1' } });
    expect(sections[1]!.el.writes).toBe(0); // same URL: not reloaded
  });
  it('ignores a taro-panes message that does not come from the window above, or has the wrong shape', () => {
    const { sections, frames, post } = setup();
    post(panesMessage(['x', 'y']), frames[0]!.contentWindow);
    post(panesMessage(['x', 'y']), {}, 'http://elsewhere');
    post(panesMessage(['only one']), HOST);
    post({ type: 'taro-panes', urls: 'x' }, HOST);
    expect(sections.map((s) => s.el.src)).toEqual(['old0', 'old1']);
  });
});
