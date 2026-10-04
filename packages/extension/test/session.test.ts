import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/host/session';
import { CLUSTER_IDS, fixtureDir } from './fixtures/makeFixture';
import { golden, openSession } from './helpers';

describe('Session', () => {
  it('builds the cluster table', async () => {
    const { session } = await openSession('base');
    const t = session.clusters;
    expect(t.columns).toEqual(['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate', 'ContamPct', 'KSLabel']);
    expect(t.rows.map((r) => r[0])).toEqual(CLUSTER_IDS); // 99 is in cluster_group.tsv but has no spikes
    const g = golden('table.json');
    const gt = golden('templates.json').base;
    for (const row of t.rows) {
      const id = String(row[0]);
      expect(row[1]).toBe(g[id].n_spikes);
      expect(row[3]).toBe(gt[id].depth);
      expect(row[4]).toBeCloseTo(g[id].amplitude, 4);
      expect(row[5]).toBeCloseTo(g[id].firing_rate, 9);
    }
    const r50 = t.rows.find((r) => r[0] === 50)!;
    expect(r50[2]).toBeNull(); // empty group
    expect(r50[6]).toBeNull(); // ContamPct nan
    expect(t.rows.find((r) => r[0] === 2)![6]).toBe(1.5);
  });

  it('uses template peak-to-peak for amplitude when amplitudes.npy is missing', async () => {
    const d = mkdtempSync(join(tmpdir(), 'noamp-'));
    cpSync(fixtureDir('base'), d, { recursive: true });
    rmSync(join(d, 'amplitudes.npy'));
    const { session } = await openSession(d);
    const gt = golden('templates.json').base;
    for (const row of session.clusters.rows) expect(row[4]).toBeCloseTo(gt[String(row[0])].ptp, 5);
  });

  it('selects only existing clusters, in order, without duplicates', async () => {
    const { session } = await openSession('base');
    const seen: (readonly number[])[] = [];
    session.onDidChangeSelection((s) => seen.push(s));
    session.select([7, 2, 7, 1234]);
    session.select([7, 2]);
    expect(session.selection).toEqual([7, 2]);
    expect(seen).toEqual([[7, 2]]);
    expect(session.colorOf(7)).toBe(PALETTE[0]);
    expect(session.colorOf(2)).toBe(PALETTE[1]);
    expect(session.colorOf(40)).toBe('#808080');
    expect(session.spikesOf(1234)).toHaveLength(0);
    expect(Array.from(session.bestChannels(7)!)).toEqual(golden('templates.json').base['7'].channels);
  });

  it('works without templates, amplitudes or metadata', async () => {
    const { session } = await openSession('minimal');
    expect(session.clusters.columns).toEqual(['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate']);
    expect(session.clusters.rows.every((r) => r[3] === null && r[4] === null)).toBe(true);
    expect(session.bestChannels(0)).toBeUndefined();
  });
});
