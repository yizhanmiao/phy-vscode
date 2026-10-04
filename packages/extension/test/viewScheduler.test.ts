import type { CancellationToken, HostToPlot, ViewResult } from '@phy-vscode/api';
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

  it('cancels hidden views\' in-flight runs on selection change', async () => {
    const { s, calls, posted, select, flush } = harness();
    s.setVisible(['a']);
    const oldRun = calls[0];
    s.setVisible([]);
    select([1]);
    expect(oldRun.token.isCancellationRequested).toBe(true);
    oldRun.resolve(result(1));
    await flush();
    const data = posted.filter((m) => m.type === 'viewData');
    expect(data).toHaveLength(0);
    s.setVisible(['a']);
    expect(calls).toHaveLength(2);
  });

  it('hide-then-show with no selection change delivers in-flight result', async () => {
    const { s, calls, posted, flush } = harness();
    s.setVisible(['a']);
    const run = calls[0];
    s.setVisible([]);
    s.setVisible(['a']);
    run.resolve(result(1));
    await flush();
    const data = posted.filter((m) => m.type === 'viewData');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ viewId: 'a', meta: { tag: 1 } });
  });

  it('recomputes a re-shown view whose run already completed', async () => {
    const { s, calls, posted, flush } = harness();
    s.setVisible(['a']);
    calls[0].resolve(result(1));
    await flush();
    s.setVisible([]);
    s.setVisible(['a']);
    expect(calls).toHaveLength(2);
    calls[1].resolve(result(2));
    await flush();
    const data = posted.filter((m) => m.type === 'viewData');
    expect(data.map((m) => (m as { meta: { tag: number } }).meta.tag)).toEqual([1, 2]);
  });

  it('recomputes a re-shown view whose run completed while it was hidden', async () => {
    const { s, calls, flush } = harness();
    s.setVisible(['a']);
    s.setVisible([]);
    calls[0].resolve(result(1));
    await flush();
    s.setVisible(['a']);
    expect(calls).toHaveLength(2);
  });
});
