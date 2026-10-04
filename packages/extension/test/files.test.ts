import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRanges } from '../src/host/dataset/files';
import { cOrderCopy } from '../src/host/dataset/fortranCache';
import { NpyFile, readNpy } from '../src/host/dataset/npy';
import { writeNpy } from './fixtures/npyWrite';

const dir = mkdtempSync(join(tmpdir(), 'files-'));
const p = (name: string) => join(dir, name);

describe('readRanges', () => {
  it('returns ranges in request order and coalesces neighbours into one read', async () => {
    writeFileSync(p('bytes.bin'), Uint8Array.from({ length: 10000 }, (_, i) => i & 255));
    const fh = await open(p('bytes.bin'), 'r');
    const [a, b, c] = await readRanges(fh, [{ offset: 9000, length: 3 }, { offset: 10, length: 2 }, { offset: 12, length: 2 }]);
    expect([...a]).toEqual([9000 & 255, 9001 & 255, 9002 & 255]);
    expect([...b]).toEqual([10, 11]);
    expect([...c]).toEqual([12, 13]);
    expect(c.buffer).toBe(b.buffer);
    await expect(readRanges(fh, [{ offset: 9999, length: 2 }])).rejects.toThrow(/short read/);
    await fh.close();
  });
});

describe('NpyFile.readRows', () => {
  it('reads rows in request order, with repeats', async () => {
    writeNpy(p('rows.npy'), Int32Array.from({ length: 20 }, (_, i) => i), [5, 2, 2]);
    const f = await NpyFile.open(p('rows.npy'));
    expect(f.rowLength).toBe(4);
    expect(Array.from((await f.readRows([3, 0, 3])) as Int32Array)).toEqual([12, 13, 14, 15, 0, 1, 2, 3, 12, 13, 14, 15]);
    await expect(f.readRows([5])).rejects.toThrow(/rows\.npy: row 5 out of range/);
    await f.close();
  });
});

describe('cOrderCopy', () => {
  it('writes a C-order copy once and reuses it', async () => {
    const c = Float32Array.from({ length: 1000 * 3 * 4 }, (_, i) => i);
    writeNpy(p('pc.npy'), c, [1000, 3, 4], { fortran: true });
    const cache = p('cache');
    const progress: number[] = [];
    const out = await cOrderCopy(p('pc.npy'), cache, (f) => progress.push(f));
    const a = await readNpy(out);
    expect(a.shape).toEqual([1000, 3, 4]);
    expect(a.data).toEqual(c);
    expect(progress.at(-1)).toBe(1);
    const mtime = statSync(out).mtimeMs;
    expect(await cOrderCopy(p('pc.npy'), cache)).toBe(out);
    expect(statSync(out).mtimeMs).toBe(mtime);
  });

  it('converts in several blocks', async () => {
    const c = BigInt64Array.from({ length: 7 * 2 }, (_, i) => BigInt(i));
    writeNpy(p('ids.npy'), c, [7, 2], { fortran: true });
    const progress: number[] = [];
    const out = await cOrderCopy(p('ids.npy'), p('cache2'), (f) => progress.push(f), 32);
    expect((await readNpy(out)).data).toEqual(c);
    expect(progress.length).toBeGreaterThan(1);
  });
});
