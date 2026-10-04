import { writeFileSync } from 'node:fs';
import { cToFortran, npyHeaderBytes, type NpyDtype, type NumArray } from '../../src/host/dataset/npy';

const DTYPE = new Map<unknown, NpyDtype>([
  [Int8Array, 'i1'], [Int16Array, 'i2'], [Int32Array, 'i4'], [BigInt64Array, 'i8'],
  [Uint8Array, 'u1'], [Uint16Array, 'u2'], [Uint32Array, 'u4'], [BigUint64Array, 'u8'],
  [Float32Array, 'f4'], [Float64Array, 'f8'],
]);

/** Write `data` (given in C order) as a .npy file; `fortran` stores it Fortran-ordered like MATLAB's writeNPY. */
export function writeNpy(
  path: string,
  data: NumArray,
  shape: number[],
  opts: { fortran?: boolean; version?: 1 | 2 | 3; dtype?: NpyDtype } = {},
): void {
  const dtype = opts.dtype ?? DTYPE.get(data.constructor)!;
  const body = opts.fortran ? cToFortran(data, shape) : data;
  const header = npyHeaderBytes(dtype, shape, !!opts.fortran, opts.version ?? 1);
  writeFileSync(path, Buffer.concat([header, Buffer.from(body.buffer, body.byteOffset, body.byteLength)]));
}
