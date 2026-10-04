import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Params } from '../src/host/dataset/params';
import { RawData, type RawStatus } from '../src/host/dataset/raw';
import { fixtureDir, N_CHANNELS_DAT, N_SAMPLES, SR } from './fixtures/makeFixture';

const base = fixtureDir('base');
const bytes = readFileSync(join(base, 'raw.bin'));
const all = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const nc = N_CHANNELS_DAT;
const params = (over: Partial<Params> = {}): Params => ({
  datPath: ['raw.bin'], nChannelsDat: nc, dtype: 'i2', offset: 0, sampleRate: SR, hpFiltered: false, ...over,
});
const ok = (s: RawStatus) => {
  if (!s.ok) throw new Error(s.reason);
  return s.raw;
};
const expected = (start: number, L: number) =>
  Array.from({ length: L * nc }, (_, k) => {
    const s = start + Math.floor(k / nc);
    return s >= 0 && s < N_SAMPLES ? all[s * nc + (k % nc)] : 0;
  });

describe('RawData', () => {
  it('reads windows and zero-fills outside the recording', async () => {
    const raw = ok(await RawData.open(params(), base));
    expect(raw.nSamples).toBe(N_SAMPLES);
    const L = 20;
    const w = await raw.readWindows([100, N_SAMPLES - 10, -5], L);
    expect(Array.from(w.subarray(0, L * nc))).toEqual(expected(100, L));
    expect(Array.from(w.subarray(L * nc, 2 * L * nc))).toEqual(expected(N_SAMPLES - 10, L));
    expect(Array.from(w.subarray(2 * L * nc))).toEqual(expected(-5, L));
    await raw.close();
  });

  it('treats a list of dat files as one recording (relative and absolute paths)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const half = (N_SAMPLES / 2) * nc * 2;
    writeFileSync(join(dir, 'a.bin'), bytes.subarray(0, half));
    writeFileSync(join(dir, 'b.bin'), bytes.subarray(half));
    const raw = ok(await RawData.open(params({ datPath: ['a.bin', join(dir, 'b.bin')] }), dir));
    const start = N_SAMPLES / 2 - 5;
    expect(Array.from(await raw.readWindows([start], 10))).toEqual(expected(start, 10));
    await raw.close();
  });

  it('honours the header offset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    writeFileSync(join(dir, 'h.bin'), Buffer.concat([Buffer.alloc(16, 7), bytes]));
    const raw = ok(await RawData.open(params({ datPath: ['h.bin'], offset: 16 }), dir));
    expect(Array.from(await raw.readWindows([3], 4))).toEqual(expected(3, 4));
    await raw.close();
  });

  it('reports a missing file instead of throwing', async () => {
    expect(await RawData.open(params({ datPath: ['nope.bin'] }), base)).toEqual({ ok: false, reason: `raw data not found: ${join(base, 'nope.bin')}` });
  });

  it('reports a size that does not match n_channels_dat, dtype and offset', async () => {
    const s = await RawData.open(params(), fixtureDir('badraw'));
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toMatch(/inconsistent with n_channels_dat=8, dtype=i2, offset=0/);
  });

  it('reports an empty dat_path', async () => {
    expect(await RawData.open(params({ datPath: [] }), base)).toEqual({ ok: false, reason: 'no dat_path in params.py' });
  });
});
