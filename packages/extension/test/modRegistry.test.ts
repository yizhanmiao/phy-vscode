import type { ViewDefinition } from '@phy-vscode/api';
import { describe, expect, it } from 'vitest';
import { inlineCompute } from '../src/compute';
import { ModRegistry, type RegistryChange } from '../src/host/modRegistry';
import type { StatsMeta } from '../src/views/stats/provider';
import { live, openSession } from './helpers';

const view = (id: string, extra: Partial<ViewDefinition> = {}): ViewDefinition => ({
  id,
  title: id,
  rendererScript: { fsPath: `/mods/${id}/renderer.js` },
  provider: async () => ({ meta: { id }, buffers: [] }),
  ...extra,
});
const metric = (id: string) => ({ id, label: id, compute: () => 1 });
const histogram = (id: string) => ({ id, label: id, compute: () => new Float64Array(3) });
const collect = (r: ModRegistry) => {
  const events: RegistryChange[] = [];
  r.onDidChange((c) => events.push(c));
  return events;
};

describe('ModRegistry views', () => {
  it('lists built-in views first, then mod views in registration order', () => {
    const r = new ModRegistry();
    r.registerView(view('a'));
    r.registerView(view('b'));
    expect(r.views().map((v) => v.id)).toEqual(['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics', 'a', 'b']);
    expect(r.view('a')?.rendererScript?.fsPath).toBe('/mods/a/renderer.js');
    expect(r.view('waveform')?.rendererScript).toBeUndefined();
  });

  it('removes a view on dispose, and dispose is idempotent', () => {
    const r = new ModRegistry();
    const events = collect(r);
    const d = r.registerView(view('a'));
    d.dispose();
    d.dispose();
    expect(r.view('a')).toBeUndefined();
    expect(events).toHaveLength(2);
  });

  it('rejects duplicate, built-in and malformed ids and a missing renderer, keeping the first registration', async () => {
    const r = new ModRegistry();
    r.registerView(view('a'));
    expect(() => r.registerView(view('a'))).toThrow(/view 'a' is already registered/);
    expect(() => r.registerView(view('waveform'))).toThrow(/already registered/);
    expect(() => r.registerView(view('has space'))).toThrow(/view id must match/);
    expect(() => r.registerView(view('x', { rendererScript: undefined as never }))).toThrow(/needs a rendererScript/);
    expect((await r.view('a')!.provider({} as never, live)).meta).toEqual({ id: 'a' });
  });

  it('gives each registration a new generation', () => {
    const r = new ModRegistry();
    r.registerView(view('a')).dispose();
    r.registerView(view('a'));
    expect(r.view('a')!.generation).toBe(2);
  });

  it('hands a mod provider the session and settings only', async () => {
    const r = new ModRegistry();
    let seen: Record<string, unknown> | undefined;
    r.registerView(view('a', { provider: async (ctx) => ((seen = { ...ctx }), { meta: null, buffers: [] }) }));
    await r.view('a')!.provider({ session: 'S' as never, compute: 'C' as never, settings: { k: 1 } }, live);
    expect(seen).toEqual({ session: 'S', settings: { k: 1 } });
  });

  it('turns a synchronous throw in a mod provider into a rejection', async () => {
    const r = new ModRegistry();
    r.registerView(
      view('a', {
        provider: () => {
          throw new Error('boom');
        },
      }),
    );
    await expect(r.view('a')!.provider({} as never, live)).rejects.toThrow('boom');
  });
});

describe('ModRegistry metrics and histograms', () => {
  it('rejects duplicate ids, built-in columns and a missing compute', () => {
    const r = new ModRegistry();
    r.registerClusterMetric(metric('m'));
    expect(() => r.registerClusterMetric(metric('m'))).toThrow(/cluster metric 'm' is already registered/);
    expect(() => r.registerClusterMetric(metric('n_spikes'))).toThrow(/built-in table column/);
    expect(() => r.registerClusterMetric({ id: 'z', label: 'z' } as never)).toThrow(/needs a compute function/);
    r.registerHistogram(histogram('h'));
    expect(() => r.registerHistogram(histogram('h'))).toThrow(/histogram 'h' is already registered/);
    expect(() => r.registerHistogram(histogram('isi'))).toThrow(/already registered/);
  });

  it('changes the identity of metrics() and histograms() only when the set changes', () => {
    const r = new ModRegistry();
    const m0 = r.metrics();
    expect(r.metrics()).toBe(m0);
    const d = r.registerClusterMetric(metric('m'));
    expect(r.metrics()).not.toBe(m0);
    expect(r.metrics().map((m) => m.id)).toEqual(['m']);
    d.dispose();
    expect(r.metrics()).toEqual([]);
    const h0 = r.histograms();
    expect(r.histograms().map((h) => h.id)).toEqual(['isi', 'firing_rate']);
    r.registerHistogram(histogram('h'));
    expect(r.histograms()).not.toBe(h0);
  });

  it('the Cluster statistics view follows the registered histograms', async () => {
    const { session } = await openSession('base', [2]);
    const r = new ModRegistry();
    const ids = async () =>
      ((await r.view('cluster_statistics')!.provider({ session, compute: inlineCompute, settings: {} }, live)).meta as StatsMeta).histograms.map((h) => h.id);
    expect(await ids()).toEqual(['isi', 'firing_rate']);
    const d = r.registerHistogram(histogram('mine'));
    expect(await ids()).toEqual(['isi', 'firing_rate', 'mine']);
    d.dispose();
    expect(await ids()).toEqual(['isi', 'firing_rate']);
  });
});

describe('ModRegistry change events', () => {
  it('says which collections changed', () => {
    const r = new ModRegistry();
    const events = collect(r);
    r.registerHistogram(histogram('h'));
    expect(events).toEqual([{ views: false, metrics: false, histograms: true }]);
  });

  it('defers events while held and fires one merged event on release', () => {
    const r = new ModRegistry();
    const events = collect(r);
    const release = r.hold();
    const a = r.registerView(view('a'));
    r.registerClusterMetric(metric('m'));
    a.dispose();
    expect(events).toEqual([]);
    release();
    release();
    expect(events).toEqual([{ views: true, metrics: true, histograms: false }]);
  });

  it('fires nothing on release when nothing changed', () => {
    const r = new ModRegistry();
    const events = collect(r);
    r.hold()();
    expect(events).toEqual([]);
  });
});
