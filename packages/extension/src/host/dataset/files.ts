import type { FileHandle } from 'node:fs/promises';

/** Read up to buf.length bytes at `position`, looping over partial reads. Returns the bytes read. */
export async function readFully(fh: FileHandle, buf: Uint8Array, position: number): Promise<number> {
  let done = 0;
  while (done < buf.length) {
    const { bytesRead } = await fh.read(buf, done, Math.min(buf.length - done, 1 << 30), position + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return done;
}
export interface Range {
  offset: number;
  length: number;
}

const MAX_CHUNK = 16 << 20;

/** Read many byte ranges: sorted by offset, neighbours within `maxGap` coalesced. Results in input order. */
export async function readRanges(fh: FileHandle, ranges: Range[], maxGap = 4096): Promise<Uint8Array[]> {
  const order = ranges.map((_, i) => i).sort((a, b) => ranges[a].offset - ranges[b].offset);
  const out = new Array<Uint8Array>(ranges.length);
  for (let k = 0; k < order.length; ) {
    const start = ranges[order[k]].offset;
    let end = start + ranges[order[k]].length;
    let j = k + 1;
    for (; j < order.length; j++) {
      const r = ranges[order[j]];
      const e = Math.max(end, r.offset + r.length);
      if (r.offset > end + maxGap || e - start > MAX_CHUNK) break;
      end = e;
    }
    const buf = new Uint8Array(end - start);
    const got = await readFully(fh, buf, start);
    if (got < buf.length) throw new Error(`short read at byte ${start + got}`);
    for (let m = k; m < j; m++) {
      const r = ranges[order[m]];
      out[order[m]] = buf.subarray(r.offset - start, r.offset - start + r.length);
    }
    k = j;
  }
  return out;
}
