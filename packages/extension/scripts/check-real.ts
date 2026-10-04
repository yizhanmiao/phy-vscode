// Usage: npm run check:real -w packages/extension -- <dataset dir | params.py> [--dat <raw.bin>]
// --dat mirrors the dataset into a temp dir (symlinks) with dat_path overridden; the original is never modified.
import { mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDataset } from '../src/host/dataset/dataset';
import { Session } from '../src/host/session';
import { WorkerPool } from '../src/host/workerPool';
import { builtinViews } from '../src/views';

const args = process.argv.slice(2);
let dir = resolve(args[0] ?? '.');
if (dir.endsWith('params.py')) dir = dirname(dir);
const datAt = args.indexOf('--dat');
if (datAt >= 0) {
  const tmp = mkdtempSync(join(tmpdir(), 'phy-real-'));
  for (const f of readdirSync(dir)) if (f !== 'params.py') symlinkSync(join(dir, f), join(tmp, f));
  const params = readFileSync(join(dir, 'params.py'), 'utf8').replace(/^dat_path\s*=.*$/m, `dat_path = r'${resolve(args[datAt + 1])}'`);
  writeFileSync(join(tmp, 'params.py'), params);
  dir = tmp;
}

const since = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;
let t = performance.now();
const ds = await openDataset(join(dir, 'params.py'), {
  onProgress: (m, f) => process.stdout.write(`\r${m}${f === undefined ? '' : ` ${Math.round(f * 100)}%`}        `),
});
console.log(`\nopened in ${since(t)}: ${ds.nSpikes} spikes, ${ds.nChannels} channels, ${ds.duration.toFixed(1)} s, raw: ${ds.raw.ok ? 'ok' : ds.raw.reason}`);
t = performance.now();
const session = new Session(ds);
console.log(`session + cluster table in ${since(t)}: ${session.clusters.rows.length} clusters`);
const top = [...session.clusters.rows].sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 3).map((r) => r[0] as number);
for (const id of top) {
  const row = session.clusters.rows.find((r) => r[0] === id)!;
  console.log(`cluster ${id}: n=${row[1]} amplitude=${row[4]} depth=${row[3]} channels=${session.bestChannels(id)?.join(',')}`);
}
session.select(top);
const pool = new WorkerPool(resolve('dist/worker.cjs'));
for (const v of builtinViews) {
  t = performance.now();
  try {
    const r = await v.provider({ session, compute: pool, settings: {} }, { isCancellationRequested: false });
    const bytes = r.buffers.reduce((s, b) => s + b.byteLength, 0);
    const m = r.meta as { source?: string; notice?: string };
    console.log(`${v.id}: ${since(t)}, ${bytes} bytes${m.source ? `, source=${m.source}` : ''}${m.notice ? `, notice="${m.notice}"` : ''}`);
  } catch (e) {
    console.log(`${v.id}: ERROR ${(e as Error).message}`);
  }
}
await pool.dispose();
await ds.close();
