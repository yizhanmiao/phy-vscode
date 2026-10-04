import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDataset as openDatasetRaw, type Dataset } from '../src/host/dataset/dataset';
import { readNpy } from '../src/host/dataset/npy';
import { CHANNEL_MAP, fixtureDir, fixtureParams, NS_TEMPLATE, SR, type Variant } from './fixtures/makeFixture';
import { writeNpy } from './fixtures/npyWrite';
import { expectClose } from './helpers';

// Close every dataset a test opens so no FileHandle is left to the GC.
const opened: Dataset[] = [];
const openDataset: typeof openDatasetRaw = async (...a) => {
  const ds = await openDatasetRaw(...a);
  opened.push(ds);
  return ds;
};
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

const open = (v: Variant) => openDataset(fixtureParams(v), { cacheDir: mkdtempSync(join(tmpdir(), 'cache-')) });
const copy = (v: Variant) => {
  const d = mkdtempSync(join(tmpdir(), `ds-${v}-`));
  cpSync(fixtureDir(v), d, { recursive: true });
  return d;
};

describe('openDataset', () => {
  it('loads the base fixture', async () => {
    const ds = await open('base');
    const times = (await readNpy(join(fixtureDir('base'), 'spike_times.npy'))).data;
    expect(ds.nSpikes).toBe(times.length);
    expect(ds.spikeTimes.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(ds.spikeClusters.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(ds.nChannels).toBe(CHANNEL_MAP.length);
    expect(ds.sampleRate).toBe(SR);
    expect(ds.templates?.cols).toBeUndefined(); // KS templates_ind.npy is ignored
    expect(ds.features).toMatchObject({ nPcs: 3, nLoc: 4 });
    expect(ds.raw.ok).toBe(true);
    expect([...ds.metadata.keys()]).toEqual(['ContamPct', 'KSLabel', 'group']);
    expect(ds.duration).toBeCloseTo((ds.spikeTimes[ds.nSpikes - 1] + 1) / SR, 12);
    await ds.close();
  });

  it('reads Fortran-order and (n, 1) files identically to C order', async () => {
    const [a, b] = await Promise.all([open('base'), open('fortran')]);
    expect(b.spikeTimes).toEqual(a.spikeTimes);
    expect(b.amplitudes).toEqual(a.amplitudes);
    expect(b.templates!.data).toEqual(a.templates!.data);
    expectClose(b.wmi, Array.from(a.wmi), 0);
    expect(await b.features!.file.readRows([0, 5, 1])).toEqual(await a.features!.file.readRows([0, 5, 1]));
  });

  it('keeps sparse template_ind.npy columns', async () => {
    const ds = await open('sparse');
    expect(ds.templates!.nCols).toBe(3);
    expect(Array.from(ds.templates!.cols!.subarray(3, 6))).toEqual([2, 1, -1]);
  });

  it('restricts features to pc_feature_spike_ids and reads int64 spike times', async () => {
    const [a, b] = await Promise.all([open('base'), open('subset')]);
    expect(b.features!.spikeIds!.length).toBe(Math.ceil(b.nSpikes / 2));
    expect(b.spikeTimes).toEqual(a.spikeTimes);
  });

  it('uses column 0 of a 2-D spike_templates and falls back to it for clusters', async () => {
    const [a, b] = await Promise.all([open('base'), open('templates2d')]);
    expect(b.spikeTemplates).toEqual(a.spikeTemplates);
    expect(b.spikeClusters).toEqual(a.spikeTemplates);
  });

  it('opens without raw data or whitening_mat_inv.npy', async () => {
    const [a, b] = await Promise.all([open('base'), open('noraw')]);
    expect(b.raw.ok).toBe(false);
    if (!b.raw.ok) expect(b.raw.reason).toMatch(/^raw data not found: .*missing\.bin$/);
    expectClose(b.wmi, Array.from(a.wmi), 1e-6);
  });

  it('opens a dataset with only the required files', async () => {
    const ds = await open('minimal');
    expect(ds.templates).toBeUndefined();
    expect(ds.amplitudes).toBeUndefined();
    expect(ds.features).toBeUndefined();
    expect(Array.from(ds.wmi.subarray(0, 7))).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(ds.raw).toEqual({ ok: false, reason: 'no dat_path in params.py' });
  });

  it('names a missing required file', async () => {
    const d = copy('base');
    rmSync(join(d, 'channel_map.npy'));
    await expect(openDataset(join(d, 'params.py'))).rejects.toThrow(/missing required file channel_map\.npy/);
  });

  it('names both files when spike counts disagree', async () => {
    const d = copy('base');
    const n = (await readNpy(join(d, 'spike_times.npy'))).data.length;
    writeNpy(join(d, 'amplitudes.npy'), new Float32Array(n - 1), [n - 1]);
    await expect(openDataset(join(d, 'params.py'))).rejects.toThrow(`amplitudes.npy has shape (${n - 1}) but spike_times.npy has ${n} spikes`);
  });

  it('names the offending params.py line', async () => {
    const d = copy('base');
    writeFileSync(join(d, 'params.py'), "dat_path = 'raw.bin'\nn_channels_dat = 8\ndtype = np.int16\nsample_rate = 30000.\n");
    await expect(openDataset(join(d, 'params.py'))).rejects.toThrow(/params\.py:3: unsupported syntax/);
  });

  it('zeroes all-NaN templates (phy behaviour)', async () => {
    const d = copy('base');
    const t = await readNpy(join(d, 'templates.npy'));
    const data = Float32Array.from(t.data as Float32Array);
    data.fill(NaN, 0, NS_TEMPLATE * CHANNEL_MAP.length);
    writeNpy(join(d, 'templates.npy'), data, t.shape);
    const ds = await openDataset(join(d, 'params.py'));
    expect(ds.templates!.data.subarray(0, NS_TEMPLATE * CHANNEL_MAP.length).every((x) => x === 0)).toBe(true);
  });

  it('reports raw data whose channel_map exceeds n_channels_dat', async () => {
    const d = copy('base');
    writeFileSync(join(d, 'params.py'), "dat_path = 'raw.bin'\nn_channels_dat = 4\ndtype = 'int16'\nsample_rate = 30000.\n");
    const ds = await openDataset(join(d, 'params.py'));
    expect(ds.raw).toEqual({ ok: false, reason: 'channel_map.npy refers to channel 5 but n_channels_dat is 4' });
  });
});
