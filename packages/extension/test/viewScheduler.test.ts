import type { CancellationToken, HostToPlot, ViewResult } from '@theia-phy/api';
import { describe, expect, it } from 'vitest';
import { toArrayBuffer, ViewScheduler } from '../src/host/viewScheduler';
import { Cancelled } from '../src/views/types';

interface Call {
  viewId: string;
  settings: Readonly<Record<string, unknown>>;
  token: CancellationToken;
  resolve(r: ViewResult): void;
  reject(e: unknown): void;
}
function harness(settings = {}) {
  const calls: Call[] = [];
  const posted: HostToPlot[] = [];
  let ids: number[] = [];
  const s = new ViewScheduler(
    (viewId, st, token) => new Promise((resolve, reject) => calls.push({ viewId, settings: st, token, resolve, reject })),
    (m) => posted.push(m),
    () => ({ ids, colors: ids.map(() => '#fff') }),
    settings,
  );
  const select = (next: number[]) => {
    ids = next;
    s.selectionChanged();
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { s, calls, posted, select, flush };
}
const result = (tag: number): ViewResult => ({ meta: { tag }, buffers: [new Float32Array([tag]).buffer] });

describe('ViewScheduler', () => {
  it('computes only visible views on selection change', () => {
    const { s, calls, select } = harness();
    s.setVisible(['waveform']);
    calls.length = 0;
    select([1]);
    expect(calls.map((c) => c.viewId)).toEqual(['waveform']);
  });

  it('drops stale results and cancels the superseded run', async () => {
    const { s, calls, posted, select, flush } = harness();
    s.setVisible(['waveform']);
    select([1]);
    select([2]);
    const [, first, second] = calls;
    expect(first.token.isCancellationRequested).toBe(true);
    second.resolve(result(2));
    first.resolve(result(1));
    await flush();
    const data = posted.filter((m) => m.type === 'viewData');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ viewId: 'waveform', meta: { tag: 2 }, selection: { ids: [2] } });
  });

  it('computes a view when it becomes visible, once per selection', () => {
    const { s, calls, select } = harness();
    select([1]);
    expect(calls).toHaveLength(0);
    s.setVisible(['feature']);
    s.setVisible(['feature']);
    expect(calls.map((c) => c.viewId)).toEqual(['feature']);
    s.setVisible([]);
    select([2]);
    s.setVisible(['feature']);
    expect(calls).toHaveLength(2);
  });

  it('merges settings and recomputes', () => {
    const { s, calls } = harness({ correlogram: { binSec: 0.001 } });
    s.setVisible(['correlogram']);
    s.setSettings('correlogram', { windowSec: 0.1 });
    expect(calls.at(-1)!.settings).toEqual({ binSec: 0.001, windowSec: 0.1 });
    expect(s.settingsOf('correlogram')).toEqual({ binSec: 0.001, windowSec: 0.1 });
  });

  it('posts provider errors but not cancellations', async () => {
    const { s, calls, posted, flush } = harness();
    s.setVisible(['amplitude', 'feature']);
    calls[0].reject(new Error('needs amplitudes.npy'));
    calls[1].reject(new Cancelled());
    await flush();
    expect(posted).toEqual([{ type: 'viewError', viewId: 'amplitude', seq: 1, message: 'needs amplitudes.npy' }]);
  });

  it('ignores results after dispose', async () => {
    const { s, calls, posted, flush } = harness();
    s.setVisible(['waveform']);
    s.dispose();
    expect(calls[0].token.isCancellationRequested).toBe(true);
    calls[0].resolve(result(1));
    await flush();
    expect(posted).toEqual([]);
    s.setVisible(['feature']);
    expect(calls).toHaveLength(1);
  });

  it('never posts shared memory', () => {
    const sab = new SharedArrayBuffer(8);
    const ab = toArrayBuffer(sab);
    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(ab.byteLength).toBe(8);
    const plain = new ArrayBuffer(4);
    expect(toArrayBuffer(plain)).toBe(plain);
  });
});
