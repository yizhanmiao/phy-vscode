import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NeedsFileError } from '../src/host/dataset/dataset';
import { featureView, type FeatureMeta } from '../src/views/feature/provider';
import { fixtureDir } from './fixtures/makeFixture';
import { expectClose, flat, golden, live, openSession, viewContext } from './helpers';

const g = golden('features.json');

describe('feature provider', () => {
  it("reads PC features on the first selected cluster's best channels", async () => {
    const { session } = await openSession('base', [7, 2]);
    const r = await featureView.provider(viewContext(session), live);
    const meta = r.meta as FeatureMeta;
    expect(meta.channels).toEqual(g.channels);
    expect(meta.nPcs).toBe(3);
    expect(meta.groups.map((x) => x.id)).toEqual([null, 7, 2]);
    expect(r.buffers).toHaveLength(6);
    expectClose(new Float32Array(r.buffers[2]).subarray(0, 5 * 4 * 3), flat(g.features), 1e-6);
    const bg = new Float32Array(r.buffers[0]);
    for (let i = 0; i < meta.groups[0].n; i++) expect(Number.isNaN(bg[i * 12])).toBe(false);
  });

  it('only uses spikes listed in pc_feature_spike_ids', async () => {
    const { session } = await openSession('subset', [7]);
    const meta = (await featureView.provider(viewContext(session), live)).meta as FeatureMeta;
    expect(meta.groups[1].n).toBe(Array.from(session.spikesOf(7)).filter((s) => s % 2 === 0).length);
  });

  it('gives identical results for a Fortran-order pc_features.npy', async () => {
    const [a, b] = await Promise.all([openSession('base', [7]), openSession('fortran', [7])]);
    const ra = await featureView.provider(viewContext(a.session), live);
    const rb = await featureView.provider(viewContext(b.session), live);
    expect(rb.meta).toEqual(ra.meta);
    rb.buffers.forEach((buf, i) => expect(new Float32Array(buf)).toEqual(new Float32Array(ra.buffers[i])));
  });

  it('needs pc_features.npy', async () => {
    const { session } = await openSession('minimal', [0]);
    await expect(featureView.provider(viewContext(session), live)).rejects.toThrow(NeedsFileError);
  });

  it('asks for pc_feature_ind.npy when only that file is missing', async () => {
    const d = mkdtempSync(join(tmpdir(), 'noind-'));
    cpSync(fixtureDir('base'), d, { recursive: true });
    rmSync(join(d, 'pc_feature_ind.npy'));
    const { session } = await openSession(d, [0]);
    await expect(featureView.provider(viewContext(session), live)).rejects.toThrow('needs pc_feature_ind.npy');
  });

  it('returns no groups for an empty selection', async () => {
    const { session } = await openSession('base');
    expect(await featureView.provider(viewContext(session), live)).toEqual({ meta: { channels: [], nPcs: 0, groups: [] }, buffers: [] });
  });
});
