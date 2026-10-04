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
