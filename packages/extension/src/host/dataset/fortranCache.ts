import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { readRanges } from './files';
import { ctorOf, fortranToC, npyHeaderBytes, readNpyHeader } from './npy';

type Indexable = { [i: number]: number | bigint };

/**
 * Return the path of a C-order copy of a Fortran-order .npy file, creating it under `cacheDir` once.
 * Keyed by absolute path + size + mtime; the dataset folder is never written.
 */
export async function cOrderCopy(
  path: string,
  cacheDir: string,
  onProgress?: (fraction: number) => void,
  blockBytes = 32 << 20,
): Promise<string> {
  const st = await stat(path);
  const key = createHash('sha1').update(`${resolve(path)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  const out = join(cacheDir, `${key}-${basename(path)}`);
  if (existsSync(out)) return out;
  await mkdir(cacheDir, { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  const src = await open(path, 'r');
  const dst = await open(tmp, 'w');
  try {
    const h = await readNpyHeader(src, path);
    const [n, ...rest] = h.shape;
    const inner = rest.reduce((a, b) => a * b, 1);
    const C = ctorOf(h.dtype);
    const isz = C.BYTES_PER_ELEMENT;
    const header = npyHeaderBytes(h.dtype, h.shape, false);
    await dst.write(header, 0, header.length, 0);
    // fOfC[c]: Fortran-flattened index of the inner element whose C-flattened index is c.
    const fOfC = fortranToC(Int32Array.from({ length: inner }, (_, i) => i), rest);
    const block = Math.max(1, Math.floor(blockBytes / (inner * isz)));
    for (let r0 = 0; r0 < n; r0 += block) {
      const nb = Math.min(block, n - r0);
      // In Fortran order, element (r, f) sits at f·n + r, so each inner element of the block is one contiguous run.
      const runs = await readRanges(
        src,
        Array.from({ length: inner }, (_, f) => ({ offset: h.dataOffset + (f * n + r0) * isz, length: nb * isz })),
        0,
      );
      const views = runs.map((b) => new C(b.buffer, b.byteOffset, nb) as unknown as Indexable);
      const blockOut = new C(nb * inner);
      const o = blockOut as unknown as Indexable;
      for (let c = 0; c < inner; c++) {
        const v = views[fOfC[c]];
        for (let r = 0; r < nb; r++) o[r * inner + c] = v[r];
      }
      const bytes = new Uint8Array(blockOut.buffer);
      await dst.write(bytes, 0, bytes.length, header.length + r0 * inner * isz);
      onProgress?.((r0 + nb) / n);
    }
    await dst.close();
    await src.close();
    await rename(tmp, out);
    return out;
  } catch (e) {
    await dst.close().catch(() => {});
    await src.close().catch(() => {});
    await rm(tmp, { force: true });
    throw e;
  }
}
