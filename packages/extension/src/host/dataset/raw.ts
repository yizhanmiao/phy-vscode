import { open, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readRanges, type Range } from './files';
import { ctorOf, itemSize, type NpyDtype } from './npy';
import type { Params } from './params';

interface RawFile {
  path: string;
  fh: FileHandle;
  nSamples: number;
}
export type RawStatus = { ok: true; raw: RawData } | { ok: false; reason: string };

const RAW_DTYPES: NpyDtype[] = ['i1', 'i2', 'i4', 'u1', 'u2', 'u4', 'f4', 'f8'];

/** Time-major interleaved raw recording, possibly split over several files read back to back. */
export class RawData {
  readonly nSamples: number;

  private constructor(
    private readonly files: RawFile[],
    readonly nChannels: number,
    readonly dtype: NpyDtype,
    private readonly offset: number,
  ) {
    this.nSamples = files.reduce((s, f) => s + f.nSamples, 0);
  }

  static async open(params: Params, dir: string): Promise<RawStatus> {
    const { datPath, nChannelsDat: nc, dtype, offset } = params;
    if (datPath.length === 0) return { ok: false, reason: 'no dat_path in params.py' };
    if (!nc) return { ok: false, reason: 'n_channels_dat missing in params.py' };
    if (!RAW_DTYPES.includes(dtype)) return { ok: false, reason: `unsupported raw dtype ${dtype}` };
    const frame = nc * itemSize(dtype);
    const files: RawFile[] = [];
    const fail = async (reason: string): Promise<RawStatus> => {
      await Promise.all(files.map((f) => f.fh.close()));
      return { ok: false, reason };
    };
    for (const p of datPath) {
      const path = resolve(dir, p);
      let fh: FileHandle;
      try {
        fh = await open(path, 'r');
      } catch {
        return fail(`raw data not found: ${path}`);
      }
      const size = (await fh.stat()).size;
      files.push({ path, fh, nSamples: (size - offset) / frame });
      if (size < offset || (size - offset) % frame !== 0) {
        return fail(`raw data size of ${path} (${size} bytes) is inconsistent with n_channels_dat=${nc}, dtype=${dtype}, offset=${offset}`);
      }
    }
    return { ok: true, raw: new RawData(files, nc, dtype, offset) };
  }

  /** Windows [start, start + length) on all channels; samples outside the recording are 0. */
  async readWindows(starts: ArrayLike<number>, length: number): Promise<Float32Array> {
    const nc = this.nChannels;
    const isz = itemSize(this.dtype);
    const frame = nc * isz;
    const out = new Float32Array(starts.length * length * nc);
    const jobs: { file: number; range: Range; dst: number }[] = [];
    for (let w = 0; w < starts.length; w++) {
      let base = 0;
      this.files.forEach((file, f) => {
        const a = Math.max(starts[w], base);
        const b = Math.min(starts[w] + length, base + file.nSamples);
        if (a < b) {
          jobs.push({ file: f, range: { offset: this.offset + (a - base) * frame, length: (b - a) * frame }, dst: (w * length + (a - starts[w])) * nc });
        }
        base += file.nSamples;
      });
    }
    for (let f = 0; f < this.files.length; f++) {
      const mine = jobs.filter((j) => j.file === f);
      let bufs: Uint8Array[];
      try {
        bufs = await readRanges(this.files[f].fh, mine.map((j) => j.range));
      } catch (e) {
        throw new Error(`${this.files[f].path}: ${(e as Error).message}`);
      }
      mine.forEach((j, i) => {
        const b = bufs[i];
        const src = new (ctorOf(this.dtype))(b.buffer, b.byteOffset, b.length / isz) as unknown as ArrayLike<number>;
        for (let k = 0; k < src.length; k++) out[j.dst + k] = src[k];
      });
    }
    return out;
  }

  async close(): Promise<void> {
    await Promise.all(this.files.map((f) => f.fh.close()));
  }
}
