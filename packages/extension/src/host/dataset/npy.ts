import { open, type FileHandle } from 'node:fs/promises';
import { readFully, readRanges } from './files';

const CTORS = {
  i1: Int8Array, i2: Int16Array, i4: Int32Array, i8: BigInt64Array,
  u1: Uint8Array, u2: Uint16Array, u4: Uint32Array, u8: BigUint64Array,
  f4: Float32Array, f8: Float64Array, b1: Uint8Array,
};
export type NpyDtype = keyof typeof CTORS;
export type NumArray =
  | Int8Array | Int16Array | Int32Array | BigInt64Array | Uint8Array
  | Uint16Array | Uint32Array | BigUint64Array | Float32Array | Float64Array;
export type AnyCtor = {
  new (lengthOrBuffer: number | ArrayBufferLike, byteOffset?: number, length?: number): NumArray;
  BYTES_PER_ELEMENT: number;
};
export const ctorOf = (d: NpyDtype) => CTORS[d] as unknown as AnyCtor;
export const itemSize = (d: NpyDtype) => CTORS[d].BYTES_PER_ELEMENT;

export interface NpyHeader {
  dtype: NpyDtype;
  fortranOrder: boolean;
  shape: number[];
  dataOffset: number;
}
export interface NpyArray {
  dtype: NpyDtype;
  shape: number[];
  data: NumArray;
}

type Indexable = { [i: number]: number | bigint; length: number };
const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

function preamble(buf: Uint8Array, path: string): { start: number; len: number; major: number } {
  if (buf.length < 10 || MAGIC.some((b, i) => buf[i] !== b)) throw new Error(`${path}: not a .npy file`);
  const major = buf[6];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (major === 1) return { start: 10, len: dv.getUint16(8, true), major };
  if ((major === 2 || major === 3) && buf.length >= 12) return { start: 12, len: dv.getUint32(8, true), major };
  throw new Error(`${path}: unsupported .npy version ${major}`);
}

export function parseNpyHeader(buf: Uint8Array, path: string): NpyHeader {
  const { start, len, major } = preamble(buf, path);
  if (buf.length < start + len) throw new Error(`${path}: truncated .npy header`);
  const text = new TextDecoder(major === 3 ? 'utf-8' : 'latin1').decode(buf.subarray(start, start + len));
  const descr = /'descr'\s*:\s*'([^']*)'/.exec(text)?.[1];
  const fortran = /'fortran_order'\s*:\s*(True|False)/.exec(text)?.[1];
  const shape = /'shape'\s*:\s*\(([^)]*)\)/.exec(text)?.[1];
  if (descr === undefined || fortran === undefined || shape === undefined) {
    throw new Error(`${path}: malformed .npy header: ${text.trim()}`);
  }
  const code = descr.slice(1);
  if (!(code in CTORS)) throw new Error(`${path}: unsupported dtype '${descr}'`);
  if (descr[0] === '>' && itemSize(code as NpyDtype) > 1) {
    throw new Error(`${path}: big-endian dtype '${descr}' is not supported`);
  }
  return {
    dtype: code as NpyDtype,
    fortranOrder: fortran === 'True',
    shape: shape.split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number),
    dataOffset: start + len,
  };
}

export async function readNpyHeader(fh: FileHandle, path: string): Promise<NpyHeader> {
  const pre = new Uint8Array(12);
  await readFully(fh, pre, 0);
  const { start, len } = preamble(pre, path);
  const buf = new Uint8Array(start + len);
  await readFully(fh, buf, 0);
  return parseNpyHeader(buf, path);
}

/** Load a whole .npy file. Fortran-ordered data is returned in C order. */
export async function readNpy(path: string, opts: { shared?: boolean } = {}): Promise<NpyArray> {
  const fh = await open(path, 'r');
  try {
    const h = await readNpyHeader(fh, path);
    const bytes = h.shape.reduce((a, b) => a * b, 1) * itemSize(h.dtype);
    const buf = opts.shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
    const got = await readFully(fh, new Uint8Array(buf), h.dataOffset);
    if (got !== bytes) throw new Error(`${path}: expected ${bytes} data bytes, got ${got}`);
    const data = new (ctorOf(h.dtype))(buf);
    return { dtype: h.dtype, shape: h.shape, data: h.fortranOrder ? fortranToC(data, h.shape) : data };
  } finally {
    await fh.close();
  }
}

/** Reorder Fortran-ordered data to C order. Arrays with at most one non-unit dimension are returned as is. */
export function fortranToC<T extends NumArray>(src: T, shape: number[]): T {
  if (shape.filter((d) => d > 1).length <= 1) return src;
  const out = new (src.constructor as AnyCtor)(src.length) as T;
  const nd = shape.length;
  const stride = new Array<number>(nd);
  const idx = new Array<number>(nd).fill(0);
  for (let d = 0, s = 1; d < nd; d++) {
    stride[d] = s;
    s *= shape[d];
  }
  const o = out as unknown as Indexable;
  const x = src as unknown as Indexable;
  for (let c = 0; c < src.length; c++) {
    let f = 0;
    for (let d = 0; d < nd; d++) f += idx[d] * stride[d];
    o[c] = x[f];
    for (let d = nd - 1; d >= 0 && ++idx[d] === shape[d]; d--) idx[d] = 0;
  }
  return out;
}

/** Inverse of fortranToC: the Fortran layout of A is the C layout of Aᵀ. */
export const cToFortran = <T extends NumArray>(src: T, shape: number[]): T => fortranToC(src, [...shape].reverse());

type Ctor<T> = { new (buffer: ArrayBufferLike): T; BYTES_PER_ELEMENT: number };

/** Convert to Int32/Float32/Float64, optionally taking one column of a row-major (n, stride) array. */
export function convert<T extends Int32Array | Float32Array | Float64Array>(
  a: NumArray,
  C: Ctor<T>,
  opts: { shared?: boolean; stride?: number; col?: number } = {},
): T {
  const stride = opts.stride ?? 1;
  const col = opts.col ?? 0;
  if (stride === 1 && (a.constructor as unknown) === C && (!opts.shared || a.buffer instanceof SharedArrayBuffer)) {
    return a as T;
  }
  const n = Math.floor(a.length / stride);
  const bytes = n * C.BYTES_PER_ELEMENT;
  const out = new C(opts.shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));
  const x = a as unknown as Indexable;
  const o = out as unknown as number[];
  for (let i = 0; i < n; i++) o[i] = Number(x[i * stride + col]);
  return out;
}

export function npyHeaderBytes(dtype: NpyDtype, shape: number[], fortran: boolean, version: 1 | 2 | 3 = 1): Buffer {
  const order = itemSize(dtype) === 1 ? '|' : '<';
  const shapeText = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
  const dict = `{'descr': '${order}${dtype}', 'fortran_order': ${fortran ? 'True' : 'False'}, 'shape': ${shapeText}, }`;
  const pre = version === 1 ? 10 : 12;
  const total = Math.ceil((pre + dict.length + 1) / 64) * 64;
  const text = dict.padEnd(total - pre - 1, ' ') + '\n';
  const buf = Buffer.alloc(pre + text.length);
  buf.write('\x93NUMPY', 0, 'latin1');
  buf[6] = version;
  if (version === 1) buf.writeUInt16LE(text.length, 8);
  else buf.writeUInt32LE(text.length, 8);
  buf.write(text, pre, 'latin1');
  return buf;
}

/** A C-order .npy file kept open for positioned reads of rows (first axis). */
export class NpyFile {
  private constructor(readonly path: string, readonly header: NpyHeader, private readonly fh: FileHandle) {}

  static async open(path: string): Promise<NpyFile> {
    const fh = await open(path, 'r');
    try {
      return new NpyFile(path, await readNpyHeader(fh, path), fh);
    } catch (e) {
      await fh.close();
      throw e;
    }
  }

  get rowLength(): number {
    return this.header.shape.slice(1).reduce((a, b) => a * b, 1);
  }

  async readRows(rows: ArrayLike<number>): Promise<NumArray> {
    if (this.header.fortranOrder) throw new Error(`${this.path}: row reads need a C-order file`);
    const rowBytes = this.rowLength * itemSize(this.header.dtype);
    const n = this.header.shape[0];
    const ranges = Array.from(rows, (r) => {
      if (!(r >= 0 && r < n)) throw new Error(`${this.path}: row ${r} out of range (0..${n - 1})`);
      return { offset: this.header.dataOffset + r * rowBytes, length: rowBytes };
    });
    let bufs: Uint8Array[];
    try {
      bufs = await readRanges(this.fh, ranges);
    } catch (e) {
      throw new Error(`${this.path}: ${(e as Error).message}`);
    }
    const out = new Uint8Array(ranges.length * rowBytes);
    bufs.forEach((b, i) => out.set(b, i * rowBytes));
    return new (ctorOf(this.header.dtype))(out.buffer);
  }

  close(): Promise<void> {
    return this.fh.close();
  }
}
