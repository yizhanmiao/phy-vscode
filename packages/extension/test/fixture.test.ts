import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNpy } from '../src/host/dataset/npy';
import { CLUSTER_IDS, fixtureDir, fixtureParams, N_CHANNELS_DAT, N_SAMPLES, VARIANTS } from './fixtures/makeFixture';

describe('fixture', () => {
  it('writes every variant', () => {
    for (const v of VARIANTS) expect(existsSync(fixtureParams(v)), v).toBe(true);
  });
  it('writes int16 raw data of n_samples × n_channels_dat', () => {
    expect(statSync(join(fixtureDir('base'), 'raw.bin')).size).toBe(N_SAMPLES * N_CHANNELS_DAT * 2);
  });
  it('has sorted uint64 spike times, edge spikes and the expected clusters', async () => {
    const t = await readNpy(join(fixtureDir('base'), 'spike_times.npy'));
    expect(t.dtype).toBe('u8');
    const times = Array.from(t.data as BigUint64Array, Number);
    expect(times.every((x, i) => i === 0 || x >= times[i - 1])).toBe(true);
    expect(times[0]).toBe(5);
    expect(times.at(-1)).toBe(N_SAMPLES - 3);
    const c = await readNpy(join(fixtureDir('base'), 'spike_clusters.npy'));
    const ids = [...new Set(c.data as Int32Array)].sort((a, b) => a - b);
    expect(ids).toEqual(CLUSTER_IDS);
    expect(Array.from(c.data as Int32Array).filter((x) => x === 50)).toHaveLength(1);
  });
});
