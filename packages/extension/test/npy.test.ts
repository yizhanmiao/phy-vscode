import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convert, cToFortran, fortranToC, npyHeaderBytes, readNpy, type NumArray } from '../src/host/dataset/npy';
import { writeNpy } from './fixtures/npyWrite';

const dir = mkdtempSync(join(tmpdir(), 'npy-'));
const p = (name: string) => join(dir, name);

describe('readNpy', () => {
  const cases: [string, NumArray][] = [
    ['i1', Int8Array.from([-1, 2])],
    ['i2', Int16Array.from([-300, 7])],
    ['i4', Int32Array.from([-70000, 1])],
    ['i8', BigInt64Array.from([-5n, 9n])],
    ['u1', Uint8Array.from([255, 0])],
    ['u2', Uint16Array.from([65535, 1])],
    ['u4', Uint32Array.from([4e9, 2])],
    ['u8', BigUint64Array.from([2n ** 40n, 3n])],
    ['f4', Float32Array.from([1.5, -2])],
    ['f8', Float64Array.from([Math.PI, -0.25])],
  ];
  it.each(cases)('round-trips %s', async (dtype, data) => {
    writeNpy(p(`${dtype}.npy`), data, [2]);
    const a = await readNpy(p(`${dtype}.npy`));
    expect(a.dtype).toBe(dtype);
    expect(a.shape).toEqual([2]);
    expect(Array.from(a.data as ArrayLike<unknown>)).toEqual(Array.from(data as ArrayLike<unknown>));
  });

  it('reads bool arrays as bytes', async () => {
    writeNpy(p('b.npy'), Uint8Array.from([1, 0, 1]), [3], { dtype: 'b1' });
    const a = await readNpy(p('b.npy'));
    expect(a.dtype).toBe('b1');
    expect(Array.from(a.data as Uint8Array)).toEqual([1, 0, 1]);
  });

  it.each([1, 2, 3] as const)('parses header version %i', async (version) => {
    writeNpy(p(`v${version}.npy`), Float32Array.from([1, 2, 3, 4, 5, 6]), [2, 3], { version });
    const a = await readNpy(p(`v${version}.npy`));
    expect(a.shape).toEqual([2, 3]);
    expect(Array.from(a.data as Float32Array)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('transposes Fortran-order 3-D arrays to C order', async () => {
    const c = Float32Array.from({ length: 24 }, (_, i) => i);
    writeNpy(p('f.npy'), c, [2, 3, 4], { fortran: true });
    const a = await readNpy(p('f.npy'));
    expect(a.shape).toEqual([2, 3, 4]);
    expect(Array.from(a.data as Float32Array)).toEqual(Array.from(c));
  });

  it('keeps (n, 1) Fortran vectors (MATLAB writeNPY) in shared memory without copying', async () => {
    writeNpy(p('v.npy'), BigUint64Array.from([1n, 2n, 3n]), [3, 1], { fortran: true });
    const a = await readNpy(p('v.npy'), { shared: true });
    expect(a.shape).toEqual([3, 1]);
    expect(a.data.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(Array.from(a.data as BigUint64Array)).toEqual([1n, 2n, 3n]);
  });

  it('rejects big-endian data', async () => {
    const h = Buffer.from(npyHeaderBytes('f4', [1], false).toString('latin1').replace('<f4', '>f4'), 'latin1');
    writeFileSync(p('be.npy'), Buffer.concat([h, Buffer.alloc(4)]));
    await expect(readNpy(p('be.npy'))).rejects.toThrow(/big-endian/);
  });

  it('rejects files that are not .npy', async () => {
    writeFileSync(p('x.npy'), 'hello world, this is not numpy');
    await expect(readNpy(p('x.npy'))).rejects.toThrow(/not a \.npy file/);
  });

  it('rejects truncated data', async () => {
    const h = npyHeaderBytes('f4', [4], false);
    writeFileSync(p('t.npy'), Buffer.concat([h, Buffer.alloc(8)]));
    await expect(readNpy(p('t.npy'))).rejects.toThrow(/expected 16 data bytes, got 8/);
  });
});

describe('convert', () => {
  it('converts int64 to float64 and takes column 0 of an (n, 2) array', () => {
    expect(Array.from(convert(BigInt64Array.from([10n, 1n, 20n, 2n]), Float64Array, { stride: 2 }))).toEqual([10, 20]);
  });
  it('returns the input when no conversion is needed', () => {
    const a = Int32Array.from([1]);
    expect(convert(a, Int32Array)).toBe(a);
  });
  it('allocates shared memory on request', () => {
    expect(convert(Int32Array.from([1]), Float64Array, { shared: true }).buffer).toBeInstanceOf(SharedArrayBuffer);
  });
});

describe('fortranToC / cToFortran', () => {
  it('are inverses', () => {
    const c = Int32Array.from({ length: 24 }, (_, i) => i);
    expect(Array.from(fortranToC(cToFortran(c, [2, 3, 4]), [2, 3, 4]))).toEqual(Array.from(c));
  });
});
