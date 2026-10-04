import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inlineCompute } from '../src/compute';
import { WorkerPool } from '../src/host/workerPool';
import { rng } from './fixtures/makeFixture';

let pool: WorkerPool;
beforeAll(async () => {
  const script = join(mkdtempSync(join(tmpdir(), 'pool-')), 'worker.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/host/worker.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', outfile: script, logLevel: 'silent',
  });
  pool = new WorkerPool(script, 2);
});
afterAll(() => pool.dispose());

describe('WorkerPool', () => {
  const r = rng(9);
  const times = new Float64Array(new SharedArrayBuffer(8 * 5000));
  for (let i = 1; i < times.length; i++) times[i] = times[i - 1] + Math.floor(r() * 200);
  const spikes = Int32Array.from({ length: 5000 }, (_, i) => i);
  const labels = Int32Array.from({ length: 5000 }, () => Math.floor(r() * 3));

  it('computes the same result as inline compute', async () => {
    const args = [times, spikes, labels, 3, 30, 25] as const;
    expect(await pool.run('correlograms', ...args)).toEqual(await inlineCompute.run('correlograms', ...args));
  });

  it('runs many jobs concurrently', async () => {
    const jobs = Array.from({ length: 8 }, () => pool.run('correlograms', times, spikes, labels, 3, 30, 25));
    expect((await Promise.all(jobs)).every((c) => c.length === 3 * 3 * 51)).toBe(true);
  });

  it('rejects with the worker error message', async () => {
    const spec = { nWindows: 1, length: 10, nChannels: 1, pad: 0, sampleRate: 30000, highpass: true };
    await expect(pool.run('processWindows', new Float32Array(10), spec)).rejects.toThrow(/filtfilt needs more than 12 samples/);
  });

  it('rejects after dispose', async () => {
    const p = new WorkerPool(join(tmpdir(), 'unused.cjs'), 0);
    await p.dispose();
    await expect(p.run('correlograms', times, spikes, labels, 3, 30, 25)).rejects.toThrow(/disposed/);
  });
});
