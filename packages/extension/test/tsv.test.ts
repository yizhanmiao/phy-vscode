import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClusterTable, readClusterMetadata } from '../src/host/dataset/tsv';

describe('cluster metadata', () => {
  it('parses CRLF files with empty values and keeps string columns as strings', () => {
    const t = parseClusterTable('cluster_id\tgroup\r\n0\tgood\r\n1\t\r\n2\tmua\r\n', '\t', 'cluster_group.tsv');
    expect(t.field).toBe('group');
    expect([...t.values]).toEqual([[0, 'good'], [1, null], [2, 'mua']]);
  });

  it('makes numeric columns numbers and nan null', () => {
    const t = parseClusterTable('cluster_id\tContamPct\n0\t150.7\n1\tnan\n2\t0.0\n', '\t', 'f');
    expect([...t.values]).toEqual([[0, 150.7], [1, null], [2, 0]]);
  });

  it('names the line of a bad cluster id', () => {
    expect(() => parseClusterTable('cluster_id\tx\nabc\t1\n', '\t', 'cluster_x.tsv')).toThrow(/cluster_x\.tsv:2: bad cluster id/);
  });

  it('reads every cluster_*.tsv/.csv except cluster_info.tsv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsv-'));
    writeFileSync(join(dir, 'cluster_group.tsv'), 'cluster_id\tgroup\n3\tnoise\n');
    writeFileSync(join(dir, 'cluster_Amplitude.csv'), 'cluster_id,Amplitude\n3,9.8\n');
    writeFileSync(join(dir, 'cluster_info.tsv'), 'cluster_id\tshould_not_appear\n3\t1\n');
    const m = await readClusterMetadata(dir);
    expect([...m.keys()]).toEqual(['Amplitude', 'group']);
    expect(m.get('Amplitude')!.get(3)).toBe(9.8);
  });
});
