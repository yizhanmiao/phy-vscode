# Theia-Phy Core (data layer, compute, session, view providers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that opens a phy/Kilosort dataset, holds it in a Session (cluster table, selection, colours), and computes the data for all five plot views (Waveform, Feature, Correlogram, Amplitude, Cluster statistics) in TypeScript, verified against phylib/scipy goldens.

**Architecture:** npm workspaces with `packages/api` (public types) and `packages/extension`. `src/host/dataset/` holds lazy readers for `.npy`, `params.py`, `.tsv` and raw `.bin`; `src/compute/` holds pure numeric functions (the future WASM seam), with the heavy ones run in a `worker_threads` pool; `src/host/session.ts` owns the cluster→spike index, table and selection; `src/views/<name>/provider.ts` turns a selection into `{meta, buffers}`. In this plan the editor shows a dataset summary page or an error page. Plot rendering comes in Plan 2.

**Tech Stack:** TypeScript 5, Node ≥ 20 (VS Code's Electron), esbuild, vitest, `@vscode/test-electron`. Python is used only for dev-time goldens, through `uv` (numpy, scipy, phylib).

**Spec:** `docs/superpowers/specs/2026-10-03-phy-vscode-extension-design.md`

### Plan series

The spec covers three subsystems. This plan is the first of three. Each one ships working, testable software.

| Plan | Scope | Ships |
|---|---|---|
| **1 (this)** | Spec §3 data layer, §4 Session (no webview protocol yet), §5 providers + performance gate, §8 fixture/goldens/benchmarks/smoke | Extension opens a dataset (command or "Open With…" on `params.py`), shows a summary page or an error page naming the file, and every built-in provider returns data. Correctness is pinned by goldens. |
| 2 | §4 message protocol, commands/keys, persistence; §5 sidebar Cluster view, plot layer (WebGL2 + Canvas2D), renderers, dockview tiling | The phy UI. |
| 3 | §6 `PhyApi`, `registerView/registerClusterMetric/registerHistogram`, extension and plugin-folder delivery, `Phy: New Plugin`, `Phy: Reload Plugins` | Mods. |

Plan 2 and Plan 3 are written after this plan lands, against the real code.

## Global Constraints

- Desktop VS Code only. Remote-SSH must work, and the extension runs where the data is (`"extensionKind": ["workspace"]`).
- Pure TypeScript at runtime. **No Python at runtime.** `params.py` is parsed, never executed.
- Scale target: Neuropixels (≈10M spikes, `pc_features` GBs, raw `.bin` tens of GB). No native mmap module. Reads are positioned `fs` reads, sorted by offset and coalesced.
- Read-only in v1: **no writes into the dataset folder**. The Fortran→C cache goes under `context.globalStorageUri` (tests use a temp dir).
- `.npy`: header versions 1–3. Little-endian/native `i1 i2 i4 i8 u1 u2 u4 u8 f4 f8 b1`. Big-endian is an explicit error.
- Per-spike 1-D arrays (`spike_times`, `spike_clusters`, `spike_templates`, `amplitudes`) live in `SharedArrayBuffer`s.
- Defaults (spec §3/§5):
  - Spike caps: Waveform 100, Feature 10 000, Amplitude 20 000 spikes per cluster, with a deterministic regular stride.
  - Raw window: 82 samples (−40/+42).
  - Filter: 3rd-order Butterworth high-pass at 150 Hz, forward-backward, skipped when `hp_filtered = True`. Per-channel median subtracted.
  - Best channels: 12.
  - Correlogram: bin 1 ms, window 50 ms.
  - ISI histogram: 0–50 ms.
- A missing or unusable raw file is **not** an error. The Waveform view falls back to templates and shows the notice `"<reason> — showing templates"`.
- `cluster_info.tsv` is ignored. KS `templates_ind.npy` is ignored, so templates are treated as dense (phy behaviour).
- Python is dev-only. Goldens come from `tools/goldens` via `uv run --project tools/goldens …` and are checked in as JSON. **Tests never need Python.**
- `@types/vscode` must not be newer than `engines.vscode` (`^1.95.0` → `@types/vscode@~1.95.0`).
- All shell commands run from the repo root. Unit tests: `npm test -w packages/extension -- <filter>`.

## Review Focus

These are the five input classes most likely to bite on real data that no feature test exercises by default. Each one has a pinned test in the owning task.

1. **Raw file missing, wrong size, or `dat_path` pointing elsewhere.** The real dataset's `params.py` points to `…/Theia-Phy/ks4-…/2026-05-07-R001.bin`, which does not exist. Expected: the dataset opens, the Waveform view shows templates, and the notice names the path or the size mismatch. Also covered: `channel_map` referring to a dat channel ≥ `n_channels_dat`. *Tests:* Task 7 (reasons), Task 8 (channel_map bound), Task 16 (`noraw`/`badraw` fallback).
2. **Spikes within half a window of the recording start or end.** Expected: the window is zero-filled outside the file, then filtered. No throw, no NaN. *Tests:* Task 7 (zero-fill), Task 16 (edge-spike golden).
3. **`n_channels_dat` ≠ `channel_map` length** (real data: 32 vs 29). Raw columns must be picked through `channel_map`. *Tests:* the fixture uses 8 dat channels with 6 mapped, and Task 16's raw-waveform golden fails if columns are mis-mapped.
4. **Kilosort numeric/layout quirks**: `uint64`/`int64` `spike_times`, `uint32` `pc_feature_ind`, MATLAB `(n, 1)` Fortran vectors, Fortran-order small arrays (real `whitening_mat_inv.npy`), Fortran-order large `pc_features`, all-NaN templates, 2-D KS4 `spike_templates`. *Tests:* Task 1 (dtypes, `(n,1)`, Fortran), Task 6 (Fortran cache), Task 8 (`fortran`/`subset`/`templates2d` variants and NaN templates).
5. **Degenerate selections**: an empty selection, unknown cluster ids, a single-spike cluster, or metadata rows for clusters with no spikes. Expected: empty or zero results, never a throw. *Tests:* Task 14 (unknown ids, cluster 99), Tasks 16–18 (empty selection, cluster 50).

---

## File structure (end state of this plan)

```
.gitignore
package.json                         workspace root
tsconfig.base.json
.vscode/launch.json                  F5 "Run Theia-Phy"
packages/api/
  package.json                       @theia-phy/api (types only)
  src/index.ts                       public types: DatasetReader, PhySession, ClusterTable, ViewContext, …
packages/extension/
  package.json                       VS Code manifest + scripts
  tsconfig.json, vitest.config.ts, esbuild.mjs
  src/extension.ts                   activate(): pool, custom editor, phy.openDataset, test exports
  src/host/
    dataset/files.ts                 readFully, readRanges (sorted + coalesced positioned reads)
    dataset/npy.ts                   .npy header/array reader, NpyFile row reader, dtype conversion
    dataset/fortranCache.ts          one-time C-order copy of large Fortran .npy files
    dataset/params.ts                restricted params.py literal parser
    dataset/tsv.ts                   cluster_*.tsv/.csv metadata
    dataset/raw.ts                   raw .bin windows (multi-file, offset, zero-fill), status/reason
    dataset/dataset.ts               openDataset(): required/optional files, shape checks
    emitter.ts                       tiny Event emitter (vscode-free)
    session.ts                       Session: index, cluster table, selection, colours, best channels
    html.ts                          summary/error pages
    editor.ts                        CustomReadonlyEditorProvider
    worker.ts                        worker_threads entry
    workerPool.ts                    WorkerPool implements Compute
  src/compute/                       pure functions (WASM seam)
    linalg.ts                        invert()
    spikes.ts                        cluster index, regular subsets, sorted-set helpers
    filter.ts                        butterHighpass3, filtfilt (scipy-compatible), processWindows
    correlograms.ts                  phylib-compatible CCGs, mergeSpikeTrains, ccgBins
    templates.ts                     unwhitening, cluster mean template, best channels
    histograms.ts                    numpy-compatible histogram, ISI, firing rate
    index.ts                         computeFns registry, Compute interface, inlineCompute
  src/views/
    types.ts                         BuiltinView, HostViewContext, Cancelled
    waveform/provider.ts, feature/provider.ts, correlogram/provider.ts,
    amplitude/provider.ts, stats/provider.ts, index.ts
  scripts/check-real.ts              open a real dataset, time every provider
  test/
    fixtures/npyWrite.ts, fixtures/makeFixture.ts, fixtures/cli.ts, globalSetup.ts
    goldens/*.json                   generated by tools/goldens, checked in
    helpers.ts, *.test.ts, bench/compute.bench.ts
    smoke/run.ts, smoke/index.ts     @vscode/test-electron smoke test
tools/goldens/
  pyproject.toml, uv.lock            uv-managed dev env: numpy, scipy, phylib
  make_goldens.py                    writes packages/extension/test/goldens/*.json
  real_summary.py                    cross-check printout for a real dataset
```

**Deliberately not loaded in v1 (YAGNI).** No v1 view reads these, so they are skipped: `template_features.npy`, `template_feature_ind.npy`, `template_feature_spike_ids.npy` (the Feature view uses PCs), `similar_templates.npy` (the Similarity view is out of scope), and `channel_probe.npy`. Add a reader in the plan whose view first needs one.

---

### Task 1: Workspace scaffold, public types, `.npy` reader

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.base.json`
- Create: `packages/api/package.json`, `packages/api/src/index.ts`
- Create: `packages/extension/package.json`, `packages/extension/tsconfig.json`, `packages/extension/vitest.config.ts`
- Create: `packages/extension/src/host/dataset/files.ts`, `packages/extension/src/host/dataset/npy.ts`
- Create: `packages/extension/test/fixtures/npyWrite.ts`
- Test: `packages/extension/test/npy.test.ts`

**Interfaces:**
- Produces (`@theia-phy/api`): `Disposable`, `Event<T>`, `CancellationToken`, `Cell`, `ClusterTable`, `ClusterUpdate`, `DatasetReader`, `PhySession`, `ComputeContext`, `ViewContext`, `ViewResult`, `HistogramDefinition`. Exact text is in Step 1.
- Produces (`files.ts`): `readFully(fh: FileHandle, buf: Uint8Array, position: number): Promise<number>`
- Produces (`npy.ts`):
  - `type NpyDtype = 'i1'|'i2'|'i4'|'i8'|'u1'|'u2'|'u4'|'u8'|'f4'|'f8'|'b1'`
  - `type NumArray`, the union of the 10 typed-array types
  - `interface NpyHeader { dtype; fortranOrder: boolean; shape: number[]; dataOffset: number }`
  - `interface NpyArray { dtype; shape: number[]; data: NumArray }`
  - `type AnyCtor`, `ctorOf(dtype): AnyCtor`, `itemSize(dtype): number`
  - `parseNpyHeader(buf, path)`, `readNpyHeader(fh, path)`
  - `readNpy(path, { shared? }): Promise<NpyArray>`. Fortran arrays are returned in C order.
  - `fortranToC(src, shape)`, `cToFortran(src, shape)`
  - `convert(a, Int32Array|Float32Array|Float64Array, { shared?, stride?, col? })`
  - `npyHeaderBytes(dtype, shape, fortran, version = 1): Buffer`
- Produces (test): `writeNpy(path, data, shape, { fortran?, version?, dtype? })`

- [ ] **Step 1: Scaffold the workspace**

`.gitignore`:
```
node_modules/
dist/
dist-test/
.vscode-test/
*.vsix
packages/extension/test/fixtures/out/
tools/goldens/.venv/
/dataset/
.omc/
.DS_Store
```

`package.json`:
```json
{
  "name": "theia-phy-workspace",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build -w packages/extension",
    "test": "npm test -w packages/extension",
    "typecheck": "npm run typecheck -w packages/extension"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`packages/api/package.json`:
```json
{
  "name": "@theia-phy/api",
  "version": "0.1.0",
  "description": "Public types for Theia-Phy views and mods",
  "types": "src/index.ts",
  "main": "src/index.ts"
}
```

`packages/api/src/index.ts`:
```ts
// @theia-phy/api — public types shared by Theia-Phy and its mods. Types only; follows semver.

export interface Disposable {
  dispose(): void;
}
export type Event<T> = (listener: (e: T) => void) => Disposable;
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
}

export type Cell = number | string | null;
/** Cluster table: `rows[i][k]` is the value of `columns[k]` for one cluster; column 0 is `id`. */
export interface ClusterTable {
  readonly columns: string[];
  readonly rows: Cell[][];
}
/** Fired by curation (not in v1). */
export interface ClusterUpdate {
  added: number[];
  deleted: number[];
  descendants: [number, number][];
}

/** Read-only view of a loaded dataset. Per-spike arrays may live in SharedArrayBuffers. */
export interface DatasetReader {
  readonly dir: string;
  readonly sampleRate: number;
  readonly nSpikes: number;
  readonly nChannels: number;
  /** Seconds: (last spike time + 1) / sampleRate. */
  readonly duration: number;
  /** Spike times in samples. */
  readonly spikeTimes: Float64Array;
  readonly spikeClusters: Int32Array;
  readonly spikeTemplates?: Int32Array;
  readonly amplitudes?: Float32Array;
  readonly channelMap: Int32Array;
  /** nChannels × 2 (x, y), row-major. */
  readonly channelPositions: Float32Array;
  readonly channelShanks?: Int32Array;
}

export interface PhySession {
  readonly dataset: DatasetReader;
  readonly clusters: ClusterTable;
  readonly selection: readonly number[];
  select(ids: number[]): void;
  /** Spike indices of a cluster, ascending. Empty for unknown ids. Do not mutate. */
  spikesOf(clusterId: number): Int32Array;
  /** CSS colour of a cluster: phy palette by selection order, grey when not selected. */
  colorOf(clusterId: number): string;
  readonly onDidChangeSelection: Event<readonly number[]>;
  readonly onDidChangeClusters: Event<ClusterUpdate>;
}

export interface ComputeContext {
  readonly session: PhySession;
}
export interface ViewContext extends ComputeContext {
  readonly settings: Readonly<Record<string, unknown>>;
}
export interface ViewResult {
  meta: unknown;
  buffers: ArrayBufferLike[];
}

export interface HistogramDefinition {
  id: string;
  label: string;
  unit?: string;
  /** x range covered by the bins; renderers fall back to bin indices when absent. */
  range?(ctx: ComputeContext): [number, number];
  compute(spikeIds: Int32Array, ctx: ComputeContext): Float64Array;
}
```

`packages/extension/package.json`:
```json
{
  "name": "theia-phy",
  "displayName": "Theia-Phy",
  "description": "Browse phy/Kilosort spike-sorting datasets in VS Code.",
  "publisher": "theia-phy",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": { "vscode": "^1.95.0" },
  "extensionKind": ["workspace"],
  "main": "./dist/extension.cjs",
  "contributes": {},
  "scripts": {
    "build": "node esbuild.mjs",
    "test": "vitest run",
    "bench": "vitest bench --run",
    "fixtures": "tsx test/fixtures/cli.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@theia-phy/api": "0.1.0" }
}
```

`packages/extension/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node", "vscode"] },
  "include": ["src", "test", "scripts", "vitest.config.ts"]
}
```

`packages/extension/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 },
});
```

Install:
```bash
npm install
npm install -D -w packages/extension typescript vitest esbuild tsx @types/node @types/vscode@~1.95.0 @vscode/test-electron
```

- [ ] **Step 2: Write the failing tests**

`packages/extension/test/fixtures/npyWrite.ts`:
```ts
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
```

`packages/extension/test/npy.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test -w packages/extension -- npy`
Expected: FAIL, because `src/host/dataset/npy` cannot be resolved.

- [ ] **Step 4: Implement `files.ts` and `npy.ts`**

`packages/extension/src/host/dataset/files.ts`:
```ts
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
```

`packages/extension/src/host/dataset/npy.ts`:
```ts
import { open, type FileHandle } from 'node:fs/promises';
import { readFully } from './files';

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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- npy` then `npm run typecheck`
Expected: all `npy.test.ts` tests PASS, and typecheck reports no errors.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.base.json packages/api packages/extension/package.json packages/extension/tsconfig.json packages/extension/vitest.config.ts packages/extension/src/host/dataset/files.ts packages/extension/src/host/dataset/npy.ts packages/extension/test/fixtures/npyWrite.ts packages/extension/test/npy.test.ts
git commit -m "feat: workspace scaffold, public API types, .npy reader"
```

---

### Task 2: `params.py` parser

**Files:**
- Create: `packages/extension/src/host/dataset/params.ts`
- Test: `packages/extension/test/params.test.ts`

**Interfaces:**
- Consumes: `NpyDtype` (Task 1).
- Produces:
  - `type PyValue = string | number | boolean | null | PyValue[]`
  - `parsePythonLiterals(src: string, file?: string): Record<string, PyValue>`. Errors read `"<file>:<line>: <msg>"`.
  - `interface Params { datPath: string[]; nChannelsDat?: number; dtype: NpyDtype; offset: number; sampleRate: number; hpFiltered: boolean }`
  - `toParams(values, file?): Params`
  - `readParams(path): Promise<Params>`

- [ ] **Step 1: Write the failing test**

`packages/extension/test/params.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parsePythonLiterals, toParams } from '../src/host/dataset/params';

const parse = (src: string) => toParams(parsePythonLiterals(src));

describe('params.py', () => {
  it('parses the real Kilosort 4 params.py', () => {
    const p = parse(`n_channels_dat = 32
offset = 0
sample_rate = 30000.0
dtype = 'int16'
hp_filtered = False
dat_path = ['/data/2026-05-07-R001.bin']
`);
    expect(p).toEqual({ datPath: ['/data/2026-05-07-R001.bin'], nChannelsDat: 32, dtype: 'i2', offset: 0, sampleRate: 30000, hpFiltered: false });
  });

  it('handles raw Windows paths, comments, multi-line lists and trailing commas', () => {
    const v = parsePythonLiterals(`# exported by phy
dat_path = [  # two parts
    r'C:\\data\\a.bin',
    "b \\"quoted\\".bin",
]
x = (1, 2.5e3, -3, True, None)
`);
    expect(v.dat_path).toEqual(['C:\\data\\a.bin', 'b "quoted".bin']);
    expect(v.x).toEqual([1, 2500, -3, true, null]);
  });

  it('accepts a single string dat_path, numpy-style dtypes and hp_filtered', () => {
    const p = parse(`dat_path = 'raw.bin'\nn_channels_dat = 4\ndtype = '<f4'\nsample_rate = 2e4\nhp_filtered = True\n`);
    expect(p).toMatchObject({ datPath: ['raw.bin'], dtype: 'f4', sampleRate: 20000, hpFiltered: true, offset: 0 });
  });

  it('treats an empty dat_path as no raw data', () => {
    expect(parse(`dat_path = ''\nsample_rate = 1000.`).datPath).toEqual([]);
  });

  it('never executes code and names the offending line', () => {
    expect(() => parsePythonLiterals('import numpy as np\n', 'params.py')).toThrow(/^params\.py:1: /);
    expect(() => parsePythonLiterals('a = 1\nb = 2\ndtype = np.int16\n', 'params.py')).toThrow(/^params\.py:3: unsupported syntax/);
    expect(() => parsePythonLiterals("s = 'open\n", 'params.py')).toThrow(/params\.py:1: unterminated string/);
  });

  it('requires a numeric sample_rate and a known dtype', () => {
    expect(() => parse(`dat_path = 'x.bin'`)).toThrow(/'sample_rate' must be a number/);
    expect(() => parse(`sample_rate = 1.\ndtype = 'complex64'`)).toThrow(/unsupported dtype "complex64"/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- params`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/host/dataset/params.ts`:
```ts
import { readFile } from 'node:fs/promises';
import type { NpyDtype } from './npy';

export type PyValue = string | number | boolean | null | PyValue[];

export interface Params {
  datPath: string[];
  nChannelsDat?: number;
  dtype: NpyDtype;
  offset: number;
  sampleRate: number;
  hpFiltered: boolean;
}

/** Parse `name = <literal>` lines (strings incl. r'', numbers, booleans, None, lists/tuples). Never executes code. */
export function parsePythonLiterals(src: string, file = 'params.py'): Record<string, PyValue> {
  let i = 0;
  function fail(msg: string): never {
    throw new Error(`${file}:${src.slice(0, i).split('\n').length}: ${msg}`);
  }
  function at(re: RegExp): RegExpExecArray | null {
    re.lastIndex = i;
    const m = re.exec(src);
    if (m) i += m[0].length;
    return m;
  }
  function skip(newlines: boolean): void {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r' || (newlines && c === '\n')) i++;
      else if (c === '#') while (i < src.length && src[i] !== '\n') i++;
      else return;
    }
  }
  function str(raw: boolean, q: string): string {
    if (src[i] === q && src[i + 1] === q) fail('triple-quoted strings are not supported');
    let out = '';
    for (;;) {
      const c = src[i];
      if (c === undefined || c === '\n') fail('unterminated string');
      i++;
      if (c === q) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const n = src[i++];
      if (n === undefined) fail('unterminated string');
      out += raw ? '\\' + n : ({ n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' } as Record<string, string>)[n] ?? '\\' + n;
    }
  }
  function value(depth: number): PyValue {
    skip(depth > 0);
    const c = src[i];
    if (c === '[' || c === '(') {
      const close = c === '[' ? ']' : ')';
      i++;
      const items: PyValue[] = [];
      for (;;) {
        skip(true);
        if (src[i] === close) {
          i++;
          return items;
        }
        items.push(value(depth + 1));
        skip(true);
        if (src[i] === ',') i++;
        else if (src[i] !== close) fail(`expected ',' or '${close}'`);
      }
    }
    let m = at(/([rRuU]?)(['"])/y);
    if (m) return str(m[1].toLowerCase() === 'r', m[2]);
    if ((m = at(/[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y))) return Number(m[0].replace(/_/g, ''));
    if ((m = at(/(?:True|False|None)\b/y))) return m[0] === 'None' ? null : m[0] === 'True';
    return fail(`unsupported syntax: ${src.slice(i).split('\n')[0]}`);
  }

  const out: Record<string, PyValue> = {};
  for (;;) {
    skip(true);
    if (i >= src.length) return out;
    const name = at(/[A-Za-z_]\w*/y);
    if (!name) fail(`unsupported syntax: ${src.slice(i).split('\n')[0]}`);
    skip(false);
    if (src[i] !== '=' || src[i + 1] === '=') fail(`unsupported syntax: expected '=' after '${name[0]}'`);
    i++;
    out[name[0]] = value(0);
    skip(false);
    if (i < src.length && src[i] !== '\n') fail(`unsupported syntax after '${name[0]}'`);
  }
}

const DTYPES: Record<string, NpyDtype> = {
  int8: 'i1', int16: 'i2', int32: 'i4', int64: 'i8', uint8: 'u1', uint16: 'u2',
  uint32: 'u4', uint64: 'u8', float32: 'f4', float64: 'f8',
};

export function toParams(v: Record<string, PyValue>, file = 'params.py'): Params {
  const num = (k: string, fallback?: number): number => {
    const x = v[k] ?? fallback;
    if (typeof x !== 'number') throw new Error(`${file}: '${k}' must be a number`);
    return x;
  };
  const dp = v.dat_path ?? [];
  const datPath = (Array.isArray(dp) ? dp : [dp])
    .map((p) => {
      if (typeof p !== 'string') throw new Error(`${file}: 'dat_path' must be a string or a list of strings`);
      return p;
    })
    .filter((p) => p !== '');
  const dt = v.dtype ?? 'int16';
  const dtype =
    typeof dt === 'string'
      ? DTYPES[dt] ?? (/^[<|=]?(i[1248]|u[1248]|f[48])$/.exec(dt)?.[1] as NpyDtype | undefined)
      : undefined;
  if (!dtype) throw new Error(`${file}: unsupported dtype ${JSON.stringify(dt)}`);
  return {
    datPath,
    nChannelsDat: v.n_channels_dat === undefined ? undefined : num('n_channels_dat'),
    dtype,
    offset: num('offset', 0),
    sampleRate: num('sample_rate'),
    hpFiltered: v.hp_filtered === true,
  };
}

export async function readParams(path: string): Promise<Params> {
  return toParams(parsePythonLiterals(await readFile(path, 'utf8'), path), path);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- params`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/dataset/params.ts packages/extension/test/params.test.ts
git commit -m "feat: restricted params.py literal parser"
```

---

### Task 3: Cluster metadata (`cluster_*.tsv` / `.csv`)

**Files:**
- Create: `packages/extension/src/host/dataset/tsv.ts`
- Test: `packages/extension/test/tsv.test.ts`

**Interfaces:**
- Consumes: `Cell` from `@theia-phy/api`.
- Produces:
  - `parseClusterTable(text, sep, file): { field: string; values: Map<number, Cell> }`
  - `readClusterMetadata(dir): Promise<Map<string, Map<number, Cell>>>`, keyed by field name, files read in sorted name order, `cluster_info.tsv` ignored.
  - Value rules: a column is numeric when every non-empty value parses as a number. Empty values and `nan` become `null`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/tsv.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClusterTable, readClusterMetadata } from '../src/host/dataset/tsv';

describe('cluster metadata', () => {
  it('parses CRLF files with empty values and keeps string columns as strings', () => {
    const t = parseClusterTable('cluster_id\tgroup\r\n0\tgood\r\n1\t\r\n2\tmua\r\n', '\t', 'cluster_group.tsv');
    expect(t.field).toBe('group');
    expect([...t.values]).toEqual([[0, 'good'], [1, null], [2, 'mua']]);
  });

  it('makes numeric columns numbers and nan null', () => {
    const t = parseClusterTable('cluster_id\tContamPct\n0\t150.7\n1\tnan\n2\t0.0\n', '\t', 'f');
    expect([...t.values]).toEqual([[0, 150.7], [1, null], [2, 0]]);
  });

  it('names the line of a bad cluster id', () => {
    expect(() => parseClusterTable('cluster_id\tx\nabc\t1\n', '\t', 'cluster_x.tsv')).toThrow(/cluster_x\.tsv:2: bad cluster id/);
  });

  it('reads every cluster_*.tsv/.csv except cluster_info.tsv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsv-'));
    writeFileSync(join(dir, 'cluster_group.tsv'), 'cluster_id\tgroup\n3\tnoise\n');
    writeFileSync(join(dir, 'cluster_Amplitude.csv'), 'cluster_id,Amplitude\n3,9.8\n');
    writeFileSync(join(dir, 'cluster_info.tsv'), 'cluster_id\tshould_not_appear\n3\t1\n');
    const m = await readClusterMetadata(dir);
    expect([...m.keys()]).toEqual(['Amplitude', 'group']);
    expect(m.get('Amplitude')!.get(3)).toBe(9.8);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- tsv`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/host/dataset/tsv.ts`:
```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cell } from '@theia-phy/api';

const isMissing = (v: string) => v === '' || /^nan$/i.test(v);

export function parseClusterTable(text: string, sep: string, file: string): { field: string; values: Map<number, Cell> } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = (lines[0] ?? '').split(sep).map((s) => s.trim());
  if (header.length < 2) throw new Error(`${file}: expected a header "cluster_id${sep === '\t' ? '<TAB>' : sep}<field>"`);
  const rows: [number, string][] = lines.slice(1).map((line, k) => {
    const cols = line.split(sep);
    const id = Number(cols[0].trim());
    if (!Number.isInteger(id)) throw new Error(`${file}:${k + 2}: bad cluster id '${cols[0]}'`);
    return [id, (cols[1] ?? '').trim()];
  });
  const numeric = rows.every(([, v]) => isMissing(v) || !Number.isNaN(Number(v)));
  return {
    field: header[1],
    values: new Map(rows.map(([id, v]) => [id, isMissing(v) ? null : numeric ? Number(v) : v])),
  };
}

/** Every cluster_<field>.tsv/.csv in `dir` (phy ignores cluster_info.tsv). */
export async function readClusterMetadata(dir: string): Promise<Map<string, Map<number, Cell>>> {
  const out = new Map<string, Map<number, Cell>>();
  const names = (await readdir(dir))
    .filter((n) => /^cluster_.+\.(tsv|csv)$/.test(n) && n !== 'cluster_info.tsv')
    .sort();
  for (const name of names) {
    const sep = name.endsWith('.csv') ? ',' : '\t';
    const { field, values } = parseClusterTable(await readFile(join(dir, name), 'utf8'), sep, name);
    if (!out.has(field)) out.set(field, values);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- tsv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/dataset/tsv.ts packages/extension/test/tsv.test.ts
git commit -m "feat: cluster_*.tsv metadata reader"
```

---

### Task 4: Synthetic fixture generator (all variants)

**Files:**
- Create: `packages/extension/test/fixtures/makeFixture.ts`, `packages/extension/test/fixtures/cli.ts`, `packages/extension/test/globalSetup.ts`
- Modify: `packages/extension/vitest.config.ts` (add `globalSetup`)
- Test: `packages/extension/test/fixture.test.ts`

**Interfaces:**
- Consumes: `writeNpy` (Task 1), `readNpy` (Task 1).
- Produces:
  - Constants `SR = 30000`, `N_SAMPLES = 60000`, `N_CHANNELS_DAT = 8`, `NS_TEMPLATE = 31`, `CHANNEL_MAP = [0,1,2,3,5,6]`, `POSITIONS`, `SHANKS = [0,0,0,0,1,1]`, `CLUSTER_IDS = [2, 7, 11, 40, 50]`
  - `VARIANTS`, `type Variant`, `OUT`, `fixtureDir(v)`, `fixtureParams(v)`
  - `rng(seed): () => number`, `makeAllFixtures(): void`

Fixture facts that later tests rely on:
- **Templates.** There are 4 templates, peaking on channels 0, 2, 3 and 4. Template 3 lives on shank 1.
- **Clusters.** Template 0 → cluster 2, template 1 → cluster 7 (every 5th spike goes to cluster 11 instead), templates 2 and 3 → cluster 40. Cluster 40 is therefore a two-template cluster.
- **Single-spike cluster.** Cluster 50 has exactly one spike.
- **Edge spikes.** Spikes at sample 5 and at sample `N_SAMPLES − 3` belong to cluster 2.
- **Metadata.** `cluster_group.tsv` lists cluster 99, which has no spikes, and uses CRLF line endings.
- **Whitening.** The whitening matrix is block-diagonal `[[1, .25], [.25, 1]]`, so its inverse is known in closed form.
- **Raw data.** Raw = 2 Hz drift + noise + `amplitude × unwhitened template`, written on dat columns `CHANNEL_MAP[c]`. Dat columns 4 and 7 are unused.

| Variant | Differs from `base` |
|---|---|
| `base` | `spike_times` uint64 `(n,)`, dense templates, `templates_ind.npy` present (must be ignored), raw present |
| `fortran` | `spike_times` uint64 `(n,1)` F, `amplitudes` f8 `(n,1)` F, `templates`/`whitening_mat_inv`/`pc_features` Fortran-ordered |
| `sparse` | `templates.npy` `(4,31,3)` + `template_ind.npy`. Template 1's third column is `-1`. |
| `subset` | `spike_times` int64, `pc_features` only for even spikes + `pc_feature_spike_ids.npy` |
| `templates2d` | `spike_templates` `(n,2)`, no `spike_clusters.npy` |
| `noraw` | `dat_path = r'missing.bin'`, no `whitening_mat_inv.npy` |
| `badraw` | `raw.bin` 3 bytes short |
| `precomputed` | `_phy_spikes_subset.{spikes,channels,waveforms}.npy` for every 3rd spike. The waveform value at flat index `i` is `i % 997`. |
| `minimal` | only `params.py` (`dat_path = r''`), `spike_times`, `spike_templates`, `channel_map`, `channel_positions` |

- [ ] **Step 1: Write the failing test**

`packages/extension/test/fixture.test.ts`:
```ts
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNpy } from '../src/host/dataset/npy';
import { CLUSTER_IDS, fixtureDir, fixtureParams, N_CHANNELS_DAT, N_SAMPLES, VARIANTS } from './fixtures/makeFixture';

describe('fixture', () => {
  it('writes every variant', () => {
    for (const v of VARIANTS) expect(existsSync(fixtureParams(v)), v).toBe(true);
  });
  it('writes int16 raw data of n_samples × n_channels_dat', () => {
    expect(statSync(join(fixtureDir('base'), 'raw.bin')).size).toBe(N_SAMPLES * N_CHANNELS_DAT * 2);
  });
  it('has sorted uint64 spike times, edge spikes and the expected clusters', async () => {
    const t = await readNpy(join(fixtureDir('base'), 'spike_times.npy'));
    expect(t.dtype).toBe('u8');
    const times = Array.from(t.data as BigUint64Array, Number);
    expect(times.every((x, i) => i === 0 || x >= times[i - 1])).toBe(true);
    expect(times[0]).toBe(5);
    expect(times.at(-1)).toBe(N_SAMPLES - 3);
    const c = await readNpy(join(fixtureDir('base'), 'spike_clusters.npy'));
    const ids = [...new Set(c.data as Int32Array)].sort((a, b) => a - b);
    expect(ids).toEqual(CLUSTER_IDS);
    expect(Array.from(c.data as Int32Array).filter((x) => x === 50)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- fixture`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement the generator**

`packages/extension/test/fixtures/makeFixture.ts`:
```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NumArray } from '../../src/host/dataset/npy';
import { writeNpy } from './npyWrite';

export const SR = 30000;
export const N_SAMPLES = 60000;
export const N_CHANNELS_DAT = 8;
export const NS_TEMPLATE = 31;
export const CHANNEL_MAP = [0, 1, 2, 3, 5, 6];
export const POSITIONS = [[0, 0], [16, 20], [0, 40], [16, 60], [0, 80], [16, 100]];
export const SHANKS = [0, 0, 0, 0, 1, 1];
export const CLUSTER_IDS = [2, 7, 11, 40, 50];
const PEAKS = [0, 2, 3, 4];
const RATES = [120, 100, 50, 30]; // Hz
const TEMPLATE_CLUSTER = [2, 7, 40, 40];

export const VARIANTS = ['base', 'fortran', 'sparse', 'subset', 'templates2d', 'noraw', 'badraw', 'precomputed', 'minimal'] as const;
export type Variant = (typeof VARIANTS)[number];
export const OUT = fileURLToPath(new URL('./out', import.meta.url));
export const fixtureDir = (v: Variant) => join(OUT, v);
export const fixtureParams = (v: Variant) => join(OUT, v, 'params.py');

/** mulberry32: small deterministic PRNG in [0, 1). */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function nearest(c0: number): number[] {
  const [x0, y0] = POSITIONS[c0];
  const d = (c: number) => (POSITIONS[c][0] - x0) ** 2 + (POSITIONS[c][1] - y0) ** 2;
  return POSITIONS.map((_, c) => c).sort((a, b) => d(a) - d(b) || a - b);
}

interface Model {
  times: number[];
  templates: Int32Array;
  clusters: Int32Array;
  amps: Float32Array;
  tw: Float32Array;
  W: Float64Array;
  Winv: Float64Array;
  raw: Int16Array;
  pc: Float32Array;
  pcInd: Uint32Array;
}

function buildModel(): Model {
  const r = rng(42);
  const nC = CHANNEL_MAP.length;
  const nT = PEAKS.length;

  // Whitening: three 2×2 blocks [[1, .25], [.25, 1]] with a closed-form inverse.
  const W = new Float64Array(nC * nC);
  const Winv = new Float64Array(nC * nC);
  const det = 1 - 0.25 * 0.25;
  for (let b = 0; b < nC; b += 2) {
    W[b * nC + b] = W[(b + 1) * nC + b + 1] = 1;
    W[b * nC + b + 1] = W[(b + 1) * nC + b] = 0.25;
    Winv[b * nC + b] = Winv[(b + 1) * nC + b + 1] = 1 / det;
    Winv[b * nC + b + 1] = Winv[(b + 1) * nC + b] = -0.25 / det;
  }

  // Unwhitened templates: negative peak at sample 10, decaying with distance, zero on other shanks.
  const tu = new Float64Array(nT * NS_TEMPLATE * nC);
  for (let t = 0; t < nT; t++) {
    for (let c = 0; c < nC; c++) {
      const [px, py] = POSITIONS[PEAKS[t]];
      const [x, y] = POSITIONS[c];
      const g = SHANKS[c] === SHANKS[PEAKS[t]] ? Math.exp(-Math.hypot(x - px, y - py) / 30) : 0;
      for (let s = 0; s < NS_TEMPLATE; s++) {
        tu[(t * NS_TEMPLATE + s) * nC + c] = g * (-4 * Math.exp(-(((s - 10) / 2) ** 2)) + 1.6 * Math.exp(-(((s - 16) / 4) ** 2)));
      }
    }
  }
  // Kilosort stores whitened templates tw = tu · W; phy unwhitens with tw · W⁻¹.
  const tw = new Float32Array(tu.length);
  for (let row = 0; row < nT * NS_TEMPLATE; row++) {
    for (let j = 0; j < nC; j++) {
      let acc = 0;
      for (let k = 0; k < nC; k++) acc += tu[row * nC + k] * W[k * nC + j];
      tw[row * nC + j] = acc;
    }
  }

  // Spikes: Poisson trains with a 2 ms refractory period, plus one spike at each recording edge.
  const spikes: [number, number][] = [[5, 0], [N_SAMPLES - 3, 0]];
  for (let t = 0; t < nT; t++) {
    for (let s = 100 + Math.floor(r() * 300); s < N_SAMPLES - 100; s += 60 + Math.floor(-Math.log(1 - r()) * (SR / RATES[t]))) {
      spikes.push([s, t]);
    }
  }
  spikes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = spikes.length;
  const templates = Int32Array.from(spikes, ([, t]) => t);
  const clusters = Int32Array.from(spikes, ([, t]) => TEMPLATE_CLUSTER[t]);
  let k1 = 0;
  for (let i = 0; i < n; i++) if (templates[i] === 1 && k1++ % 5 === 0) clusters[i] = 11;
  clusters[templates.findIndex((t, i) => t === 0 && i >= 100)] = 50;

  const amps = Float32Array.from(spikes, () => 15 + 10 * r());
  const rawF = new Float64Array(N_SAMPLES * N_CHANNELS_DAT);
  for (let i = 0; i < N_SAMPLES; i++) {
    const drift = 100 * Math.sin((2 * Math.PI * 2 * i) / SR);
    for (let ch = 0; ch < N_CHANNELS_DAT; ch++) rawF[i * N_CHANNELS_DAT + ch] = drift + 3 * gauss(r);
  }
  spikes.forEach(([s, t], i) => {
    for (let k = 0; k < NS_TEMPLATE; k++) {
      const smp = s - 10 + k;
      if (smp < 0 || smp >= N_SAMPLES) continue;
      for (let c = 0; c < nC; c++) rawF[smp * N_CHANNELS_DAT + CHANNEL_MAP[c]] += amps[i] * tu[(t * NS_TEMPLATE + k) * nC + c];
    }
  });
  const raw = Int16Array.from(rawF, Math.round);

  const pcInd = new Uint32Array(nT * 4);
  for (let t = 0; t < nT; t++) pcInd.set(nearest(PEAKS[t]).slice(0, 4), t * 4);
  const pc = new Float32Array(n * 3 * 4);
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < 3; p++) {
      for (let j = 0; j < 4; j++) pc[(i * 3 + p) * 4 + j] = gauss(r) + (templates[i] + 1) * (p + 1) * (j === 0 ? 1 : 0.5);
    }
  }
  return { times: spikes.map(([s]) => s), templates, clusters, amps, tw, W, Winv, raw, pc, pcInd };
}

function writeVariant(v: Variant, m: Model): void {
  const dir = fixtureDir(v);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = m.times.length;
  const nC = CHANNEL_MAP.length;
  const nT = PEAKS.length;
  const F = v === 'fortran';
  const w = (name: string, data: NumArray, shape: number[], fortran = false) => writeNpy(join(dir, name), data, shape, { fortran });

  const datPath = v === 'noraw' ? 'missing.bin' : v === 'minimal' ? '' : 'raw.bin';
  writeFileSync(
    join(dir, 'params.py'),
    `# generated by test/fixtures/makeFixture.ts\ndat_path = r'${datPath}'\nn_channels_dat = ${N_CHANNELS_DAT}\ndtype = 'int16'\noffset = 0\nsample_rate = ${SR}.\nhp_filtered = False\n`,
  );

  if (v === 'subset') w('spike_times.npy', BigInt64Array.from(m.times, BigInt), [n]);
  else w('spike_times.npy', BigUint64Array.from(m.times, BigInt), F ? [n, 1] : [n], F);
  if (v === 'templates2d') w('spike_templates.npy', Int32Array.from({ length: 2 * n }, (_, i) => m.templates[i >> 1]), [n, 2]);
  else w('spike_templates.npy', m.templates, [n]);
  if (v !== 'templates2d' && v !== 'minimal') w('spike_clusters.npy', m.clusters, [n]);
  w('channel_map.npy', Int32Array.from(CHANNEL_MAP), [nC]);
  w('channel_positions.npy', Float32Array.from(POSITIONS.flat()), [nC, 2]);
  if (v === 'minimal') return;

  w('channel_shanks.npy', Int32Array.from(SHANKS), [nC]);
  w('amplitudes.npy', F ? Float64Array.from(m.amps) : m.amps, F ? [n, 1] : [n], F);
  w('whitening_mat.npy', Float32Array.from(m.W), [nC, nC]);
  if (v !== 'noraw') w('whitening_mat_inv.npy', Float32Array.from(m.Winv), [nC, nC], F);
  if (v === 'sparse') {
    const cols = new Int32Array(nT * 3);
    const data = new Float32Array(nT * NS_TEMPLATE * 3);
    for (let t = 0; t < nT; t++) {
      const near = nearest(PEAKS[t]).slice(0, 3);
      if (t === 1) near[2] = -1; // unused column (phy convention)
      cols.set(near, t * 3);
      for (let s = 0; s < NS_TEMPLATE; s++) {
        near.forEach((c, k) => {
          if (c >= 0) data[(t * NS_TEMPLATE + s) * 3 + k] = m.tw[(t * NS_TEMPLATE + s) * nC + c];
        });
      }
    }
    w('templates.npy', data, [nT, NS_TEMPLATE, 3]);
    w('template_ind.npy', cols, [nT, 3]);
  } else {
    w('templates.npy', m.tw, [nT, NS_TEMPLATE, nC], F);
  }
  // Kilosort's templates_ind.npy (with an s) must be ignored: phy treats templates as dense.
  w('templates_ind.npy', BigInt64Array.from({ length: nT * nC }, (_, i) => BigInt(i % nC)), [nT, nC]);
  if (v === 'subset') {
    const ids = Array.from({ length: Math.ceil(n / 2) }, (_, i) => 2 * i);
    w('pc_feature_spike_ids.npy', BigInt64Array.from(ids, BigInt), [ids.length]);
    const rows = new Float32Array(ids.length * 12);
    ids.forEach((s, i) => rows.set(m.pc.subarray(s * 12, s * 12 + 12), i * 12));
    w('pc_features.npy', rows, [ids.length, 3, 4]);
  } else {
    w('pc_features.npy', m.pc, [n, 3, 4], F);
  }
  w('pc_feature_ind.npy', m.pcInd, [nT, 4]);

  writeFileSync(join(dir, 'cluster_group.tsv'), 'cluster_id\tgroup\r\n2\tgood\r\n7\tmua\r\n11\tnoise\r\n40\tgood\r\n50\t\r\n99\tgood\r\n');
  writeFileSync(join(dir, 'cluster_KSLabel.tsv'), 'cluster_id\tKSLabel\n2\tgood\n7\tmua\n11\tmua\n40\tgood\n50\tmua\n');
  writeFileSync(join(dir, 'cluster_ContamPct.tsv'), 'cluster_id\tContamPct\n2\t1.5\n7\t20.0\n11\t85.4\n40\t0.0\n50\tnan\n');
  writeFileSync(join(dir, 'cluster_info.tsv'), 'cluster_id\tignored_field\n2\t1\n');

  if (datPath === 'raw.bin') {
    const bytes = Buffer.from(m.raw.buffer, m.raw.byteOffset, m.raw.byteLength);
    writeFileSync(join(dir, 'raw.bin'), v === 'badraw' ? bytes.subarray(0, bytes.length - 3) : bytes);
  }
  if (v === 'precomputed') {
    const sub = Array.from({ length: Math.ceil(n / 3) }, (_, i) => 3 * i);
    w('_phy_spikes_subset.spikes.npy', BigInt64Array.from(sub, BigInt), [sub.length]);
    w('_phy_spikes_subset.channels.npy', Int32Array.from({ length: sub.length * 4 }, (_, i) => m.pcInd[m.templates[sub[i >> 2]] * 4 + (i & 3)]), [sub.length, 4]);
    w('_phy_spikes_subset.waveforms.npy', Float32Array.from({ length: sub.length * 41 * 4 }, (_, i) => i % 997), [sub.length, 41, 4]);
  }
}

export function makeAllFixtures(): void {
  const m = buildModel();
  for (const v of VARIANTS) writeVariant(v, m);
}
```

`packages/extension/test/fixtures/cli.ts`:
```ts
import { makeAllFixtures, OUT } from './makeFixture';

makeAllFixtures();
console.log(`fixtures written to ${OUT}`);
```

`packages/extension/test/globalSetup.ts`:
```ts
import { makeAllFixtures } from './fixtures/makeFixture';

export default function setup(): void {
  makeAllFixtures();
}
```

Modify `packages/extension/vitest.config.ts` to:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], globalSetup: ['test/globalSetup.ts'], testTimeout: 30_000 },
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- fixture` then `npm run fixtures -w packages/extension`
Expected: PASS, and the CLI prints `fixtures written to …/packages/extension/test/fixtures/out`.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/test/fixtures/makeFixture.ts packages/extension/test/fixtures/cli.ts packages/extension/test/globalSetup.ts packages/extension/vitest.config.ts packages/extension/test/fixture.test.ts
git commit -m "test: deterministic synthetic phy fixture with variants"
```

---

### Task 5: Goldens from phylib/scipy via `uv`

**Files:**
- Create: `tools/goldens/pyproject.toml`, `tools/goldens/make_goldens.py` (and the generated `tools/goldens/uv.lock`)
- Create (generated, committed): `packages/extension/test/goldens/{filter,correlograms,templates,waveforms,features,histograms,table}.json`
- Create: `packages/extension/test/helpers.ts`

**Interfaces:**
- Consumes: fixture files (Task 4).
- Produces (JSON, all numbers, `NaN` → `null`):
  - `filter.json`: `{ fs, fc, b, a, x, y }` (scipy `butter(3, 150, 'highpass', fs)` and `filtfilt`)
  - `correlograms.json`: `{ clusters: [2,7,40], binSamples: 30, halfBins: 25, counts: [3][3][51] }` (`phylib.stats.ccg.correlograms`)
  - `templates.json`: `{ base: {<id>: {channels, mean[nS][nC], depth, ptp}}, sparse: {…} }`
  - `waveforms.json`: `{ cluster: {id: 7, channels, spikeIds[3], waveforms[3][82][nCh]}, edge: {channels, spikeIds[2], waveforms} }`
  - `features.json`: `{ cluster: 7, channels[4], spikeIds[5], features[5][4][3] }`
  - `histograms.json`: `{ cluster: 7, duration, isi[100], firingRate[100] }`
  - `table.json`: `{ <id>: { n_spikes, amplitude, firing_rate } }`
- Produces (`test/helpers.ts`):
  - `golden(name): any`
  - `flat(x): (number|null)[]`
  - `expectClose(actual, expected, tol = 1e-6)`, relative to `max(1, |expected|)`, where `null` means `NaN`
  - `live` (a non-cancelled token)

The constants below **define** the algorithms. Every later TS task must use the same values: `N_BEST = 12`, waveform `before 40 / after 42 / pad 200 / cap 100`, feature `cap 10000 / 4 channels / 3 PCs`, regular subset `spikes[floor(i·n/cap)]`, and best channels = 12 nearest to the peak-to-peak argmax (stable sort), restricted to its shank, then ordered by amplitude descending (stable).

- [ ] **Step 1: Create the uv project**

`tools/goldens/pyproject.toml`:
```toml
[project]
name = "theia-phy-goldens"
version = "0"
description = "Dev-only golden values for Theia-Phy tests (never needed to run tests)"
requires-python = ">=3.11"
dependencies = ["numpy>=2", "scipy>=1.13", "phylib>=2.6"]

[tool.uv]
package = false
```

- [ ] **Step 2: Write the golden script**

`tools/goldens/make_goldens.py`:
```python
"""Dev-only golden values for Theia-Phy unit tests.

Reads the TypeScript-generated fixture and writes JSON goldens that vitest compares
against. Python is never needed to run the tests; rerun only when the fixture or an
algorithm definition changes:

    npm run fixtures -w packages/extension
    uv run --project tools/goldens python tools/goldens/make_goldens.py
"""
import ast
import json
import math
from pathlib import Path

import numpy as np
from phylib.stats.ccg import correlograms
from scipy.signal import butter, filtfilt

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "packages/extension/test/fixtures/out"
OUT = ROOT / "packages/extension/test/goldens"

# Definitions shared with the TypeScript code (spec §3 and §5).
N_BEST = 12
WF_BEFORE, WF_AFTER, WF_PAD, WF_MAX = 40, 42, 200, 100
FEAT_MAX, FEAT_CH, FEAT_PCS = 10000, 4, 3
HIGHPASS_HZ = 150


def read_params(path):
    tree = ast.parse(path.read_text())
    return {n.targets[0].id: ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)}


def regular_subset(spikes, cap):
    n = len(spikes)
    return spikes if n <= cap else spikes[(np.arange(cap) * n) // cap]


def unwhitened(templates, cols, wmi, t, n_ch):
    tw = templates[t].astype(np.float64)
    if cols is None:
        return tw @ wmi
    c = cols[t]
    m = np.abs(tw).max(axis=0)
    keep = (c >= 0) & (m > m.max() * 1e-6)
    ch = c[keep]
    out = np.zeros((tw.shape[0], n_ch))
    out[:, ch] = tw[:, keep] @ wmi[np.ix_(ch, ch)]
    return out


def mean_template(templates, cols, wmi, spike_templates, spikes, n_ch):
    ts, counts = np.unique(spike_templates[spikes], return_counts=True)
    u = np.stack([unwhitened(templates, cols, wmi, t, n_ch) for t in ts])
    return np.average(u, axis=0, weights=counts)


def best_channels(mean, pos, shanks, n=N_BEST):
    amp = mean.max(axis=0) - mean.min(axis=0)
    best = int(np.argmax(amp))
    d = ((pos - pos[best]) ** 2).sum(axis=1)
    close = np.argsort(d, kind="stable")[:n]
    if shanks is not None:
        close = close[shanks[close] == shanks[best]]
    close = np.sort(close)
    return close[np.argsort(-amp[close], kind="stable")], amp


class Fixture:
    def __init__(self, d):
        self.d = Path(d)
        has = lambda f: (self.d / f).exists()
        load = lambda f: np.load(self.d / f)
        self.params = read_params(self.d / "params.py")
        self.sr = float(self.params["sample_rate"])
        self.st = load("spike_times.npy").ravel().astype(np.int64)
        stt = load("spike_templates.npy")
        self.stt = stt[:, 0] if stt.ndim == 2 else stt.ravel()
        self.sc = load("spike_clusters.npy").ravel() if has("spike_clusters.npy") else self.stt
        self.amps = load("amplitudes.npy").ravel() if has("amplitudes.npy") else None
        self.pos = load("channel_positions.npy").astype(np.float64)
        self.shanks = load("channel_shanks.npy").ravel() if has("channel_shanks.npy") else None
        self.cmap = load("channel_map.npy").ravel()
        self.templates = np.nan_to_num(load("templates.npy"))
        self.cols = load("template_ind.npy") if has("template_ind.npy") else None
        self.wmi = (load("whitening_mat_inv.npy") if has("whitening_mat_inv.npy") else np.linalg.inv(load("whitening_mat.npy"))).astype(np.float64)
        self.n_ch = len(self.cmap)
        self.duration = (self.st[-1] + 1) / self.sr

    def spikes(self, cid):
        return np.nonzero(self.sc == cid)[0]

    def channels(self, cid):
        mean = mean_template(self.templates, self.cols, self.wmi, self.stt, self.spikes(cid), self.n_ch)
        return best_channels(mean, self.pos, self.shanks)[0], mean


def filter_golden():
    fs = 30000.0
    b, a = butter(3, HIGHPASS_HZ, "highpass", fs=fs)
    rng = np.random.default_rng(0)
    x = 50 * np.sin(2 * np.pi * 3 * np.arange(300) / fs) + rng.normal(0, 5, 300)
    return {"fs": fs, "fc": HIGHPASS_HZ, "b": b, "a": a, "x": x, "y": filtfilt(b, a, x)}


def correlogram_golden(f):
    ids = np.array([2, 7, 40])
    mask = np.isin(f.sc, ids)
    counts = correlograms(f.st[mask].astype(np.float64), f.sc[mask], cluster_ids=ids,
                          sample_rate=1.0, bin_size=30.0, window_size=1500.0)
    return {"clusters": ids, "binSamples": 30, "halfBins": 25, "counts": counts}


def template_golden(f):
    out = {}
    for cid in np.unique(f.sc):
        ch, mean = f.channels(cid)
        amp = mean.max(axis=0) - mean.min(axis=0)
        out[str(cid)] = {"channels": ch, "mean": mean, "depth": f.pos[ch[0], 1], "ptp": amp[ch[0]]}
    return out


def raw_windows(raw, starts, length):
    out = np.zeros((len(starts), length, raw.shape[1]))
    for w, s in enumerate(starts):
        a, b = max(s, 0), min(s + length, raw.shape[0])
        if a < b:
            out[w, a - s : b - s] = raw[a:b]
    return out


def waveforms(f, raw, ids, chans):
    b, a = butter(3, HIGHPASS_HZ, "highpass", fs=f.sr)
    length = WF_BEFORE + WF_AFTER + 2 * WF_PAD
    win = raw_windows(raw, f.st[ids] - WF_BEFORE - WF_PAD, length)[:, :, f.cmap[chans]]
    y = filtfilt(b, a, win, axis=1)[:, WF_PAD : WF_PAD + WF_BEFORE + WF_AFTER]
    return y - np.median(y, axis=1, keepdims=True)


def waveform_golden(f):
    raw = np.fromfile(f.d / "raw.bin", dtype=np.int16).reshape(-1, f.params["n_channels_dat"])
    ch7, _ = f.channels(7)
    ids7 = regular_subset(f.spikes(7), WF_MAX)[:3]
    ch2, _ = f.channels(2)
    edge = np.array([np.nonzero(f.st == 5)[0][0], np.nonzero(f.st == raw.shape[0] - 3)[0][0]])
    return {
        "cluster": {"id": 7, "channels": ch7, "spikeIds": ids7, "waveforms": waveforms(f, raw, ids7, ch7)},
        "edge": {"channels": ch2, "spikeIds": edge, "waveforms": waveforms(f, raw, edge, ch2)},
    }


def feature_golden(f):
    pcf = np.load(f.d / "pc_features.npy")
    ind = np.load(f.d / "pc_feature_ind.npy")
    ch = f.channels(7)[0][:FEAT_CH]
    ids = regular_subset(f.spikes(7), FEAT_MAX)[:5]
    feats = np.full((len(ids), len(ch), FEAT_PCS), np.nan)
    for i, s in enumerate(ids):
        row = list(ind[f.stt[s]])
        for j, c in enumerate(ch):
            if c in row:
                feats[i, j] = pcf[s, :FEAT_PCS, row.index(c)]
    return {"cluster": 7, "channels": ch, "spikeIds": ids, "features": feats}


def histogram_golden(f):
    t = f.st[f.spikes(7)].astype(np.float64)
    isi = np.histogram(np.diff(t) / f.sr * 1000, bins=100, range=(0, 50))[0]
    fr = np.histogram(t / f.sr, bins=100, range=(0, f.duration))[0] / (f.duration / 100)
    return {"cluster": 7, "duration": f.duration, "isi": isi, "firingRate": fr}


def table_golden(f):
    out = {}
    for cid in np.unique(f.sc):
        s = f.spikes(cid)
        out[str(cid)] = {"n_spikes": len(s), "amplitude": f.amps[s].astype(np.float64).mean(),
                         "firing_rate": len(s) / f.duration}
    return out


def clean(x):
    if isinstance(x, np.ndarray):
        x = x.tolist()
    if isinstance(x, np.generic):
        x = x.item()
    if isinstance(x, float) and math.isnan(x):
        return None
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    return x


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base, sparse = Fixture(FIX / "base"), Fixture(FIX / "sparse")
    goldens = {
        "filter.json": filter_golden(),
        "correlograms.json": correlogram_golden(base),
        "templates.json": {"base": template_golden(base), "sparse": template_golden(sparse)},
        "waveforms.json": waveform_golden(base),
        "features.json": feature_golden(base),
        "histograms.json": histogram_golden(base),
        "table.json": table_golden(base),
    }
    for name, obj in goldens.items():
        (OUT / name).write_text(json.dumps(clean(obj), allow_nan=False))
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Generate the goldens**

Run:
```bash
npm run fixtures -w packages/extension
uv run --project tools/goldens python tools/goldens/make_goldens.py
```
Expected: `uv` creates `tools/goldens/.venv` and `tools/goldens/uv.lock`, then the script prints `wrote …/test/goldens/<name>.json` seven times.

Sanity check: `node -e "const g=require('./packages/extension/test/goldens/correlograms.json');console.log(g.counts.length,g.counts[0].length,g.counts[0][0].length)"`
Expected: `3 3 51`.

- [ ] **Step 4: Add test helpers**

`packages/extension/test/helpers.ts`:
```ts
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const golden = (name: string): any => JSON.parse(readFileSync(new URL(`./goldens/${name}`, import.meta.url), 'utf8'));

export const flat = (x: unknown): (number | null)[] => (Array.isArray(x) ? x.flatMap(flat) : [x as number | null]);

/** Element-wise closeness, relative to max(1, |expected|); `null` in expected means NaN. */
export function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number | null>, tol = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e === null) {
      expect(Number.isNaN(a), `index ${i}: expected NaN, got ${a}`).toBe(true);
      continue;
    }
    expect(Math.abs(a - e), `index ${i}: ${a} vs ${e}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(e)));
  }
}

export const live = { isCancellationRequested: false } as const;
```

- [ ] **Step 5: Commit**

```bash
git add tools/goldens/pyproject.toml tools/goldens/uv.lock tools/goldens/make_goldens.py packages/extension/test/goldens packages/extension/test/helpers.ts
git commit -m "test: phylib/scipy goldens generated with uv"
```

---

### Task 6: Positioned range reads, `NpyFile` row reader, Fortran→C cache

**Files:**
- Modify: `packages/extension/src/host/dataset/files.ts` (add `Range`, `readRanges`)
- Modify: `packages/extension/src/host/dataset/npy.ts` (add `NpyFile`)
- Create: `packages/extension/src/host/dataset/fortranCache.ts`
- Test: `packages/extension/test/files.test.ts`

**Interfaces:**
- Consumes: `readFully`, `readNpyHeader`, `ctorOf`, `itemSize`, `fortranToC`, `npyHeaderBytes` (Task 1).
- Produces:
  - `interface Range { offset: number; length: number }`
  - `readRanges(fh, ranges, maxGap = 4096): Promise<Uint8Array[]>`. Results come back in input order. Ranges are sorted by offset, and neighbours within `maxGap` are merged into one read of at most 16 MiB.
  - `class NpyFile { static open(path); header: NpyHeader; path; rowLength; readRows(rows: ArrayLike<number>): Promise<NumArray>; close() }`. Rows come back in request order. Fortran files throw, and out-of-range rows throw with the file name.
  - `cOrderCopy(path, cacheDir, onProgress?: (fraction) => void, blockBytes = 32 MiB): Promise<string>`. The cache key is `sha1(absolute path | size | mtimeMs)`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/files.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- files`
Expected: FAIL, because `readRanges` and `NpyFile` are not exported and `fortranCache` is missing.

- [ ] **Step 3: Implement**

Append to `packages/extension/src/host/dataset/files.ts`:
```ts
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
```

Append to `packages/extension/src/host/dataset/npy.ts` (and change the `files` import to `import { readFully, readRanges } from './files';`):
```ts
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
```

`packages/extension/src/host/dataset/fortranCache.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- files npy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/dataset/files.ts packages/extension/src/host/dataset/npy.ts packages/extension/src/host/dataset/fortranCache.ts packages/extension/test/files.test.ts
git commit -m "feat: coalesced positioned reads, NpyFile rows, Fortran C-order cache"
```

---

### Task 7: Raw data reader

**Files:**
- Create: `packages/extension/src/host/dataset/raw.ts`
- Test: `packages/extension/test/raw.test.ts`

**Interfaces:**
- Consumes: `Params` (Task 2), `readRanges`, `ctorOf`, `itemSize`.
- Produces:
  - `type RawStatus = { ok: true; raw: RawData } | { ok: false; reason: string }`
  - `class RawData`:
    - `static open(params, dir): Promise<RawStatus>`. It never throws for missing or bad files.
    - `nSamples`, `nChannels` (= `n_channels_dat`), `dtype`
    - `readWindows(starts: ArrayLike<number>, length): Promise<Float32Array>`. The result is `(nWindows × length × nChannels)`, time-major, in raw units, zero outside the recording. Windows may span file boundaries.
    - `close()`
  - Reason strings:
    - `no dat_path in params.py`
    - `n_channels_dat missing in params.py`
    - `unsupported raw dtype <d>`
    - `raw data not found: <abs path>`
    - `raw data size of <path> (<n> bytes) is inconsistent with n_channels_dat=<n>, dtype=<d>, offset=<o>`

- [ ] **Step 1: Write the failing test**

`packages/extension/test/raw.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- raw`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/host/dataset/raw.ts`:
```ts
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
      const bufs = await readRanges(this.files[f].fh, mine.map((j) => j.range));
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- raw`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/dataset/raw.ts packages/extension/test/raw.test.ts
git commit -m "feat: raw .bin window reader with fallback reasons"
```

---

### Task 8: `openDataset` (required/optional files, conversions, shape checks)

**Files:**
- Create: `packages/extension/src/compute/linalg.ts`
- Create: `packages/extension/src/host/dataset/dataset.ts`
- Test: `packages/extension/test/dataset.test.ts`, `packages/extension/test/linalg.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, 6, 7.
- Produces:
  - `invert(m: Float64Array, n: number): Float64Array` (Gauss–Jordan; throws `matrix is singular`)
  - `class DatasetError extends Error`
  - `class NeedsFileError extends Error { readonly file: string }`, with message `needs <file>`
  - `interface Templates { data: Float32Array; nTemplates; nSamples; nCols; cols?: Int32Array }`. `cols` is present only for sparse `template_ind.npy`, with shape `nTemplates × nCols` and `-1` meaning unused.
  - `interface Features { file: NpyFile; ind: Int32Array; nPcs; nLoc; spikeIds?: Int32Array }`
  - `interface SpikeSubset { spikes: Int32Array; channels: Int32Array; waveforms: NpyFile; nSamples; nChannels }`
  - `interface Dataset extends DatasetReader { paramsPath; params; templates?; wmi: Float64Array; features?; spikeSubset?; raw: RawStatus; metadata: Map<string, Map<number, Cell>>; close() }`
  - `interface OpenOptions { cacheDir?: string; onProgress?: (message: string, fraction?: number) => void }`
  - `openDataset(paramsPath, opts?): Promise<Dataset>`
- Error strings (tested):
  - `missing required file <name>`
  - `<name> has shape (<shape>) but spike_times.npy has <n> spikes`
  - `channel_map.npy refers to channel <c> but n_channels_dat is <n>`. This one becomes the raw-status reason, not a thrown error.

- [ ] **Step 1: Write the failing tests**

`packages/extension/test/linalg.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { invert } from '../src/compute/linalg';
import { expectClose } from './helpers';

describe('invert', () => {
  it('inverts a non-symmetric matrix that needs pivoting', () => {
    const m = Float64Array.from([0, 2, 1, 1, 1, 0, 3, 0, 1]);
    const inv = invert(m, 3);
    const prod = Array.from({ length: 9 }, (_, k) => [0, 1, 2].reduce((s, j) => s + m[Math.floor(k / 3) * 3 + j] * inv[j * 3 + (k % 3)], 0));
    expectClose(prod, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-12);
  });
  it('rejects singular matrices', () => {
    expect(() => invert(Float64Array.from([1, 2, 2, 4]), 2)).toThrow(/singular/);
  });
});
```

`packages/extension/test/dataset.test.ts`:
```ts
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDataset } from '../src/host/dataset/dataset';
import { readNpy } from '../src/host/dataset/npy';
import { CHANNEL_MAP, fixtureDir, fixtureParams, NS_TEMPLATE, SR, type Variant } from './fixtures/makeFixture';
import { writeNpy } from './fixtures/npyWrite';
import { expectClose } from './helpers';

const open = (v: Variant) => openDataset(fixtureParams(v), { cacheDir: mkdtempSync(join(tmpdir(), 'cache-')) });
const copy = (v: Variant) => {
  const d = mkdtempSync(join(tmpdir(), `ds-${v}-`));
  cpSync(fixtureDir(v), d, { recursive: true });
  return d;
};

describe('openDataset', () => {
  it('loads the base fixture', async () => {
    const ds = await open('base');
    const times = (await readNpy(join(fixtureDir('base'), 'spike_times.npy'))).data;
    expect(ds.nSpikes).toBe(times.length);
    expect(ds.spikeTimes.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(ds.spikeClusters.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(ds.nChannels).toBe(CHANNEL_MAP.length);
    expect(ds.sampleRate).toBe(SR);
    expect(ds.templates?.cols).toBeUndefined(); // KS templates_ind.npy is ignored
    expect(ds.features).toMatchObject({ nPcs: 3, nLoc: 4 });
    expect(ds.raw.ok).toBe(true);
    expect([...ds.metadata.keys()]).toEqual(['ContamPct', 'KSLabel', 'group']);
    expect(ds.duration).toBeCloseTo((ds.spikeTimes[ds.nSpikes - 1] + 1) / SR, 12);
    await ds.close();
  });

  it('reads Fortran-order and (n, 1) files identically to C order', async () => {
    const [a, b] = await Promise.all([open('base'), open('fortran')]);
    expect(b.spikeTimes).toEqual(a.spikeTimes);
    expect(b.amplitudes).toEqual(a.amplitudes);
    expect(b.templates!.data).toEqual(a.templates!.data);
    expectClose(b.wmi, Array.from(a.wmi), 0);
    expect(await b.features!.file.readRows([0, 5, 1])).toEqual(await a.features!.file.readRows([0, 5, 1]));
  });

  it('keeps sparse template_ind.npy columns', async () => {
    const ds = await open('sparse');
    expect(ds.templates!.nCols).toBe(3);
    expect(Array.from(ds.templates!.cols!.subarray(3, 6))).toEqual([2, 1, -1]);
  });

  it('restricts features to pc_feature_spike_ids and reads int64 spike times', async () => {
    const [a, b] = await Promise.all([open('base'), open('subset')]);
    expect(b.features!.spikeIds!.length).toBe(Math.ceil(b.nSpikes / 2));
    expect(b.spikeTimes).toEqual(a.spikeTimes);
  });

  it('uses column 0 of a 2-D spike_templates and falls back to it for clusters', async () => {
    const [a, b] = await Promise.all([open('base'), open('templates2d')]);
    expect(b.spikeTemplates).toEqual(a.spikeTemplates);
    expect(b.spikeClusters).toEqual(a.spikeTemplates);
  });

  it('opens without raw data or whitening_mat_inv.npy', async () => {
    const [a, b] = await Promise.all([open('base'), open('noraw')]);
    expect(b.raw.ok).toBe(false);
    if (!b.raw.ok) expect(b.raw.reason).toMatch(/^raw data not found: .*missing\.bin$/);
    expectClose(b.wmi, Array.from(a.wmi), 1e-6);
  });

  it('opens a dataset with only the required files', async () => {
    const ds = await open('minimal');
    expect(ds.templates).toBeUndefined();
    expect(ds.amplitudes).toBeUndefined();
    expect(ds.features).toBeUndefined();
    expect(Array.from(ds.wmi.subarray(0, 7))).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(ds.raw).toEqual({ ok: false, reason: 'no dat_path in params.py' });
  });

  it('names a missing required file', async () => {
    const d = copy('base');
    rmSync(join(d, 'channel_map.npy'));
    await expect(openDataset(join(d, 'params.py'))).rejects.toThrow(/missing required file channel_map\.npy/);
  });

  it('names both files when spike counts disagree', async () => {
    const d = copy('base');
    const n = (await readNpy(join(d, 'spike_times.npy'))).data.length;
    writeNpy(join(d, 'amplitudes.npy'), new Float32Array(n - 1), [n - 1]);
    await expect(openDataset(join(d, 'params.py'))).rejects.toThrow(`amplitudes.npy has shape (${n - 1}) but spike_times.npy has ${n} spikes`);
  });

  it('names the offending params.py line', async () => {
    const d = copy('base');
    writeFileSync(join(d, 'params.py'), "dat_path = 'raw.bin'\nn_channels_dat = 8\ndtype = np.int16\nsample_rate = 30000.\n");
    await expect(openDataset(join(d, 'params.py'))).rejects.toThrow(/params\.py:3: unsupported syntax/);
  });

  it('zeroes all-NaN templates (phy behaviour)', async () => {
    const d = copy('base');
    const t = await readNpy(join(d, 'templates.npy'));
    const data = Float32Array.from(t.data as Float32Array);
    data.fill(NaN, 0, NS_TEMPLATE * CHANNEL_MAP.length);
    writeNpy(join(d, 'templates.npy'), data, t.shape);
    const ds = await openDataset(join(d, 'params.py'));
    expect(ds.templates!.data.subarray(0, NS_TEMPLATE * CHANNEL_MAP.length).every((x) => x === 0)).toBe(true);
  });

  it('reports raw data whose channel_map exceeds n_channels_dat', async () => {
    const d = copy('base');
    writeFileSync(join(d, 'params.py'), "dat_path = 'raw.bin'\nn_channels_dat = 4\ndtype = 'int16'\nsample_rate = 30000.\n");
    const ds = await openDataset(join(d, 'params.py'));
    expect(ds.raw).toEqual({ ok: false, reason: 'channel_map.npy refers to channel 5 but n_channels_dat is 4' });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -w packages/extension -- dataset linalg`
Expected: FAIL, because the modules were not found.

- [ ] **Step 3: Implement**

`packages/extension/src/compute/linalg.ts`:
```ts
/** Inverse of a row-major n×n matrix (Gauss–Jordan with partial pivoting). */
export function invert(m: Float64Array, n: number): Float64Array {
  const a = Float64Array.from(m);
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) inv[i * n + i] = 1;
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r * n + col]) > Math.abs(a[p * n + col])) p = r;
    if (Math.abs(a[p * n + col]) < 1e-12) throw new Error('matrix is singular');
    if (p !== col) {
      for (let k = 0; k < n; k++) {
        [a[p * n + k], a[col * n + k]] = [a[col * n + k], a[p * n + k]];
        [inv[p * n + k], inv[col * n + k]] = [inv[col * n + k], inv[p * n + k]];
      }
    }
    const d = a[col * n + col];
    for (let k = 0; k < n; k++) {
      a[col * n + k] /= d;
      inv[col * n + k] /= d;
    }
    for (let r = 0; r < n; r++) {
      const f = a[r * n + col];
      if (r === col || f === 0) continue;
      for (let k = 0; k < n; k++) {
        a[r * n + k] -= f * a[col * n + k];
        inv[r * n + k] -= f * inv[col * n + k];
      }
    }
  }
  return inv;
}
```

`packages/extension/src/host/dataset/dataset.ts`:
```ts
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Cell, DatasetReader } from '@theia-phy/api';
import { invert } from '../../compute/linalg';
import { cOrderCopy } from './fortranCache';
import { convert, NpyFile, readNpy, type NpyArray } from './npy';
import { readParams, type Params } from './params';
import { RawData, type RawStatus } from './raw';
import { readClusterMetadata } from './tsv';

export class DatasetError extends Error {}
export class NeedsFileError extends Error {
  constructor(readonly file: string) {
    super(`needs ${file}`);
  }
}

export interface Templates {
  data: Float32Array; // nTemplates × nSamples × nCols, whitened
  nTemplates: number;
  nSamples: number;
  nCols: number;
  cols?: Int32Array; // sparse only: nTemplates × nCols channel ids, -1 = unused
}
export interface Features {
  file: NpyFile; // (nRows, nPcs, nLoc), C order
  ind: Int32Array; // nTemplates × nLoc channel ids
  nPcs: number;
  nLoc: number;
  spikeIds?: Int32Array; // sorted; row r holds spike spikeIds[r]
}
export interface SpikeSubset {
  spikes: Int32Array; // sorted
  channels: Int32Array; // nSubset × nChannels
  waveforms: NpyFile; // (nSubset, nSamples, nChannels)
  nSamples: number;
  nChannels: number;
}
export interface Dataset extends DatasetReader {
  readonly paramsPath: string;
  readonly params: Params;
  readonly templates?: Templates;
  readonly wmi: Float64Array; // nChannels × nChannels
  readonly features?: Features;
  readonly spikeSubset?: SpikeSubset;
  readonly raw: RawStatus;
  readonly metadata: Map<string, Map<number, Cell>>;
  close(): Promise<void>;
}
export interface OpenOptions {
  cacheDir?: string;
  onProgress?: (message: string, fraction?: number) => void;
}

type Ctor<T> = { new (buffer: ArrayBufferLike): T; BYTES_PER_ELEMENT: number };

function perSpike<T extends Int32Array | Float32Array | Float64Array>(a: NpyArray, name: string, C: Ctor<T>, n?: number): T {
  const [len, cols = 1, ...more] = a.shape;
  if (len === undefined || more.length > 0 || (cols !== 1 && !(cols === 2 && name === 'spike_templates.npy'))) {
    throw new DatasetError(`${name} has unsupported shape (${a.shape.join(', ')})`);
  }
  if (n !== undefined && len !== n) throw new DatasetError(`${name} has shape (${a.shape.join(', ')}) but spike_times.npy has ${n} spikes`);
  return convert(a.data, C, { shared: true, stride: cols });
}

const isSorted = (a: ArrayLike<number>) => {
  for (let i = 1; i < a.length; i++) if (a[i] < a[i - 1]) return false;
  return true;
};

export async function openDataset(paramsPath: string, opts: OpenOptions = {}): Promise<Dataset> {
  const abs = resolve(paramsPath);
  const dir = dirname(abs);
  const params = await readParams(abs);
  const cacheDir = opts.cacheDir ?? join(tmpdir(), 'theia-phy-cache');
  const file = (name: string) => join(dir, name);
  const has = (name: string) => existsSync(file(name));
  const need = async (name: string, shared = false) => {
    if (!has(name)) throw new DatasetError(`missing required file ${name}`);
    return readNpy(file(name), { shared });
  };
  const maybe = async (name: string, shared = false) => (has(name) ? readNpy(file(name), { shared }) : undefined);
  const openRows = async (name: string) => {
    const f = await NpyFile.open(file(name));
    if (!f.header.fortranOrder) return f;
    await f.close();
    return NpyFile.open(await cOrderCopy(file(name), cacheDir, (fr) => opts.onProgress?.(`Converting ${name} to C order`, fr)));
  };

  opts.onProgress?.('Loading spikes');
  const spikeTimes = perSpike(await need('spike_times.npy', true), 'spike_times.npy', Float64Array);
  const nSpikes = spikeTimes.length;
  if (!isSorted(spikeTimes)) throw new DatasetError('spike_times.npy is not sorted');
  const tpl = await maybe('spike_templates.npy', true);
  const clu = await maybe('spike_clusters.npy', true);
  if (!tpl && !clu) throw new DatasetError('missing required file spike_clusters.npy or spike_templates.npy');
  const spikeTemplates = tpl && perSpike(tpl, 'spike_templates.npy', Int32Array, nSpikes);
  const spikeClusters = clu ? perSpike(clu, 'spike_clusters.npy', Int32Array, nSpikes) : spikeTemplates!;
  const amp = await maybe('amplitudes.npy', true);
  const amplitudes = amp && perSpike(amp, 'amplitudes.npy', Float32Array, nSpikes);

  const channelMap = convert((await need('channel_map.npy')).data, Int32Array);
  const nChannels = channelMap.length;
  const pos = await need('channel_positions.npy');
  if (pos.shape[0] !== nChannels || pos.shape[1] !== 2) {
    throw new DatasetError(`channel_positions.npy has shape (${pos.shape.join(', ')}) but channel_map.npy has ${nChannels} channels`);
  }
  const channelPositions = convert(pos.data, Float32Array);
  const sh = await maybe('channel_shanks.npy');
  const channelShanks = sh && convert(sh.data, Int32Array);
  if (channelShanks && channelShanks.length !== nChannels) {
    throw new DatasetError(`channel_shanks.npy has ${channelShanks.length} channels but channel_map.npy has ${nChannels}`);
  }

  opts.onProgress?.('Loading templates');
  let templates: Templates | undefined;
  const tArr = await maybe('templates.npy');
  if (tArr) {
    if (tArr.shape.length !== 3) throw new DatasetError(`templates.npy has unsupported shape (${tArr.shape.join(', ')})`);
    const [nTemplates, nSamples, nCols] = tArr.shape;
    const ind = await maybe('template_ind.npy'); // phy name; KS's templates_ind.npy is deliberately ignored
    const cols = ind && convert(ind.data, Int32Array);
    if (cols && cols.length !== nTemplates * nCols) {
      throw new DatasetError(`template_ind.npy has shape (${ind!.shape.join(', ')}) but templates.npy has (${tArr.shape.join(', ')})`);
    }
    if (!cols && nCols !== nChannels) throw new DatasetError(`templates.npy has ${nCols} channels but channel_map.npy has ${nChannels}`);
    const data = convert(tArr.data, Float32Array);
    for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i])) data[i] = 0; // phy zeroes empty (NaN) templates
    templates = { data, nTemplates, nSamples, nCols, cols };
  }

  const square = (a: NpyArray, name: string) => {
    if (a.shape[0] !== nChannels || a.shape[1] !== nChannels) {
      throw new DatasetError(`${name} has shape (${a.shape.join(', ')}) but channel_map.npy has ${nChannels} channels`);
    }
    return convert(a.data, Float64Array);
  };
  const wmiArr = await maybe('whitening_mat_inv.npy');
  const wmArr = wmiArr ? undefined : await maybe('whitening_mat.npy');
  let wmi: Float64Array;
  if (wmiArr) wmi = square(wmiArr, 'whitening_mat_inv.npy');
  else if (wmArr) {
    try {
      wmi = invert(square(wmArr, 'whitening_mat.npy'), nChannels);
    } catch {
      throw new DatasetError('whitening_mat.npy is singular');
    }
  } else {
    wmi = new Float64Array(nChannels * nChannels);
    for (let i = 0; i < nChannels; i++) wmi[i * nChannels + i] = 1;
  }

  let features: Features | undefined;
  if (has('pc_features.npy') && has('pc_feature_ind.npy')) {
    const f = await openRows('pc_features.npy');
    const shp = f.header.shape;
    const ids = await maybe('pc_feature_spike_ids.npy');
    const spikeIds = ids && convert(ids.data, Int32Array);
    if (spikeIds && !isSorted(spikeIds)) throw new DatasetError('pc_feature_spike_ids.npy is not sorted');
    const nRows = spikeIds?.length ?? nSpikes;
    if (shp.length !== 3 || shp[0] !== nRows) {
      throw new DatasetError(`pc_features.npy has shape (${shp.join(', ')}) but ${spikeIds ? 'pc_feature_spike_ids.npy' : 'spike_times.npy'} has ${nRows} spikes`);
    }
    const ind = convert((await need('pc_feature_ind.npy')).data, Int32Array);
    features = { file: f, ind, nPcs: shp[1], nLoc: shp[2], spikeIds };
  }

  let spikeSubset: SpikeSubset | undefined;
  const sub = '_phy_spikes_subset';
  if (has(`${sub}.waveforms.npy`) && has(`${sub}.channels.npy`) && has(`${sub}.spikes.npy`)) {
    const waveforms = await openRows(`${sub}.waveforms.npy`);
    const [, nSamples, nCh] = waveforms.header.shape;
    const spikes = convert((await need(`${sub}.spikes.npy`)).data, Int32Array);
    if (!isSorted(spikes)) throw new DatasetError(`${sub}.spikes.npy is not sorted`);
    spikeSubset = { spikes, channels: convert((await need(`${sub}.channels.npy`)).data, Int32Array), waveforms, nSamples, nChannels: nCh };
  }

  let raw = await RawData.open(params, dir);
  if (raw.ok) {
    const nDat = raw.raw.nChannels;
    const bad = channelMap.find((c) => c >= nDat);
    if (bad !== undefined) {
      await raw.raw.close();
      raw = { ok: false, reason: `channel_map.npy refers to channel ${bad} but n_channels_dat is ${params.nChannelsDat}` };
    }
  }
  const metadata = await readClusterMetadata(dir);

  return {
    dir,
    paramsPath: abs,
    params,
    sampleRate: params.sampleRate,
    nSpikes,
    nChannels,
    duration: nSpikes ? (spikeTimes[nSpikes - 1] + 1) / params.sampleRate : 0,
    spikeTimes,
    spikeClusters,
    spikeTemplates,
    amplitudes,
    channelMap,
    channelPositions,
    channelShanks,
    templates,
    wmi,
    features,
    spikeSubset,
    raw,
    metadata,
    async close() {
      await features?.file.close();
      await spikeSubset?.waveforms.close();
      if (raw.ok) await raw.raw.close();
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- dataset linalg` then `npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/compute/linalg.ts packages/extension/src/host/dataset/dataset.ts packages/extension/test/dataset.test.ts packages/extension/test/linalg.test.ts
git commit -m "feat: openDataset with required/optional files and shape checks"
```

---

### Task 9: Cluster index and spike subsampling (`compute/spikes.ts`)

**Files:**
- Create: `packages/extension/src/compute/spikes.ts`
- Test: `packages/extension/test/spikes.test.ts`

**Interfaces:**
- Produces:
  - `interface ClusterIndex { ids: Int32Array /* sorted unique */; starts: Int32Array /* ids.length + 1 */; order: Int32Array /* spike indices grouped by cluster, ascending within each */ }`
  - `buildClusterIndex(clusters: Int32Array): ClusterIndex`
  - `spikesOf(index, id): Int32Array` (a subarray; empty for unknown ids)
  - `bsearch(sorted, x): number` (index or −1)
  - `regularSubset(spikes, max): Int32Array`. Returns `spikes` itself if `length ≤ max`, otherwise `spikes[floor(i·n/max)]`.
  - `regularRange(n, max): Int32Array` (`floor(i·n/m)`, `m = min(n, max)`)
  - `intersectSorted(a, b): Int32Array`

- [ ] **Step 1: Write the failing test**

`packages/extension/test/spikes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { bsearch, buildClusterIndex, intersectSorted, regularRange, regularSubset, spikesOf } from '../src/compute/spikes';
import { rng } from './fixtures/makeFixture';

describe('cluster index', () => {
  it('groups spikes by sparse, large cluster ids in ascending spike order', () => {
    const r = rng(3);
    const pool = [5, 1_000_000_000, 7, 42];
    const clusters = Int32Array.from({ length: 1000 }, () => pool[Math.floor(r() * pool.length)]);
    const idx = buildClusterIndex(clusters);
    expect(Array.from(idx.ids)).toEqual([5, 7, 42, 1_000_000_000]);
    let total = 0;
    for (const id of pool) {
      const s = Array.from(spikesOf(idx, id));
      total += s.length;
      expect(s).toEqual(Array.from(clusters.keys()).filter((i) => clusters[i] === id));
    }
    expect(total).toBe(1000);
    expect(spikesOf(idx, 6)).toHaveLength(0);
  });
});

describe('subsets', () => {
  it('uses a deterministic regular stride', () => {
    const s = Int32Array.from({ length: 10 }, (_, i) => 100 + i);
    expect(Array.from(regularSubset(s, 3))).toEqual([100, 103, 106]);
    expect(regularSubset(s, 10)).toBe(s);
    expect(Array.from(regularRange(10, 4))).toEqual([0, 2, 5, 7]);
    expect(Array.from(regularRange(3, 10))).toEqual([0, 1, 2]);
  });
  it('searches and intersects sorted arrays', () => {
    const a = Int32Array.from([1, 3, 5, 7]);
    expect(bsearch(a, 5)).toBe(2);
    expect(bsearch(a, 4)).toBe(-1);
    expect(Array.from(intersectSorted(a, Int32Array.from([0, 3, 4, 7, 9])))).toEqual([3, 7]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- spikes`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/compute/spikes.ts`:
```ts
export interface ClusterIndex {
  ids: Int32Array;
  starts: Int32Array;
  order: Int32Array;
}

export function bsearch(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid];
    if (v === x) return mid;
    if (v < x) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Counting sort of spikes by cluster; ids may be sparse and large. */
export function buildClusterIndex(clusters: Int32Array): ClusterIndex {
  const sorted = clusters.slice().sort();
  let nIds = 0;
  for (let i = 0; i < sorted.length; i++) if (nIds === 0 || sorted[i] !== sorted[nIds - 1]) sorted[nIds++] = sorted[i];
  const ids = sorted.slice(0, nIds);
  const starts = new Int32Array(nIds + 1);
  const slot = new Int32Array(clusters.length);
  for (let i = 0; i < clusters.length; i++) {
    const k = bsearch(ids, clusters[i]);
    slot[i] = k;
    starts[k + 1]++;
  }
  for (let k = 0; k < nIds; k++) starts[k + 1] += starts[k];
  const fill = starts.slice(0, nIds);
  const order = new Int32Array(clusters.length);
  for (let i = 0; i < clusters.length; i++) order[fill[slot[i]]++] = i;
  return { ids, starts, order };
}

export function spikesOf(index: ClusterIndex, id: number): Int32Array {
  const k = bsearch(index.ids, id);
  return k < 0 ? new Int32Array(0) : index.order.subarray(index.starts[k], index.starts[k + 1]);
}

/** At most `max` spikes at a regular stride (stable across re-selection). */
export function regularSubset(spikes: Int32Array, max: number): Int32Array {
  const n = spikes.length;
  if (n <= max) return spikes;
  const out = new Int32Array(max);
  for (let i = 0; i < max; i++) out[i] = spikes[Math.floor((i * n) / max)];
  return out;
}

export function regularRange(n: number, max: number): Int32Array {
  const m = Math.min(n, max);
  const out = new Int32Array(m);
  for (let i = 0; i < m; i++) out[i] = Math.floor((i * n) / m);
  return out;
}

export function intersectSorted(a: Int32Array, b: Int32Array): Int32Array {
  const out: number[] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return Int32Array.from(out);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- spikes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/compute/spikes.ts packages/extension/test/spikes.test.ts
git commit -m "feat: cluster→spike index and regular spike subsets"
```

---

### Task 10: Butterworth high-pass, scipy-compatible `filtfilt`, window processing

**Files:**
- Create: `packages/extension/src/compute/filter.ts`
- Test: `packages/extension/test/filter.test.ts`

**Interfaces:**
- Consumes: `invert` (Task 8).
- Produces:
  - `HIGHPASS_HZ = 150`
  - `butterHighpass3(fc, fs): { b: Float64Array; a: Float64Array }`
  - `filtfilt(b, a, x: Float64Array): Float64Array`. Matches scipy defaults: odd padding with `padlen = 3·max(len a, len b)` and `lfilter_zi` initial state. Throws `filtfilt needs more than <padlen> samples, got <n>`.
  - `interface WindowSpec { nWindows; length /* padded */; nChannels; pad; sampleRate; highpass: boolean }`
  - `processWindows(windows: Float32Array, spec): Float32Array`. Input is `(nWindows × length × nChannels)`. Output is `(nWindows × (length − 2·pad) × nChannels)`: filtered when `highpass`, cropped, with the per-channel median subtracted.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/filter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { butterHighpass3, filtfilt, processWindows } from '../src/compute/filter';
import { expectClose, golden } from './helpers';

const g = golden('filter.json');

describe('filter', () => {
  it('designs the same 3rd-order Butterworth high-pass as scipy', () => {
    const { b, a } = butterHighpass3(g.fc, g.fs);
    expectClose(b, g.b, 1e-10);
    expectClose(a, g.a, 1e-10);
  });

  it('matches scipy.signal.filtfilt', () => {
    const { b, a } = butterHighpass3(g.fc, g.fs);
    expectClose(filtfilt(b, a, Float64Array.from(g.x)), g.y, 1e-8);
  });

  it('rejects inputs no longer than the padding', () => {
    const { b, a } = butterHighpass3(150, 30000);
    expect(() => filtfilt(b, a, new Float64Array(12))).toThrow(/more than 12 samples, got 12/);
  });

  it('only removes the per-channel median when the data is already high-passed', () => {
    // 1 window, 5 samples (pad 1 → 3 kept), 2 channels, time-major interleaved.
    const w = Float32Array.from([9, 0, 1, 10, 5, 20, 3, 40, 9, 0]);
    const out = processWindows(w, { nWindows: 1, length: 5, nChannels: 2, pad: 1, sampleRate: 30000, highpass: false });
    expect(Array.from(out)).toEqual([-2, -10, 2, 0, 0, 20]);
  });

  it('high-passes away slow drift', () => {
    const L = 482;
    const w = Float32Array.from({ length: L }, (_, t) => 1000 + 500 * Math.sin((2 * Math.PI * 2 * t) / 30000));
    const out = processWindows(w, { nWindows: 1, length: L, nChannels: 1, pad: 200, sampleRate: 30000, highpass: true });
    expect(out).toHaveLength(82);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- filter`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/compute/filter.ts`:
```ts
import { invert } from './linalg';

export const HIGHPASS_HZ = 150;

const conv = (p: number[], q: number[]) => {
  const r = new Float64Array(p.length + q.length - 1);
  p.forEach((x, i) => q.forEach((y, j) => (r[i + j] += x * y)));
  return r;
};

/**
 * scipy.signal.butter(3, fc, 'highpass', fs=fs): the analog prototype 1/((s+1)(s²+s+1)) with
 * s = Ω(1+z⁻¹)/(1−z⁻¹), Ω = tan(π·fc/fs) (high-pass transform + pre-warped bilinear).
 */
export function butterHighpass3(fc: number, fs: number): { b: Float64Array; a: Float64Array } {
  const W = Math.tan((Math.PI * fc) / fs);
  const d1 = 1 + W;
  const d2 = W * W + W + 1;
  return {
    b: conv([1 / d1, -1 / d1], [1 / d2, -2 / d2, 1 / d2]),
    a: conv([1, (W - 1) / d1], [1, (2 * W * W - 2) / d2, (W * W - W + 1) / d2]),
  };
}

/** scipy.signal.lfilter_zi for a[0] = 1 and len(b) = len(a). */
function lfilterZi(b: Float64Array, a: Float64Array): Float64Array {
  const m = a.length - 1;
  const M = new Float64Array(m * m); // I − companion(a)ᵀ
  for (let i = 0; i < m; i++) {
    M[i * m + i] = 1;
    M[i * m] += a[i + 1];
    if (i + 1 < m) M[i * m + i + 1] = -1;
  }
  const B = Array.from({ length: m }, (_, i) => b[i + 1] - a[i + 1] * b[0]);
  const Minv = invert(M, m);
  return Float64Array.from({ length: m }, (_, i) => B.reduce((s, x, j) => s + Minv[i * m + j] * x, 0));
}

/** In-place transposed direct form II, state `z` (scipy's convention). */
function lfilter(b: Float64Array, a: Float64Array, x: Float64Array, z: Float64Array): void {
  const m = z.length;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const y = b[0] * xn + z[0];
    for (let j = 0; j < m - 1; j++) z[j] = b[j + 1] * xn + z[j + 1] - a[j + 1] * y;
    z[m - 1] = b[m] * xn - a[m] * y;
    x[n] = y;
  }
}

/** scipy.signal.filtfilt with default arguments (padtype='odd'). */
export function filtfilt(b: Float64Array, a: Float64Array, x: Float64Array): Float64Array {
  const n = x.length;
  const padlen = 3 * Math.max(a.length, b.length);
  if (n <= padlen) throw new Error(`filtfilt needs more than ${padlen} samples, got ${n}`);
  const ext = new Float64Array(n + 2 * padlen);
  for (let i = 0; i < padlen; i++) {
    ext[i] = 2 * x[0] - x[padlen - i];
    ext[n + padlen + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  ext.set(x, padlen);
  const zi = lfilterZi(b, a);
  lfilter(b, a, ext, zi.map((v) => v * ext[0]));
  ext.reverse();
  lfilter(b, a, ext, zi.map((v) => v * ext[0]));
  ext.reverse();
  return ext.slice(padlen, padlen + n);
}

export interface WindowSpec {
  nWindows: number;
  length: number;
  nChannels: number;
  pad: number;
  sampleRate: number;
  highpass: boolean;
}

function median(x: Float64Array): number {
  const s = x.slice().sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Filter (optional), crop `pad` samples on each side, subtract each channel's median. */
export function processWindows(windows: Float32Array, spec: WindowSpec): Float32Array {
  const { nWindows, length, nChannels: nc, pad } = spec;
  const outLen = length - 2 * pad;
  const out = new Float32Array(nWindows * outLen * nc);
  const { b, a } = butterHighpass3(HIGHPASS_HZ, spec.sampleRate);
  const col = new Float64Array(length);
  for (let w = 0; w < nWindows; w++) {
    for (let c = 0; c < nc; c++) {
      for (let t = 0; t < length; t++) col[t] = windows[(w * length + t) * nc + c];
      const y = spec.highpass ? filtfilt(b, a, col) : col;
      const crop = y.slice(pad, pad + outLen);
      const med = median(crop);
      for (let t = 0; t < outLen; t++) out[(w * outLen + t) * nc + c] = crop[t] - med;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- filter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/compute/filter.ts packages/extension/test/filter.test.ts
git commit -m "feat: scipy-compatible Butterworth high-pass and filtfilt"
```

---

### Task 11: Correlograms (phylib-compatible)

**Files:**
- Create: `packages/extension/src/compute/correlograms.ts`
- Test: `packages/extension/test/correlograms.test.ts`

**Interfaces:**
- Consumes: `openDataset`, `buildClusterIndex`, `spikesOf` (tests only).
- Produces:
  - `correlograms(times: Float64Array, spikes: Int32Array, labels: Int32Array, nClusters, binSamples, halfBins): Int32Array`. The output is `(nClusters × nClusters × (2·halfBins+1))`, symmetrised like phylib.
  - `mergeSpikeTrains(lists: Int32Array[]): { spikes: Int32Array; labels: Int32Array }`. The result is ascending in spike index; each label is the list's position.
  - `ccgBins(binSec, windowSec, sampleRate): { binSamples; halfBins }`

- [ ] **Step 1: Write the failing test**

`packages/extension/test/correlograms.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ccgBins, correlograms, mergeSpikeTrains } from '../src/compute/correlograms';
import { buildClusterIndex, spikesOf } from '../src/compute/spikes';
import { openDataset } from '../src/host/dataset/dataset';
import { fixtureParams } from './fixtures/makeFixture';
import { flat, golden } from './helpers';

describe('correlograms', () => {
  it('matches phylib.correlograms on the fixture', async () => {
    const ds = await openDataset(fixtureParams('base'));
    const idx = buildClusterIndex(ds.spikeClusters);
    const g = golden('correlograms.json');
    const { spikes, labels } = mergeSpikeTrains(g.clusters.map((id: number) => spikesOf(idx, id)));
    const c = correlograms(ds.spikeTimes, spikes, labels, 3, g.binSamples, g.halfBins);
    expect(Array.from(c)).toEqual(flat(g.counts));
    await ds.close();
  });

  it('counts lags on a hand-checked train', () => {
    const times = Float64Array.from([0, 10, 20, 100]);
    const c = correlograms(times, Int32Array.from([0, 1, 2, 3]), Int32Array.from([0, 1, 0, 1]), 2, 10, 2);
    expect(Array.from(c)).toEqual([1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it('returns zeros for a single-spike cluster', () => {
    const c = correlograms(Float64Array.from([7]), Int32Array.from([0]), Int32Array.from([0]), 1, 30, 25);
    expect(c).toHaveLength(51);
    expect(c.every((x) => x === 0)).toBe(true);
  });

  it('converts seconds to phy bins', () => {
    expect(ccgBins(0.001, 0.05, 30000)).toEqual({ binSamples: 30, halfBins: 25 });
  });

  it('merges spike trains by spike index', () => {
    const m = mergeSpikeTrains([Int32Array.from([1, 5]), Int32Array.from([2, 3])]);
    expect(Array.from(m.spikes)).toEqual([1, 2, 3, 5]);
    expect(Array.from(m.labels)).toEqual([0, 1, 1, 0]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- correlograms`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/compute/correlograms.ts`:
```ts
/**
 * Auto/cross-correlograms, identical to phylib.stats.ccg.correlograms(symmetrize=True).
 * `times`: all spike times in samples (may be shared memory); `spikes`: the selected clusters' spikes merged
 * in ascending order; `labels`: selection index per entry. Result [i][j][k] counts spikes of j at lag
 * (k − halfBins)·bin relative to spikes of i.
 */
export function correlograms(
  times: Float64Array,
  spikes: Int32Array,
  labels: Int32Array,
  nClusters: number,
  binSamples: number,
  halfBins: number,
): Int32Array {
  const nb = halfBins + 1;
  const c = new Int32Array(nClusters * nClusters * nb);
  for (let i = 0; i < spikes.length; i++) {
    const ti = times[spikes[i]];
    const li = labels[i] * nClusters;
    for (let j = i + 1; j < spikes.length; j++) {
      const d = Math.floor((times[spikes[j]] - ti) / binSamples);
      if (d > halfBins) break;
      c[(li + labels[j]) * nb + d]++;
    }
  }
  const w = 2 * halfBins + 1;
  const out = new Int32Array(nClusters * nClusters * w);
  for (let a = 0; a < nClusters; a++) {
    for (let b = 0; b < nClusters; b++) {
      const o = (a * nClusters + b) * w;
      const ab = (a * nClusters + b) * nb;
      const ba = (b * nClusters + a) * nb;
      for (let k = 1; k < nb; k++) {
        out[o + halfBins - k] = c[ba + k];
        out[o + halfBins + k] = c[ab + k];
      }
      out[o + halfBins] = Math.max(c[ab], c[ba]);
    }
  }
  return out;
}

export function mergeSpikeTrains(lists: Int32Array[]): { spikes: Int32Array; labels: Int32Array } {
  const k = lists.length;
  const keys = new Float64Array(lists.reduce((s, l) => s + l.length, 0));
  let o = 0;
  lists.forEach((l, label) => {
    for (const s of l) keys[o++] = s * k + label;
  });
  keys.sort();
  const spikes = new Int32Array(keys.length);
  const labels = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    labels[i] = keys[i] % k;
    spikes[i] = (keys[i] - labels[i]) / k;
  }
  return { spikes, labels };
}

/** phylib's binning: bin = int(sr·binSec) samples; window = 2·int(.5·window/bin) + 1 bins. */
export function ccgBins(binSec: number, windowSec: number, sampleRate: number): { binSamples: number; halfBins: number } {
  return {
    binSamples: Math.max(1, Math.floor(sampleRate * binSec + 1e-9)),
    halfBins: Math.floor((0.5 * windowSec) / binSec + 1e-9),
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- correlograms`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/compute/correlograms.ts packages/extension/test/correlograms.test.ts
git commit -m "feat: phylib-compatible correlograms"
```

---

### Task 12: Unwhitening, cluster mean template, best channels

**Files:**
- Create: `packages/extension/src/compute/templates.ts`
- Test: `packages/extension/test/templates.test.ts`

**Interfaces:**
- Consumes: `Templates` type (Task 8; a type-only import, erased at runtime).
- Produces:
  - `N_BEST_CHANNELS = 12`
  - `unwhitenedTemplate(T, t, wmi, nChannels): Float64Array`. The result is `(nSamples × nChannels)`, zero on channels a sparse template lacks.
  - `clusterMeanTemplate(T, wmi, nChannels, spikeTemplates, spikes): Float64Array`, weighted by spike count.
  - `bestChannels(mean, nSamples, positions, shanks | undefined, n = 12): { channels: Int32Array; amplitude: Float64Array }`. `channels[0]` is the peak channel, and `amplitude` holds the peak-to-peak value of every channel.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/templates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildClusterIndex, spikesOf } from '../src/compute/spikes';
import { bestChannels, clusterMeanTemplate, unwhitenedTemplate } from '../src/compute/templates';
import { openDataset } from '../src/host/dataset/dataset';
import { fixtureParams } from './fixtures/makeFixture';
import { expectClose, flat, golden } from './helpers';

describe.each(['base', 'sparse'] as const)('cluster templates (%s)', (v) => {
  it('match the numpy reference', async () => {
    const ds = await openDataset(fixtureParams(v));
    const idx = buildClusterIndex(ds.spikeClusters);
    const g = golden('templates.json')[v];
    for (const [id, exp] of Object.entries<{ channels: number[]; mean: number[][]; ptp: number }>(g)) {
      const mean = clusterMeanTemplate(ds.templates!, ds.wmi, ds.nChannels, ds.spikeTemplates!, spikesOf(idx, Number(id)));
      expectClose(mean, flat(exp.mean), 1e-5);
      const { channels, amplitude } = bestChannels(mean, ds.templates!.nSamples, ds.channelPositions, ds.channelShanks);
      expect(Array.from(channels), `cluster ${id}`).toEqual(exp.channels);
      expect(amplitude[channels[0]]).toBeCloseTo(exp.ptp, 5);
    }
    await ds.close();
  });
});

describe('bestChannels', () => {
  // 4 channels on a line; peak-to-peak 1, 5, 3, 4.
  const mean = Float64Array.from([0, 0, 0, 0, 1, 5, 3, 4]);
  const pos = Float32Array.from([0, 0, 0, 1, 0, 2, 0, 3]);
  it('keeps the n nearest channels on the peak shank, ordered by amplitude', () => {
    expect(Array.from(bestChannels(mean, 2, pos, Int32Array.from([0, 0, 0, 1]), 3).channels)).toEqual([1, 2, 0]);
    expect(Array.from(bestChannels(mean, 2, pos, Int32Array.from([0, 0, 0, 1]), 4).channels)).toEqual([1, 2, 0]);
    expect(Array.from(bestChannels(mean, 2, pos, undefined, 4).channels)).toEqual([1, 3, 2, 0]);
  });
});

describe('unwhitenedTemplate', () => {
  it('multiplies the whitened template by the inverse whitening matrix', () => {
    const T = { data: Float32Array.from([1, 2]), nTemplates: 1, nSamples: 1, nCols: 2 };
    expect(Array.from(unwhitenedTemplate(T, 0, Float64Array.from([1, 0.5, 0, 2]), 2))).toEqual([1, 4.5]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- templates`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/compute/templates.ts`:
```ts
import type { Templates } from '../host/dataset/dataset';

export const N_BEST_CHANNELS = 12;

/**
 * phy's unwhitening (template_w · W⁻¹). Sparse templates use the W⁻¹ sub-block of their kept channels,
 * dropping -1 columns and columns without signal (phylib's KS2 hack).
 */
export function unwhitenedTemplate(T: Templates, t: number, wmi: Float64Array, nChannels: number): Float64Array {
  const { nSamples: ns, nCols } = T;
  const base = t * ns * nCols;
  const out = new Float64Array(ns * nChannels);
  let kept: number[];
  let ch: number[];
  if (!T.cols) {
    kept = ch = Array.from({ length: nCols }, (_, i) => i);
  } else {
    const cols = T.cols.subarray(t * nCols, (t + 1) * nCols);
    const colMax = new Float64Array(nCols);
    for (let s = 0; s < ns; s++) {
      for (let k = 0; k < nCols; k++) colMax[k] = Math.max(colMax[k], Math.abs(T.data[base + s * nCols + k]));
    }
    const max = Math.max(...colMax);
    kept = [];
    ch = [];
    for (let k = 0; k < nCols; k++) {
      if (cols[k] >= 0 && colMax[k] > max * 1e-6) {
        kept.push(k);
        ch.push(cols[k]);
      }
    }
  }
  for (let s = 0; s < ns; s++) {
    const row = base + s * nCols;
    for (let i = 0; i < kept.length; i++) {
      const x = T.data[row + kept[i]];
      if (x === 0) continue;
      const w = ch[i] * nChannels;
      for (let j = 0; j < ch.length; j++) out[s * nChannels + ch[j]] += x * wmi[w + ch[j]];
    }
  }
  return out;
}

/** Spike-count-weighted mean of the unwhitened templates of a cluster's spikes. */
// ponytail: O(templates·nS·nC²) per cluster at session open; move the cluster table to a worker if Neuropixels opens slowly.
export function clusterMeanTemplate(
  T: Templates,
  wmi: Float64Array,
  nChannels: number,
  spikeTemplates: Int32Array,
  spikes: Int32Array,
): Float64Array {
  const counts = new Map<number, number>();
  for (const s of spikes) counts.set(spikeTemplates[s], (counts.get(spikeTemplates[s]) ?? 0) + 1);
  const out = new Float64Array(T.nSamples * nChannels);
  for (const [t, c] of counts) {
    if (t < 0 || t >= T.nTemplates) continue;
    const u = unwhitenedTemplate(T, t, wmi, nChannels);
    const w = c / spikes.length;
    for (let i = 0; i < out.length; i++) out[i] += w * u[i];
  }
  return out;
}

/** Peak channel by peak-to-peak amplitude plus its nearest neighbours on the same shank, by decreasing amplitude. */
export function bestChannels(
  mean: Float64Array,
  nSamples: number,
  positions: Float32Array,
  shanks: Int32Array | undefined,
  n = N_BEST_CHANNELS,
): { channels: Int32Array; amplitude: Float64Array } {
  const nC = positions.length / 2;
  const amplitude = new Float64Array(nC);
  for (let c = 0; c < nC; c++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let s = 0; s < nSamples; s++) {
      const v = mean[s * nC + c];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    amplitude[c] = hi - lo;
  }
  let best = 0;
  for (let c = 1; c < nC; c++) if (amplitude[c] > amplitude[best]) best = c;
  const x0 = positions[2 * best];
  const y0 = positions[2 * best + 1];
  const d = (c: number) => (positions[2 * c] - x0) ** 2 + (positions[2 * c + 1] - y0) ** 2;
  const channels = Array.from({ length: nC }, (_, c) => c)
    .sort((a, b) => d(a) - d(b))
    .slice(0, n)
    .filter((c) => !shanks || shanks[c] === shanks[best])
    .sort((a, b) => a - b)
    .sort((a, b) => amplitude[b] - amplitude[a]);
  return { channels: Int32Array.from(channels), amplitude };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- templates`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/compute/templates.ts packages/extension/test/templates.test.ts
git commit -m "feat: unwhitening, cluster mean templates, best channels"
```

---

### Task 13: Histograms (numpy-compatible), ISI, firing rate

**Files:**
- Create: `packages/extension/src/compute/histograms.ts`
- Test: `packages/extension/test/histograms.test.ts`

**Interfaces:**
- Produces:
  - `histogram(values, lo, hi, nBins): Float64Array`. Same binning as `numpy.histogram` for uniform bins: the right edge is included, and values outside are dropped.
  - `ISI = { maxMs: 50, nBins: 100 }`, `FIRING_RATE_BINS = 100`
  - `isiHistogram(times, spikes, sampleRate): Float64Array`
  - `firingRateHistogram(times, spikes, sampleRate, duration): Float64Array` (Hz per bin over `[0, duration]` s)

- [ ] **Step 1: Write the failing test**

`packages/extension/test/histograms.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { firingRateHistogram, histogram, isiHistogram } from '../src/compute/histograms';
import { buildClusterIndex, spikesOf } from '../src/compute/spikes';
import { openDataset } from '../src/host/dataset/dataset';
import { fixtureParams, SR } from './fixtures/makeFixture';
import { expectClose, golden } from './helpers';

describe('histograms', () => {
  it('follows numpy.histogram edge rules', () => {
    expect(Array.from(histogram([0, 0.5, 1, 1.5, 2, 2.5, -1], 0, 2, 2))).toEqual([2, 3]);
  });

  it('matches numpy for ISI and firing rate', async () => {
    const ds = await openDataset(fixtureParams('base'));
    const g = golden('histograms.json');
    const s = spikesOf(buildClusterIndex(ds.spikeClusters), g.cluster);
    expect(ds.duration).toBeCloseTo(g.duration, 12);
    expect(Array.from(isiHistogram(ds.spikeTimes, s, SR))).toEqual(g.isi);
    expectClose(firingRateHistogram(ds.spikeTimes, s, SR, ds.duration), g.firingRate, 1e-9);
    await ds.close();
  });

  it('returns zeros for a single spike', () => {
    const h = isiHistogram(Float64Array.from([10, 20]), Int32Array.from([1]), SR);
    expect(h).toHaveLength(100);
    expect(h.every((x) => x === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- histograms`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/compute/histograms.ts`:
```ts
/** numpy.histogram(values, bins=nBins, range=(lo, hi)) for uniform bins, including its edge corrections. */
export function histogram(values: ArrayLike<number>, lo: number, hi: number, nBins: number): Float64Array {
  const counts = new Float64Array(nBins);
  const step = (hi - lo) / nBins;
  const edge = (i: number) => (i === nBins ? hi : i * step + lo);
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (!(v >= lo && v <= hi)) continue;
    let i = Math.trunc(((v - lo) / (hi - lo)) * nBins);
    if (i === nBins) i--;
    if (v < edge(i)) i--;
    else if (i !== nBins - 1 && v >= edge(i + 1)) i++;
    counts[i]++;
  }
  return counts;
}

export const ISI = { maxMs: 50, nBins: 100 } as const;
export const FIRING_RATE_BINS = 100;

export function isiHistogram(times: Float64Array, spikes: Int32Array, sampleRate: number): Float64Array {
  const isi = new Float64Array(Math.max(0, spikes.length - 1));
  for (let i = 1; i < spikes.length; i++) isi[i - 1] = ((times[spikes[i]] - times[spikes[i - 1]]) / sampleRate) * 1000;
  return histogram(isi, 0, ISI.maxMs, ISI.nBins);
}

export function firingRateHistogram(times: Float64Array, spikes: Int32Array, sampleRate: number, duration: number): Float64Array {
  const t = Float64Array.from(spikes, (s) => times[s] / sampleRate);
  const width = duration / FIRING_RATE_BINS;
  return histogram(t, 0, duration, FIRING_RATE_BINS).map((c) => c / width);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- histograms`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/compute/histograms.ts packages/extension/test/histograms.test.ts
git commit -m "feat: numpy-compatible ISI and firing-rate histograms"
```

---

### Task 14: Session (cluster table, selection, colours)

**Files:**
- Create: `packages/extension/src/host/emitter.ts`, `packages/extension/src/host/session.ts`
- Modify: `packages/extension/test/helpers.ts` (add `openSession`)
- Test: `packages/extension/test/session.test.ts`

**Interfaces:**
- Consumes: `openDataset`/`Dataset` (Task 8), the `compute/spikes`, `compute/templates` and api types.
- Produces:
  - `class Emitter<T> { event: Event<T>; fire(e); dispose() }`
  - `PALETTE: string[]`, phy's selection colours
  - `class Session implements PhySession`:
    - `constructor(dataset: Dataset)`; `dataset: Dataset`; `index: ClusterIndex`
    - `clusters: ClusterTable`. Columns are `['id','n_spikes','group','depth','amplitude','firing_rate', ...metadata fields except group]`, with only clusters that have spikes.
    - `selection`, `select(ids)`: drops unknown ids and duplicates, and fires only on change
    - `spikesOf(id)`, `colorOf(id)` (grey `#808080` when not selected)
    - `meanTemplate(id): Float64Array | undefined`, `bestChannels(id): Int32Array | undefined` (cached)
    - `onDidChangeSelection`, `onDidChangeClusters`, `dispose()`
  - Test helper: `openSession(where: Variant | string, select?: number[]): Promise<{ session; ds }>`

- [ ] **Step 1: Write the failing test**

Append to `packages/extension/test/helpers.ts`:
```ts
import { join } from 'node:path';
import { openDataset } from '../src/host/dataset/dataset';
import { Session } from '../src/host/session';
import { fixtureParams, VARIANTS, type Variant } from './fixtures/makeFixture';

export async function openSession(where: Variant | string, select: number[] = []) {
  const params = (VARIANTS as readonly string[]).includes(where) ? fixtureParams(where as Variant) : join(where, 'params.py');
  const session = new Session(await openDataset(params));
  session.select(select);
  return { session, ds: session.dataset };
}
```
Move the new imports to the top of the file alongside the existing ones.

`packages/extension/test/session.test.ts`:
```ts
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/host/session';
import { CLUSTER_IDS, fixtureDir } from './fixtures/makeFixture';
import { golden, openSession } from './helpers';

describe('Session', () => {
  it('builds the cluster table', async () => {
    const { session } = await openSession('base');
    const t = session.clusters;
    expect(t.columns).toEqual(['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate', 'ContamPct', 'KSLabel']);
    expect(t.rows.map((r) => r[0])).toEqual(CLUSTER_IDS); // 99 is in cluster_group.tsv but has no spikes
    const g = golden('table.json');
    const gt = golden('templates.json').base;
    for (const row of t.rows) {
      const id = String(row[0]);
      expect(row[1]).toBe(g[id].n_spikes);
      expect(row[3]).toBe(gt[id].depth);
      expect(row[4]).toBeCloseTo(g[id].amplitude, 4);
      expect(row[5]).toBeCloseTo(g[id].firing_rate, 9);
    }
    const r50 = t.rows.find((r) => r[0] === 50)!;
    expect(r50[2]).toBeNull(); // empty group
    expect(r50[6]).toBeNull(); // ContamPct nan
    expect(t.rows.find((r) => r[0] === 2)![6]).toBe(1.5);
  });

  it('uses template peak-to-peak for amplitude when amplitudes.npy is missing', async () => {
    const d = mkdtempSync(join(tmpdir(), 'noamp-'));
    cpSync(fixtureDir('base'), d, { recursive: true });
    rmSync(join(d, 'amplitudes.npy'));
    const { session } = await openSession(d);
    const gt = golden('templates.json').base;
    for (const row of session.clusters.rows) expect(row[4]).toBeCloseTo(gt[String(row[0])].ptp, 5);
  });

  it('selects only existing clusters, in order, without duplicates', async () => {
    const { session } = await openSession('base');
    const seen: (readonly number[])[] = [];
    session.onDidChangeSelection((s) => seen.push(s));
    session.select([7, 2, 7, 1234]);
    session.select([7, 2]);
    expect(session.selection).toEqual([7, 2]);
    expect(seen).toEqual([[7, 2]]);
    expect(session.colorOf(7)).toBe(PALETTE[0]);
    expect(session.colorOf(2)).toBe(PALETTE[1]);
    expect(session.colorOf(40)).toBe('#808080');
    expect(session.spikesOf(1234)).toHaveLength(0);
    expect(Array.from(session.bestChannels(7)!)).toEqual(golden('templates.json').base['7'].channels);
  });

  it('works without templates, amplitudes or metadata', async () => {
    const { session } = await openSession('minimal');
    expect(session.clusters.columns).toEqual(['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate']);
    expect(session.clusters.rows.every((r) => r[3] === null && r[4] === null)).toBe(true);
    expect(session.bestChannels(0)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- session`
Expected: FAIL, because `src/host/session` was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/host/emitter.ts`:
```ts
import type { Event } from '@theia-phy/api';

export class Emitter<T> {
  private readonly listeners = new Set<(e: T) => void>();
  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of [...this.listeners]) l(e);
  }
  dispose(): void {
    this.listeners.clear();
  }
}
```

`packages/extension/src/host/session.ts`:
```ts
import type { Cell, ClusterTable, ClusterUpdate, PhySession } from '@theia-phy/api';
import { bsearch, buildClusterIndex, spikesOf, type ClusterIndex } from '../compute/spikes';
import { bestChannels, clusterMeanTemplate } from '../compute/templates';
import type { Dataset } from './dataset/dataset';
import { Emitter } from './emitter';

/** phy's selection colours (colorcet glasbey_bw_minc_20_minl_30, reordered as in phy.utils.color). */
export const PALETTE = [
  '#0892fc', '#ff0202', '#98ff00', '#ffa530', '#b600ff', '#028800', '#ff8fc8', '#79525f',
  '#00fecf', '#b0a5ff', '#94ad84', '#9a6900', '#376a62', '#d3008c', '#fef590', '#c86f66',
];

export class Session implements PhySession {
  readonly index: ClusterIndex;
  readonly clusters: ClusterTable;
  private _selection: number[] = [];
  private readonly selectionEmitter = new Emitter<readonly number[]>();
  private readonly clustersEmitter = new Emitter<ClusterUpdate>();
  readonly onDidChangeSelection = this.selectionEmitter.event;
  readonly onDidChangeClusters = this.clustersEmitter.event;
  private readonly channelCache = new Map<number, Int32Array>();

  constructor(readonly dataset: Dataset) {
    this.index = buildClusterIndex(dataset.spikeClusters);
    this.clusters = this.buildTable();
  }

  get selection(): readonly number[] {
    return this._selection;
  }

  select(ids: number[]): void {
    const next = [...new Set(ids)].filter((id) => bsearch(this.index.ids, id) >= 0);
    if (next.length === this._selection.length && next.every((id, i) => id === this._selection[i])) return;
    this._selection = next;
    this.selectionEmitter.fire(next);
  }

  spikesOf(id: number): Int32Array {
    return spikesOf(this.index, id);
  }

  colorOf(id: number): string {
    const i = this._selection.indexOf(id);
    return i < 0 ? '#808080' : PALETTE[i % PALETTE.length];
  }

  meanTemplate(id: number): Float64Array | undefined {
    const ds = this.dataset;
    if (!ds.templates || !ds.spikeTemplates) return undefined;
    return clusterMeanTemplate(ds.templates, ds.wmi, ds.nChannels, ds.spikeTemplates, this.spikesOf(id));
  }

  bestChannels(id: number): Int32Array | undefined {
    const cached = this.channelCache.get(id);
    if (cached) return cached;
    const mean = this.meanTemplate(id);
    if (!mean) return undefined;
    const ds = this.dataset;
    const { channels } = bestChannels(mean, ds.templates!.nSamples, ds.channelPositions, ds.channelShanks);
    this.channelCache.set(id, channels);
    return channels;
  }

  private buildTable(): ClusterTable {
    const ds = this.dataset;
    const extra = [...ds.metadata.keys()].filter((k) => k !== 'group');
    const columns = ['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate', ...extra];
    const rows = Array.from(this.index.ids, (id): Cell[] => {
      const spikes = this.spikesOf(id);
      let depth: Cell = null;
      let amplitude: Cell = null;
      const mean = this.meanTemplate(id);
      if (mean) {
        const best = bestChannels(mean, ds.templates!.nSamples, ds.channelPositions, ds.channelShanks);
        this.channelCache.set(id, best.channels);
        depth = ds.channelPositions[best.channels[0] * 2 + 1];
        amplitude = best.amplitude[best.channels[0]];
      }
      if (ds.amplitudes) {
        let s = 0;
        for (const i of spikes) s += ds.amplitudes[i];
        amplitude = s / spikes.length;
      }
      return [
        id,
        spikes.length,
        ds.metadata.get('group')?.get(id) ?? null,
        depth,
        amplitude,
        spikes.length / ds.duration,
        ...extra.map((k) => ds.metadata.get(k)!.get(id) ?? null),
      ];
    });
    return { columns, rows };
  }

  dispose(): void {
    this.selectionEmitter.dispose();
    this.clustersEmitter.dispose();
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- session` then `npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/host/emitter.ts packages/extension/src/host/session.ts packages/extension/test/helpers.ts packages/extension/test/session.test.ts
git commit -m "feat: Session with cluster table, selection and phy colours"
```

---

### Task 15: Compute registry, worker entry, worker pool, esbuild

**Files:**
- Create: `packages/extension/src/compute/index.ts`, `packages/extension/src/host/worker.ts`, `packages/extension/src/host/workerPool.ts`, `packages/extension/esbuild.mjs`
- Test: `packages/extension/test/workerPool.test.ts`

**Interfaces:**
- Consumes: `correlograms` (Task 11), `processWindows` (Task 10).
- Produces:
  - `computeFns = { correlograms, processWindows }`, `type ComputeFns`, `type ComputeName`
  - `interface Compute { run<K extends ComputeName>(name: K, ...args: Parameters<ComputeFns[K]>): Promise<ReturnType<ComputeFns[K]>> }`
  - `inlineCompute: Compute` (in-process; used by unit tests)
  - `class WorkerPool implements Compute { constructor(script: string, size?: number); dispose(): Promise<void> }`
  - Bundle `dist/worker.cjs`, built by `npm run build -w packages/extension`
- Worker message: request `{ name, args }`, reply `{ result }` or `{ error }`. Typed-array results are transferred. `SharedArrayBuffer` arguments are shared, not copied.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/workerPool.test.ts`:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inlineCompute } from '../src/compute';
import { WorkerPool } from '../src/host/workerPool';
import { rng } from './fixtures/makeFixture';

let pool: WorkerPool;
beforeAll(async () => {
  const script = join(mkdtempSync(join(tmpdir(), 'pool-')), 'worker.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/host/worker.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', outfile: script, logLevel: 'silent',
  });
  pool = new WorkerPool(script, 2);
});
afterAll(() => pool.dispose());

describe('WorkerPool', () => {
  const r = rng(9);
  const times = new Float64Array(new SharedArrayBuffer(8 * 5000));
  for (let i = 1; i < times.length; i++) times[i] = times[i - 1] + Math.floor(r() * 200);
  const spikes = Int32Array.from({ length: 5000 }, (_, i) => i);
  const labels = Int32Array.from({ length: 5000 }, () => Math.floor(r() * 3));

  it('computes the same result as inline compute', async () => {
    const args = [times, spikes, labels, 3, 30, 25] as const;
    expect(await pool.run('correlograms', ...args)).toEqual(await inlineCompute.run('correlograms', ...args));
  });

  it('runs many jobs concurrently', async () => {
    const jobs = Array.from({ length: 8 }, () => pool.run('correlograms', times, spikes, labels, 3, 30, 25));
    expect((await Promise.all(jobs)).every((c) => c.length === 3 * 3 * 51)).toBe(true);
  });

  it('rejects with the worker error message', async () => {
    const spec = { nWindows: 1, length: 10, nChannels: 1, pad: 0, sampleRate: 30000, highpass: true };
    await expect(pool.run('processWindows', new Float32Array(10), spec)).rejects.toThrow(/filtfilt needs more than 12 samples/);
  });

  it('rejects after dispose', async () => {
    const p = new WorkerPool(join(tmpdir(), 'unused.cjs'), 0);
    await p.dispose();
    await expect(p.run('correlograms', times, spikes, labels, 3, 30, 25)).rejects.toThrow(/disposed/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- workerPool`
Expected: FAIL, because the modules were not found.

- [ ] **Step 3: Implement**

`packages/extension/src/compute/index.ts`:
```ts
import { correlograms } from './correlograms';
import { processWindows } from './filter';

/** Compute functions that may run in worker threads (the WASM seam: swap implementations, keep signatures). */
export const computeFns = { correlograms, processWindows };
export type ComputeFns = typeof computeFns;
export type ComputeName = keyof ComputeFns;

export interface Compute {
  run<K extends ComputeName>(name: K, ...args: Parameters<ComputeFns[K]>): Promise<ReturnType<ComputeFns[K]>>;
}

export const inlineCompute: Compute = {
  run: async (name, ...args) => (computeFns[name] as (...a: unknown[]) => never)(...args),
};
```

`packages/extension/src/host/worker.ts`:
```ts
import { parentPort } from 'node:worker_threads';
import { computeFns, type ComputeName } from '../compute';

parentPort!.on('message', ({ name, args }: { name: ComputeName; args: unknown[] }) => {
  try {
    const result = (computeFns[name] as (...a: unknown[]) => unknown)(...args);
    const transfer = ArrayBuffer.isView(result) && result.buffer instanceof ArrayBuffer ? [result.buffer] : [];
    parentPort!.postMessage({ result }, transfer);
  } catch (e) {
    parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
});
```

`packages/extension/src/host/workerPool.ts`:
```ts
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Compute, ComputeFns, ComputeName } from '../compute';

interface Job {
  name: ComputeName;
  args: unknown[];
  resolve(v: unknown): void;
  reject(e: Error): void;
}

export class WorkerPool implements Compute {
  private readonly idle: Worker[] = [];
  private readonly queue: Job[] = [];
  private readonly running = new Map<Worker, Job>();
  private disposed = false;

  constructor(private readonly script: string, size = Math.max(1, Math.min(4, availableParallelism() - 1))) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  run<K extends ComputeName>(name: K, ...args: Parameters<ComputeFns[K]>): Promise<ReturnType<ComputeFns[K]>> {
    if (this.disposed) return Promise.reject(new Error('worker pool disposed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ name, args, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const gone = new Error('worker pool disposed');
    for (const job of this.queue.splice(0)) job.reject(gone);
    for (const job of this.running.values()) job.reject(gone);
    const workers = [...this.idle, ...this.running.keys()];
    this.running.clear();
    this.idle.length = 0;
    await Promise.all(workers.map((w) => w.terminate()));
  }

  private spawn(): void {
    const w = new Worker(this.script);
    w.on('message', (m: { result?: unknown; error?: string }) => {
      const job = this.running.get(w);
      this.running.delete(w);
      this.idle.push(w);
      if (job) {
        if (m.error !== undefined) job.reject(new Error(m.error));
        else job.resolve(m.result);
      }
      this.pump();
    });
    w.on('error', (e) => {
      this.running.get(w)?.reject(e);
      this.running.delete(w);
      if (!this.disposed) {
        this.spawn();
        this.pump();
      }
    });
    this.idle.push(w);
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(w, job);
      w.postMessage({ name: job.name, args: job.args });
    }
  }
}
```

`packages/extension/esbuild.mjs`:
```js
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, external: ['vscode'], logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['src/host/worker.ts'], outfile: 'dist/worker.cjs' }),
]);
```

- [ ] **Step 4: Run the tests and the build**

Run: `npm test -w packages/extension -- workerPool` then `npm run build`
Expected: tests PASS, and the build writes `packages/extension/dist/worker.cjs`.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/compute/index.ts packages/extension/src/host/worker.ts packages/extension/src/host/workerPool.ts packages/extension/esbuild.mjs packages/extension/test/workerPool.test.ts
git commit -m "feat: compute registry and worker_threads pool"
```

---

### Task 16: View provider plumbing + Waveform provider

**Files:**
- Create: `packages/extension/src/views/types.ts`, `packages/extension/src/views/waveform/provider.ts`
- Modify: `packages/extension/test/helpers.ts` (add `viewContext`)
- Test: `packages/extension/test/waveform.test.ts`

**Interfaces:**
- Consumes: `Session` (14), `Compute`/`inlineCompute` (15), `regularSubset`/`intersectSorted`/`bsearch` (9), `unwhitenedTemplate` (12), `RawData` (7), `NeedsFileError`/`SpikeSubset` (8), `convert` (1).
- Produces:
  - `interface HostViewContext { session: Session; compute: Compute; settings: Readonly<Record<string, unknown>> }`
  - `interface BuiltinView { id: string; title: string; provider(ctx: HostViewContext, token: CancellationToken): Promise<ViewResult> }`
  - `class Cancelled extends Error`, `checkCancel(token)`
  - `WAVEFORM = { maxSpikes: 100, before: 40, after: 42, pad: 200 }`
  - `type WaveformSource = 'precomputed' | 'raw' | 'template'`
  - `interface WaveformMeta { source; notice?; nSamples; channelPositions: number[]; clusters: { id; channels: number[]; spikeIds: number[] }[] }`. For each cluster, buffers are `[waveforms Float32Array (nSpikes × nSamples × nChannels), mean Float32Array (nSamples × nChannels)]`.
  - `waveformView: BuiltinView` (`id: 'waveform'`)
  - `rawWaveforms(ctx, raw, ids, channels): Promise<Float32Array>`
  - Test helper: `viewContext(session, settings?) → HostViewContext` with `inlineCompute`

- [ ] **Step 1: Write the failing test**

Append to `packages/extension/test/helpers.ts`, moving the imports to the top:
```ts
import { inlineCompute } from '../src/compute';
import type { HostViewContext } from '../src/views/types';

export const viewContext = (session: Session, settings: Record<string, unknown> = {}): HostViewContext => ({
  session,
  compute: inlineCompute,
  settings,
});
```

`packages/extension/test/waveform.test.ts`:
```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NeedsFileError } from '../src/host/dataset/dataset';
import { readNpy } from '../src/host/dataset/npy';
import { Cancelled } from '../src/views/types';
import { rawWaveforms, waveformView, type WaveformMeta } from '../src/views/waveform/provider';
import { fixtureDir, NS_TEMPLATE } from './fixtures/makeFixture';
import { expectClose, flat, golden, live, openSession, viewContext } from './helpers';

const g = golden('waveforms.json');

describe('waveform provider', () => {
  it('extracts filtered raw waveforms on the best channels', async () => {
    const { session } = await openSession('base', [7]);
    const r = await waveformView.provider(viewContext(session), live);
    const meta = r.meta as WaveformMeta;
    expect(meta.source).toBe('raw');
    expect(meta.notice).toBeUndefined();
    expect(meta.nSamples).toBe(82);
    const c = meta.clusters[0];
    expect(c.channels).toEqual(g.cluster.channels);
    expect(c.spikeIds.slice(0, 3)).toEqual(g.cluster.spikeIds);
    const size = 82 * c.channels.length;
    const wf = new Float32Array(r.buffers[0]);
    expectClose(wf.subarray(0, 3 * size), flat(g.cluster.waveforms), 1e-3);
    const mean = new Float32Array(r.buffers[1]);
    expect(mean).toHaveLength(size);
    const avg0 = c.spikeIds.reduce((s, _, i) => s + wf[i * size], 0) / c.spikeIds.length;
    expect(mean[0]).toBeCloseTo(avg0, 3);
  });

  it('zero-pads windows of spikes at the recording edges', async () => {
    const { session } = await openSession('base');
    const raw = session.dataset.raw;
    if (!raw.ok) throw new Error(raw.reason);
    const wf = await rawWaveforms(viewContext(session), raw.raw, Int32Array.from(g.edge.spikeIds), Int32Array.from(g.edge.channels));
    expectClose(wf, flat(g.edge.waveforms), 1e-3);
  });

  it.each([
    ['noraw', /^raw data not found: .*missing\.bin — showing templates$/],
    ['badraw', /inconsistent with n_channels_dat=8, dtype=i2, offset=0 — showing templates$/],
  ] as const)('falls back to templates when raw data is unusable (%s)', async (v, notice) => {
    const { session, ds } = await openSession(v, [7]);
    const meta = (await waveformView.provider(viewContext(session), live)) as { meta: WaveformMeta; buffers: ArrayBuffer[] };
    expect(meta.meta.source).toBe('template');
    expect(meta.meta.notice).toMatch(notice);
    expect(meta.meta.nSamples).toBe(NS_TEMPLATE);
    // Cluster 7 has a single template, so each waveform is that template × the spike's amplitude.
    const tmpl = golden('templates.json').base['7'].mean as number[][];
    const c = meta.meta.clusters[0];
    const wf = new Float32Array(meta.buffers[0]);
    c.channels.forEach((ch, j) => expect(wf[10 * c.channels.length + j]).toBeCloseTo(tmpl[10][ch] * ds.amplitudes![c.spikeIds[0]], 2));
  });

  it('prefers precomputed _phy_spikes_subset waveforms', async () => {
    const { session } = await openSession('precomputed', [7]);
    const r = await waveformView.provider(viewContext(session), live);
    const meta = r.meta as WaveformMeta;
    expect(meta.source).toBe('precomputed');
    expect(meta.nSamples).toBe(41);
    const c = meta.clusters[0];
    expect(c.spikeIds.every((s) => s % 3 === 0)).toBe(true);
    const chans = (await readNpy(join(fixtureDir('precomputed'), '_phy_spikes_subset.channels.npy'))).data as Int32Array;
    const row = c.spikeIds[0] / 3;
    const rowCh = Array.from(chans.subarray(row * 4, row * 4 + 4));
    const wf = new Float32Array(r.buffers[0]);
    c.channels.forEach((ch, j) => {
      const k = rowCh.indexOf(ch);
      expect(wf[5 * c.channels.length + j]).toBe(k < 0 ? 0 : ((row * 41 + 5) * 4 + k) % 997);
    });
  });

  it('needs templates.npy', async () => {
    const { session } = await openSession('minimal', [0]);
    await expect(waveformView.provider(viewContext(session), live)).rejects.toThrow(NeedsFileError);
    await expect(waveformView.provider(viewContext(session), live)).rejects.toThrow('needs templates.npy');
  });

  it('handles an empty selection and a single-spike cluster', async () => {
    const { session } = await openSession('base');
    expect(await waveformView.provider(viewContext(session), live)).toMatchObject({ buffers: [] });
    session.select([50]);
    const r = await waveformView.provider(viewContext(session), live);
    expect((r.meta as WaveformMeta).clusters[0].spikeIds).toHaveLength(1);
    expect(r.buffers).toHaveLength(2);
  });

  it('stops when cancelled', async () => {
    const { session } = await openSession('base', [7]);
    await expect(waveformView.provider(viewContext(session), { isCancellationRequested: true })).rejects.toBeInstanceOf(Cancelled);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- waveform`
Expected: FAIL, because the modules were not found.

- [ ] **Step 3: Implement**

`packages/extension/src/views/types.ts`:
```ts
import type { CancellationToken, ViewResult } from '@theia-phy/api';
import type { Compute } from '../compute';
import type { Session } from '../host/session';

export interface HostViewContext {
  readonly session: Session;
  readonly compute: Compute;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** A built-in view's data side; its renderer is added in Plan 2. */
export interface BuiltinView {
  id: string;
  title: string;
  provider(ctx: HostViewContext, token: CancellationToken): Promise<ViewResult>;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export function checkCancel(token: CancellationToken): void {
  if (token.isCancellationRequested) throw new Cancelled();
}
```

`packages/extension/src/views/waveform/provider.ts`:
```ts
import { bsearch, intersectSorted, regularSubset } from '../../compute/spikes';
import { unwhitenedTemplate } from '../../compute/templates';
import { NeedsFileError, type SpikeSubset } from '../../host/dataset/dataset';
import { convert } from '../../host/dataset/npy';
import type { RawData } from '../../host/dataset/raw';
import { checkCancel, type BuiltinView, type HostViewContext } from '../types';

export const WAVEFORM = { maxSpikes: 100, before: 40, after: 42, pad: 200 } as const;
export type WaveformSource = 'precomputed' | 'raw' | 'template';
export interface WaveformMeta {
  source: WaveformSource;
  notice?: string;
  nSamples: number;
  channelPositions: number[];
  clusters: { id: number; channels: number[]; spikeIds: number[] }[];
}

export const waveformView: BuiltinView = {
  id: 'waveform',
  title: 'Waveform',
  async provider(ctx, token) {
    const { session } = ctx;
    const ds = session.dataset;
    if (!ds.templates) throw new NeedsFileError('templates.npy');
    if (!ds.spikeTemplates) throw new NeedsFileError('spike_templates.npy');
    const raw = ds.raw;
    const sub = ds.spikeSubset;
    const source: WaveformSource = sub ? 'precomputed' : raw.ok ? 'raw' : 'template';
    const nSamples = sub ? sub.nSamples : raw.ok ? WAVEFORM.before + WAVEFORM.after : ds.templates.nSamples;
    const meta: WaveformMeta = {
      source,
      notice: !sub && !raw.ok ? `${raw.reason} — showing templates` : undefined,
      nSamples,
      channelPositions: Array.from(ds.channelPositions),
      clusters: [],
    };
    const buffers: ArrayBufferLike[] = [];
    for (const id of session.selection) {
      checkCancel(token);
      const channels = session.bestChannels(id)!;
      const spikes = sub ? intersectSorted(session.spikesOf(id), sub.spikes) : session.spikesOf(id);
      const ids = regularSubset(spikes, WAVEFORM.maxSpikes);
      const wf = sub
        ? await precomputedWaveforms(sub, ids, channels)
        : raw.ok
          ? await rawWaveforms(ctx, raw.raw, ids, channels)
          : templateWaveforms(ctx, ids, channels);
      checkCancel(token);
      meta.clusters.push({ id, channels: Array.from(channels), spikeIds: Array.from(ids) });
      buffers.push(wf.buffer, meanWaveform(wf, ids.length, nSamples * channels.length).buffer);
    }
    return { meta, buffers };
  },
};

function meanWaveform(wf: Float32Array, n: number, size: number): Float32Array {
  const m = new Float32Array(size);
  for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) m[k] += wf[i * size + k] / n;
  return m;
}

/** Raw windows around each spike on `channels`, high-passed (unless hp_filtered) and median-subtracted. */
export async function rawWaveforms(ctx: HostViewContext, raw: RawData, ids: Int32Array, channels: Int32Array): Promise<Float32Array> {
  const ds = ctx.session.dataset;
  const { before, after, pad } = WAVEFORM;
  const length = before + after + 2 * pad;
  const nc = channels.length;
  const all = await raw.readWindows(Array.from(ids, (s) => ds.spikeTimes[s] - before - pad), length);
  const picked = new Float32Array(ids.length * length * nc);
  for (let r = 0; r < ids.length * length; r++) {
    for (let j = 0; j < nc; j++) picked[r * nc + j] = all[r * raw.nChannels + ds.channelMap[channels[j]]];
  }
  return ctx.compute.run('processWindows', picked, {
    nWindows: ids.length, length, nChannels: nc, pad, sampleRate: ds.sampleRate, highpass: !ds.params.hpFiltered,
  });
}

async function precomputedWaveforms(sub: SpikeSubset, ids: Int32Array, channels: Int32Array): Promise<Float32Array> {
  const rows = Array.from(ids, (s) => bsearch(sub.spikes, s));
  const data = convert(await sub.waveforms.readRows(rows), Float32Array);
  const { nSamples: ns, nChannels: nsc } = sub;
  const nc = channels.length;
  const out = new Float32Array(ids.length * ns * nc);
  rows.forEach((row, w) => {
    for (let j = 0; j < nc; j++) {
      let k = 0;
      while (k < nsc && sub.channels[row * nsc + k] !== channels[j]) k++;
      if (k === nsc) continue;
      for (let t = 0; t < ns; t++) out[(w * ns + t) * nc + j] = data[(w * ns + t) * nsc + k];
    }
  });
  return out;
}

/** Template fallback: each spike's unwhitened template × its amplitude (1 without amplitudes.npy). */
function templateWaveforms(ctx: HostViewContext, ids: Int32Array, channels: Int32Array): Float32Array {
  const ds = ctx.session.dataset;
  const T = ds.templates!;
  const ns = T.nSamples;
  const nc = channels.length;
  const cache = new Map<number, Float64Array>();
  const out = new Float32Array(ids.length * ns * nc);
  ids.forEach((s, w) => {
    const t = ds.spikeTemplates![s];
    let u = cache.get(t);
    if (!u) {
      u = unwhitenedTemplate(T, t, ds.wmi, ds.nChannels);
      cache.set(t, u);
    }
    const amp = ds.amplitudes ? ds.amplitudes[s] : 1;
    for (let k = 0; k < ns; k++) for (let j = 0; j < nc; j++) out[(w * ns + k) * nc + j] = u[k * ds.nChannels + channels[j]] * amp;
  });
  return out;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- waveform` then `npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/views/types.ts packages/extension/src/views/waveform/provider.ts packages/extension/test/helpers.ts packages/extension/test/waveform.test.ts
git commit -m "feat: waveform provider with raw, precomputed and template sources"
```

---

### Task 17: Feature provider

**Files:**
- Create: `packages/extension/src/views/feature/provider.ts`
- Test: `packages/extension/test/feature.test.ts`

**Interfaces:**
- Consumes: Tasks 8, 9, 14, 16.
- Produces:
  - `FEATURE = { maxSpikes: 10000, maxBackground: 10000, nChannels: 4, nPcs: 3 }`
  - `interface FeatureMeta { channels: number[]; nPcs: number; groups: { id: number | null; n: number }[] }`. Group 0 is the background (`id: null`), followed by the selected clusters in selection order. For each group, buffers are `[features Float32Array (n × channels × nPcs, NaN where the spike's template has no feature on that channel), times Float32Array (n, seconds)]`.
  - `featureView: BuiltinView` (`id: 'feature'`)

- [ ] **Step 1: Write the failing test**

`packages/extension/test/feature.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { NeedsFileError } from '../src/host/dataset/dataset';
import { featureView, type FeatureMeta } from '../src/views/feature/provider';
import { expectClose, flat, golden, live, openSession, viewContext } from './helpers';

const g = golden('features.json');

describe('feature provider', () => {
  it("reads PC features on the first selected cluster's best channels", async () => {
    const { session } = await openSession('base', [7, 2]);
    const r = await featureView.provider(viewContext(session), live);
    const meta = r.meta as FeatureMeta;
    expect(meta.channels).toEqual(g.channels);
    expect(meta.nPcs).toBe(3);
    expect(meta.groups.map((x) => x.id)).toEqual([null, 7, 2]);
    expect(r.buffers).toHaveLength(6);
    expectClose(new Float32Array(r.buffers[2]).subarray(0, 5 * 4 * 3), flat(g.features), 1e-6);
    const bg = new Float32Array(r.buffers[0]);
    for (let i = 0; i < meta.groups[0].n; i++) expect(Number.isNaN(bg[i * 12])).toBe(false);
  });

  it('only uses spikes listed in pc_feature_spike_ids', async () => {
    const { session } = await openSession('subset', [7]);
    const meta = (await featureView.provider(viewContext(session), live)).meta as FeatureMeta;
    expect(meta.groups[1].n).toBe(Array.from(session.spikesOf(7)).filter((s) => s % 2 === 0).length);
  });

  it('gives identical results for a Fortran-order pc_features.npy', async () => {
    const [a, b] = await Promise.all([openSession('base', [7]), openSession('fortran', [7])]);
    const ra = await featureView.provider(viewContext(a.session), live);
    const rb = await featureView.provider(viewContext(b.session), live);
    expect(rb.meta).toEqual(ra.meta);
    rb.buffers.forEach((buf, i) => expect(new Float32Array(buf)).toEqual(new Float32Array(ra.buffers[i])));
  });

  it('needs pc_features.npy', async () => {
    const { session } = await openSession('minimal', [0]);
    await expect(featureView.provider(viewContext(session), live)).rejects.toThrow(NeedsFileError);
  });

  it('returns no groups for an empty selection', async () => {
    const { session } = await openSession('base');
    expect(await featureView.provider(viewContext(session), live)).toEqual({ meta: { channels: [], nPcs: 0, groups: [] }, buffers: [] });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- feature`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement**

`packages/extension/src/views/feature/provider.ts`:
```ts
import { bsearch, intersectSorted, regularRange, regularSubset } from '../../compute/spikes';
import { NeedsFileError, type Dataset, type Features } from '../../host/dataset/dataset';
import { convert } from '../../host/dataset/npy';
import { checkCancel, type BuiltinView } from '../types';

export const FEATURE = { maxSpikes: 10_000, maxBackground: 10_000, nChannels: 4, nPcs: 3 } as const;
export interface FeatureMeta {
  channels: number[];
  nPcs: number;
  groups: { id: number | null; n: number }[];
}

export const featureView: BuiltinView = {
  id: 'feature',
  title: 'Feature',
  async provider({ session }, token) {
    const ds = session.dataset;
    const F = ds.features;
    const st = ds.spikeTemplates;
    if (!F) throw new NeedsFileError('pc_features.npy');
    if (!st) throw new NeedsFileError('spike_templates.npy');
    const sel = session.selection;
    if (sel.length === 0) return { meta: { channels: [], nPcs: 0, groups: [] } satisfies FeatureMeta, buffers: [] };

    const templateChannels = (s: number) => F.ind.subarray(st[s] * F.nLoc, (st[s] + 1) * F.nLoc);
    const withFeatures = (spikes: Int32Array) => (F.spikeIds ? intersectSorted(spikes, F.spikeIds) : spikes);
    const channels = (session.bestChannels(sel[0]) ?? templateChannels(session.spikesOf(sel[0])[0])).slice(0, FEATURE.nChannels);
    const nPcs = Math.min(FEATURE.nPcs, F.nPcs);
    const background = Int32Array.from(regularRange(F.spikeIds?.length ?? ds.nSpikes, FEATURE.maxBackground), (r) => F.spikeIds?.[r] ?? r)
      .filter((s) => templateChannels(s).includes(channels[0]));
    const groups = [
      { id: null as number | null, spikes: background },
      ...sel.map((id) => ({ id: id as number | null, spikes: regularSubset(withFeatures(session.spikesOf(id)), FEATURE.maxSpikes) })),
    ];

    const buffers: ArrayBufferLike[] = [];
    for (const g of groups) {
      checkCancel(token);
      const { feats, times } = await readFeatures(ds, F, g.spikes, channels, nPcs);
      buffers.push(feats.buffer, times.buffer);
    }
    checkCancel(token);
    const meta: FeatureMeta = { channels: Array.from(channels), nPcs, groups: groups.map((g) => ({ id: g.id, n: g.spikes.length })) };
    return { meta, buffers };
  },
};

async function readFeatures(ds: Dataset, F: Features, spikes: Int32Array, channels: Int32Array, nPcs: number) {
  const rows = F.spikeIds ? Array.from(spikes, (s) => bsearch(F.spikeIds!, s)) : spikes;
  const data = convert(await F.file.readRows(rows), Float32Array);
  const nc = channels.length;
  const rowLen = F.nPcs * F.nLoc;
  const feats = new Float32Array(spikes.length * nc * nPcs).fill(NaN);
  const times = new Float32Array(spikes.length);
  spikes.forEach((s, i) => {
    times[i] = ds.spikeTimes[s] / ds.sampleRate;
    const t = ds.spikeTemplates![s];
    const ind = F.ind.subarray(t * F.nLoc, (t + 1) * F.nLoc);
    for (let j = 0; j < nc; j++) {
      const l = ind.indexOf(channels[j]);
      if (l >= 0) for (let p = 0; p < nPcs; p++) feats[(i * nc + j) * nPcs + p] = data[i * rowLen + p * F.nLoc + l];
    }
  });
  return { feats, times };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -w packages/extension -- feature`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/views/feature/provider.ts packages/extension/test/feature.test.ts
git commit -m "feat: feature provider with background spikes"
```

---

### Task 18: Correlogram, Amplitude and Cluster-statistics providers; built-in view list

**Files:**
- Create: `packages/extension/src/views/correlogram/provider.ts`, `packages/extension/src/views/amplitude/provider.ts`, `packages/extension/src/views/stats/provider.ts`, `packages/extension/src/views/index.ts`
- Test: `packages/extension/test/providers.test.ts`

**Interfaces:**
- Consumes: Tasks 11, 13, 14, 15, 16.
- Produces:
  - `CORRELOGRAM = { binSec: 0.001, windowSec: 0.05 }`. Settings `binSec` and `windowSec` override the defaults.
  - `interface CorrelogramMeta { clusters: number[]; binSec; windowSec; nBins; firingRates: number[]; baseline: number[] /* n×n: nᵢ·nⱼ·bin/duration */ }`. Buffers are `[Int32Array n×n×nBins]`.
  - `AMPLITUDE = { maxSpikes: 20000 }`. `interface AmplitudeMeta { clusters: { id; n }[] }`. For each cluster, buffers are `[times Float32Array (s), amplitudes Float32Array]`.
  - `builtinHistograms: HistogramDefinition[]` (`isi`, `firing_rate`)
  - `clusterStatsView(histograms): BuiltinView`, with `id: 'cluster_statistics'`
  - `interface StatsMeta { clusters: number[]; histograms: { id; label; unit?; range? }[] }`. Buffers run histogram-major, then cluster: `Float64Array`.
  - `builtinViews: BuiltinView[]` = waveform, feature, correlogram, amplitude, cluster_statistics

- [ ] **Step 1: Write the failing test**

`packages/extension/test/providers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { NeedsFileError } from '../src/host/dataset/dataset';
import { amplitudeView, type AmplitudeMeta } from '../src/views/amplitude/provider';
import { correlogramView, type CorrelogramMeta } from '../src/views/correlogram/provider';
import { builtinViews } from '../src/views';
import { builtinHistograms, clusterStatsView, type StatsMeta } from '../src/views/stats/provider';
import { SR } from './fixtures/makeFixture';
import { expectClose, flat, golden, live, openSession, viewContext } from './helpers';

describe('correlogram provider', () => {
  it('matches phylib for the selected clusters', async () => {
    const { session, ds } = await openSession('base', [2, 7, 40]);
    const r = await correlogramView.provider(viewContext(session), live);
    const meta = r.meta as CorrelogramMeta;
    expect(meta.nBins).toBe(51);
    expect(Array.from(new Int32Array(r.buffers[0]))).toEqual(flat(golden('correlograms.json').counts));
    const [n2, n7] = [2, 7].map((id) => session.spikesOf(id).length);
    expect(meta.baseline[1]).toBeCloseTo((n2 * n7 * 0.001) / ds.duration, 12);
    expect(meta.firingRates[0]).toBeCloseTo(n2 / ds.duration, 12);
  });

  it('honours bin and window settings', async () => {
    const { session } = await openSession('base', [7]);
    const r = await correlogramView.provider(viewContext(session, { binSec: 0.002, windowSec: 0.05 }), live);
    expect((r.meta as CorrelogramMeta).nBins).toBe(25);
  });

  it('returns zeros for a single-spike cluster', async () => {
    const { session } = await openSession('base', [50]);
    const r = await correlogramView.provider(viewContext(session), live);
    expect(new Int32Array(r.buffers[0]).every((x) => x === 0)).toBe(true);
  });
});

describe('amplitude provider', () => {
  it('returns times and amplitudes of sampled spikes', async () => {
    const { session, ds } = await openSession('base', [2]);
    const r = await amplitudeView.provider(viewContext(session), live);
    const spikes = session.spikesOf(2);
    expect((r.meta as AmplitudeMeta).clusters).toEqual([{ id: 2, n: spikes.length }]);
    expect(Array.from(new Float32Array(r.buffers[1]))).toEqual(Array.from(spikes, (s) => ds.amplitudes![s]));
    expect(new Float32Array(r.buffers[0])[0]).toBeCloseTo(ds.spikeTimes[spikes[0]] / SR, 6);
  });

  it('needs amplitudes.npy', async () => {
    const { session } = await openSession('minimal', [0]);
    await expect(amplitudeView.provider(viewContext(session), live)).rejects.toThrow(NeedsFileError);
  });
});

describe('cluster statistics provider', () => {
  it('computes ISI and firing-rate histograms per cluster', async () => {
    const { session, ds } = await openSession('base', [7, 2]);
    const r = await clusterStatsView(builtinHistograms).provider(viewContext(session), live);
    const meta = r.meta as StatsMeta;
    expect(meta.clusters).toEqual([7, 2]);
    expect(meta.histograms.map((h) => h.id)).toEqual(['isi', 'firing_rate']);
    expect(meta.histograms[1].range).toEqual([0, ds.duration]);
    expect(r.buffers).toHaveLength(4);
    const g = golden('histograms.json');
    expect(Array.from(new Float64Array(r.buffers[0]))).toEqual(g.isi);
    expectClose(new Float64Array(r.buffers[2]), g.firingRate, 1e-9);
  });

  it('returns nothing for an empty selection', async () => {
    const { session } = await openSession('base');
    expect((await clusterStatsView(builtinHistograms).provider(viewContext(session), live)).buffers).toEqual([]);
  });
});

describe('builtinViews', () => {
  it('lists the five v1 plot views', () => {
    expect(builtinViews.map((v) => v.id)).toEqual(['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- providers`
Expected: FAIL, because the modules were not found.

- [ ] **Step 3: Implement**

`packages/extension/src/views/correlogram/provider.ts`:
```ts
import { ccgBins, mergeSpikeTrains } from '../../compute/correlograms';
import { checkCancel, type BuiltinView } from '../types';

export const CORRELOGRAM = { binSec: 0.001, windowSec: 0.05 } as const;
export interface CorrelogramMeta {
  clusters: number[];
  binSec: number;
  windowSec: number;
  nBins: number;
  firingRates: number[];
  baseline: number[];
}

const positive = (v: unknown, fallback: number) => (typeof v === 'number' && v > 0 ? v : fallback);

export const correlogramView: BuiltinView = {
  id: 'correlogram',
  title: 'Correlogram',
  async provider({ session, compute, settings }, token) {
    const ds = session.dataset;
    const sel = [...session.selection];
    const binSec = positive(settings.binSec, CORRELOGRAM.binSec);
    const windowSec = positive(settings.windowSec, CORRELOGRAM.windowSec);
    const { binSamples, halfBins } = ccgBins(binSec, windowSec, ds.sampleRate);
    const lists = sel.map((id) => session.spikesOf(id));
    const { spikes, labels } = mergeSpikeTrains(lists);
    checkCancel(token);
    const counts = await compute.run('correlograms', ds.spikeTimes, spikes, labels, sel.length, binSamples, halfBins);
    checkCancel(token);
    const n = lists.map((l) => l.length);
    const meta: CorrelogramMeta = {
      clusters: sel,
      binSec,
      windowSec,
      nBins: 2 * halfBins + 1,
      firingRates: n.map((c) => c / ds.duration),
      baseline: n.flatMap((a) => n.map((b) => (a * b * binSec) / ds.duration)),
    };
    return { meta, buffers: [counts.buffer] };
  },
};
```

`packages/extension/src/views/amplitude/provider.ts`:
```ts
import { regularSubset } from '../../compute/spikes';
import { NeedsFileError } from '../../host/dataset/dataset';
import { checkCancel, type BuiltinView } from '../types';

export const AMPLITUDE = { maxSpikes: 20_000 } as const;
export interface AmplitudeMeta {
  clusters: { id: number; n: number }[];
}

export const amplitudeView: BuiltinView = {
  id: 'amplitude',
  title: 'Amplitude',
  async provider({ session }, token) {
    const ds = session.dataset;
    const amps = ds.amplitudes;
    if (!amps) throw new NeedsFileError('amplitudes.npy');
    const meta: AmplitudeMeta = { clusters: [] };
    const buffers: ArrayBufferLike[] = [];
    for (const id of session.selection) {
      checkCancel(token);
      const ids = regularSubset(session.spikesOf(id), AMPLITUDE.maxSpikes);
      buffers.push(Float32Array.from(ids, (s) => ds.spikeTimes[s] / ds.sampleRate).buffer, Float32Array.from(ids, (s) => amps[s]).buffer);
      meta.clusters.push({ id, n: ids.length });
    }
    return { meta, buffers };
  },
};
```

`packages/extension/src/views/stats/provider.ts`:
```ts
import type { HistogramDefinition } from '@theia-phy/api';
import { firingRateHistogram, isiHistogram, ISI } from '../../compute/histograms';
import { checkCancel, type BuiltinView } from '../types';

export interface StatsMeta {
  clusters: number[];
  histograms: { id: string; label: string; unit?: string; range?: [number, number] }[];
}

export const builtinHistograms: HistogramDefinition[] = [
  {
    id: 'isi',
    label: 'ISI',
    unit: 'ms',
    range: () => [0, ISI.maxMs],
    compute: (spikes, { session }) => isiHistogram(session.dataset.spikeTimes, spikes, session.dataset.sampleRate),
  },
  {
    id: 'firing_rate',
    label: 'Firing rate (Hz)',
    unit: 's',
    range: ({ session }) => [0, session.dataset.duration],
    compute: (spikes, { session }) => {
      const ds = session.dataset;
      return firingRateHistogram(ds.spikeTimes, spikes, ds.sampleRate, ds.duration);
    },
  },
];

export function clusterStatsView(histograms: readonly HistogramDefinition[]): BuiltinView {
  return {
    id: 'cluster_statistics',
    title: 'Cluster statistics',
    async provider({ session }, token) {
      const ctx = { session };
      const buffers: ArrayBufferLike[] = [];
      for (const h of histograms) {
        for (const id of session.selection) {
          checkCancel(token);
          buffers.push(h.compute(session.spikesOf(id), ctx).buffer);
        }
      }
      const meta: StatsMeta = {
        clusters: [...session.selection],
        histograms: histograms.map((h) => ({ id: h.id, label: h.label, unit: h.unit, range: h.range?.(ctx) })),
      };
      return { meta, buffers };
    },
  };
}
```

`packages/extension/src/views/index.ts`:
```ts
import { amplitudeView } from './amplitude/provider';
import { correlogramView } from './correlogram/provider';
import { featureView } from './feature/provider';
import { builtinHistograms, clusterStatsView } from './stats/provider';
import type { BuiltinView } from './types';
import { waveformView } from './waveform/provider';

export const builtinViews: BuiltinView[] = [waveformView, featureView, correlogramView, amplitudeView, clusterStatsView(builtinHistograms)];
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test` then `npm run typecheck`
Expected: every test file PASSES, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/views packages/extension/test/providers.test.ts
git commit -m "feat: correlogram, amplitude and cluster-statistics providers"
```

---

### Task 19: Extension shell (custom editor, command, summary/error page) + smoke test

**Files:**
- Create: `packages/extension/src/host/html.ts`, `packages/extension/src/host/editor.ts`, `packages/extension/src/extension.ts`
- Create: `packages/extension/test/smoke/run.ts`, `packages/extension/test/smoke/index.ts`, `.vscode/launch.json`
- Modify: `packages/extension/package.json` (`contributes`, `test:smoke` script), `packages/extension/esbuild.mjs` (extension and smoke entries)
- Test: `packages/extension/test/html.test.ts`, plus the smoke test

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `errorHtml(message): string`, `summaryHtml(session): string` (CSP `default-src 'none'; style-src 'unsafe-inline';`)
  - `class DatasetEditorProvider implements vscode.CustomReadonlyEditorProvider { activeSession: Session | undefined }`
  - Command `phy.openDataset` (optional `Uri` argument: a folder or `params.py`; otherwise a folder picker)
  - Custom editor `theiaPhy.dataset` for `params.py` (priority `option`, so ordinary Python editing is unaffected)
  - `interface ExtensionApi { activeSession(): Session | undefined; runView(id: string, settings?: Record<string, unknown>): Promise<ViewResult> }`, returned by `activate`. Plan 3 replaces it with `PhyApi`.

- [ ] **Step 1: Write the failing unit test**

`packages/extension/test/html.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { errorHtml, summaryHtml } from '../src/host/html';
import { openSession } from './helpers';

describe('pages', () => {
  it('escapes and shows the error', () => {
    const h = errorHtml('missing required file channel_map.npy <script>');
    expect(h).toContain('missing required file channel_map.npy');
    expect(h).not.toContain('<script>');
    expect(h).toContain("default-src 'none'");
  });
  it('summarises a dataset including the raw-data reason', async () => {
    const { session, ds } = await openSession('noraw');
    const h = summaryHtml(session);
    expect(h).toContain('raw data not found');
    expect(h).toContain(`<td>${ds.nSpikes}</td>`);
    expect(h).toContain('<td>5</td>');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w packages/extension -- html`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement the pages, the editor and activation**

`packages/extension/src/host/html.ts`:
```ts
import type { Session } from './session';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">` +
  `<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:1em}` +
  `td{padding:0 1.5em 0 0}.err{color:var(--vscode-errorForeground)}</style></head><body>${body}</body></html>`;

export function errorHtml(message: string): string {
  return page(`<h2 class="err">Could not open dataset</h2><p>${esc(message)}</p>`);
}

export function summaryHtml(session: Session): string {
  const ds = session.dataset;
  const t = ds.templates;
  const rows: [string, string][] = [
    ['Folder', ds.dir],
    ['Spikes', String(ds.nSpikes)],
    ['Clusters', String(session.clusters.rows.length)],
    ['Channels', String(ds.nChannels)],
    ['Duration', `${ds.duration.toFixed(1)} s`],
    ['Sample rate', `${ds.sampleRate} Hz`],
    ['Raw data', ds.raw.ok ? `${ds.raw.raw.nSamples} samples × ${ds.raw.raw.nChannels} channels` : ds.raw.reason],
    ['Templates', t ? `${t.nTemplates} × ${t.nSamples} samples${t.cols ? ' (sparse)' : ''}` : 'missing'],
    ['Amplitudes', ds.amplitudes ? 'yes' : 'missing'],
    ['PC features', ds.features ? `${ds.features.nPcs} PCs × ${ds.features.nLoc} channels` : 'missing'],
  ];
  return page(`<h2>Phy dataset</h2><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`);
}
```

`packages/extension/src/host/editor.ts`:
```ts
import * as vscode from 'vscode';
import { openDataset } from './dataset/dataset';
import { errorHtml, summaryHtml } from './html';
import { Session } from './session';

class DatasetDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri, readonly session: Session | undefined, readonly error: string | undefined) {}
  dispose(): void {
    this.session?.dispose();
    void this.session?.dataset.close();
  }
}

export class DatasetEditorProvider implements vscode.CustomReadonlyEditorProvider<DatasetDocument> {
  activeSession: Session | undefined;

  constructor(private readonly storage: vscode.Uri) {}

  async openCustomDocument(uri: vscode.Uri): Promise<DatasetDocument> {
    try {
      const dataset = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Opening phy dataset' },
        (progress) =>
          openDataset(uri.fsPath, {
            cacheDir: vscode.Uri.joinPath(this.storage, 'cache').fsPath,
            onProgress: (message, f) => progress.report({ message: f === undefined ? message : `${message} ${Math.round(f * 100)}%` }),
          }),
      );
      return new DatasetDocument(uri, new Session(dataset), undefined);
    } catch (e) {
      return new DatasetDocument(uri, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  resolveCustomEditor(doc: DatasetDocument, panel: vscode.WebviewPanel): void {
    panel.webview.html = doc.session ? summaryHtml(doc.session) : errorHtml(doc.error ?? 'unknown error');
    this.activeSession = doc.session;
    panel.onDidChangeViewState(() => {
      if (panel.active) this.activeSession = doc.session;
    });
    panel.onDidDispose(() => {
      if (this.activeSession === doc.session) this.activeSession = undefined;
    });
  }
}
```

`packages/extension/src/extension.ts`:
```ts
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ViewResult } from '@theia-phy/api';
import { DatasetEditorProvider } from './host/editor';
import type { Session } from './host/session';
import { WorkerPool } from './host/workerPool';
import { builtinViews } from './views';

export interface ExtensionApi {
  activeSession(): Session | undefined;
  runView(id: string, settings?: Record<string, unknown>): Promise<ViewResult>;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const pool = new WorkerPool(join(context.extensionPath, 'dist', 'worker.cjs'));
  const editor = new DatasetEditorProvider(context.globalStorageUri);
  context.subscriptions.push(
    { dispose: () => void pool.dispose() },
    vscode.window.registerCustomEditorProvider('theiaPhy.dataset', editor, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('phy.openDataset', async (uri?: vscode.Uri) => {
      const target = uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Open Phy Dataset' }))?.[0];
      if (!target) return;
      const params = target.path.endsWith('/params.py') ? target : vscode.Uri.joinPath(target, 'params.py');
      await vscode.commands.executeCommand('vscode.openWith', params, 'theiaPhy.dataset');
    }),
  );
  return {
    activeSession: () => editor.activeSession,
    runView: (id, settings = {}) => {
      const session = editor.activeSession;
      const view = builtinViews.find((v) => v.id === id);
      if (!session) return Promise.reject(new Error('no active phy dataset'));
      if (!view) return Promise.reject(new Error(`unknown view ${id}`));
      return view.provider({ session, compute: pool, settings }, { isCancellationRequested: false });
    },
  };
}

export function deactivate(): void {}
```

In `packages/extension/package.json`, replace `"contributes": {}` with:
```json
"contributes": {
  "commands": [{ "command": "phy.openDataset", "title": "Phy: Open Dataset…" }],
  "customEditors": [
    {
      "viewType": "theiaPhy.dataset",
      "displayName": "Phy Dataset",
      "selector": [{ "filenamePattern": "params.py" }],
      "priority": "option"
    }
  ]
},
```
and add the script `"test:smoke": "node esbuild.mjs && tsx test/smoke/run.ts"`.

Replace `packages/extension/esbuild.mjs` with:
```js
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, external: ['vscode'], logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs' }),
  build({ ...common, entryPoints: ['src/host/worker.ts'], outfile: 'dist/worker.cjs' }),
  build({ ...common, entryPoints: ['test/smoke/index.ts'], outfile: 'dist-test/smoke.cjs' }),
]);
```

- [ ] **Step 4: Run the unit test**

Run: `npm test -w packages/extension -- html` then `npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 5: Write the smoke test**

`packages/extension/test/smoke/run.ts`:
```ts
import { resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';
import { makeAllFixtures, OUT } from '../fixtures/makeFixture';

makeAllFixtures();
await runTests({
  extensionDevelopmentPath: resolve('.'),
  extensionTestsPath: resolve('dist-test/smoke.cjs'),
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  extensionTestsEnv: { PHY_FIXTURES: OUT },
});
```

`packages/extension/test/smoke/index.ts`:
```ts
import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';

async function waitFor<T>(get: () => T | undefined, what: string): Promise<T> {
  const end = Date.now() + 30_000;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function run(): Promise<void> {
  const fixtures = process.env.PHY_FIXTURES!;
  const api = await vscode.extensions.getExtension<ExtensionApi>('theia-phy.theia-phy')!.activate();

  await vscode.commands.executeCommand('phy.openDataset', vscode.Uri.file(join(fixtures, 'base')));
  const session = await waitFor(() => api.activeSession(), 'base session');
  assert.equal(session.clusters.rows.length, 5);
  session.select([7, 2]);
  for (const id of ['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics']) {
    const r = await api.runView(id);
    assert.ok(r.buffers.length > 0, `${id} returned no buffers`);
  }
  assert.equal(((await api.runView('waveform')).meta as { source: string }).source, 'raw');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => (api.activeSession() ? undefined : true), 'editor to close');
  await vscode.commands.executeCommand('phy.openDataset', vscode.Uri.file(join(fixtures, 'noraw')));
  const noraw = await waitFor(() => api.activeSession(), 'noraw session');
  noraw.select([7]);
  const meta = (await api.runView('waveform')).meta as { source: string; notice: string };
  assert.equal(meta.source, 'template');
  assert.match(meta.notice, /raw data not found/);
}
```

`.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Theia-Phy",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/packages/extension"],
      "outFiles": ["${workspaceFolder}/packages/extension/dist/**/*.cjs"]
    }
  ]
}
```

- [ ] **Step 6: Run the smoke test**

Run: `npm run test:smoke -w packages/extension`
Expected: the first run downloads VS Code into `packages/extension/.vscode-test`. The run ends with exit code 0, and the VS Code output ends with `Exit code: 0`. If a step times out, use `PHY_FIXTURES` to check that the fixture path exists and that `dist/worker.cjs` was built.

- [ ] **Step 7: Manual check on the real dataset**

Run `npm run build`, open the repo in VS Code, and press F5 ("Run Theia-Phy"). In the dev host, run **Phy: Open Dataset…** and pick `dataset/ks4-019e7fd7-bbe4-7eb7-8b98-8441e7c04c89/2026-05-07-R001A`.
Expected: the summary page shows 3611945 spikes, 297 clusters, 29 channels and a duration of ≈ 7539.6 s. Its Raw data row reads `raw data not found: /Users/…/Theia-Phy/ks4-019e7fd7-…/2026-05-07-R001.bin`, because `dat_path` points outside `dataset/`.

- [ ] **Step 8: Commit**

```bash
git add packages/extension/src/host/html.ts packages/extension/src/host/editor.ts packages/extension/src/extension.ts packages/extension/package.json packages/extension/esbuild.mjs packages/extension/test/html.test.ts packages/extension/test/smoke .vscode/launch.json
git commit -m "feat: dataset custom editor, open command, smoke test"
```

---

### Task 20: Performance gate benchmarks + real-dataset check

**Files:**
- Create: `packages/extension/test/bench/compute.bench.ts`, `packages/extension/scripts/check-real.ts`, `tools/goldens/real_summary.py`
- Modify: `packages/extension/package.json` (add the `check:real` script)

**Interfaces:**
- Consumes: `correlograms`, `processWindows`, `openDataset`, `Session`, `WorkerPool`, `builtinViews`; Python `best_channels`/`mean_template` from `make_goldens.py`.
- Produces: `npm run bench -w packages/extension` and `npm run check:real -w packages/extension -- <dataset-dir> [--dat <raw.bin>]`

- [ ] **Step 1: Write the benchmarks**

`packages/extension/test/bench/compute.bench.ts`:
```ts
import { bench, describe } from 'vitest';
import { correlograms } from '../../src/compute/correlograms';
import { processWindows } from '../../src/compute/filter';
import { rng } from '../fixtures/makeFixture';

const r = rng(1);
const N = 1_000_000; // 10 clusters × 100k spikes, ≈1 h at 30 kHz
const times = new Float64Array(N);
for (let i = 1; i < N; i++) times[i] = times[i - 1] + Math.floor(-Math.log(1 - r()) * 108);
const spikes = Int32Array.from({ length: N }, (_, i) => i);
const labels = Int32Array.from({ length: N }, () => Math.floor(r() * 10));
const windows = Float32Array.from({ length: 100 * 482 * 12 }, () => r() * 200 - 100);

// Spec §5 performance gate: a typical cluster click must stay under ~200 ms, otherwise port the function to WASM.
describe('performance gate', () => {
  bench('correlograms: 10 clusters × 100k spikes', () => {
    correlograms(times, spikes, labels, 10, 30, 25);
  });
  bench('filter: 100 raw windows × 12 channels', () => {
    processWindows(windows, { nWindows: 100, length: 482, nChannels: 12, pad: 200, sampleRate: 30000, highpass: true });
  });
});
```

- [ ] **Step 2: Run the benchmarks and record the gate result**

Run: `npm run bench -w packages/extension`
Expected: both benchmarks report a mean below 200 ms. Paste the two `mean` values into the commit message. If either mean is ≥ 200 ms, the spec's approach-C gate trips. Report it, and do not port anything in this plan.

- [ ] **Step 3: Write the real-dataset check**

`packages/extension/scripts/check-real.ts`:
```ts
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
```

Add to `packages/extension/package.json` scripts: `"check:real": "node esbuild.mjs && tsx scripts/check-real.ts"`.

`tools/goldens/real_summary.py`:
```python
"""Print the same per-cluster summary as `npm run check:real`, computed with numpy, for cross-checking.

    uv run --project tools/goldens python tools/goldens/real_summary.py <dataset dir>
"""
import sys
from pathlib import Path

import numpy as np
from make_goldens import Fixture, best_channels, mean_template

d = Path(sys.argv[1])
f = Fixture(d.parent if d.name == "params.py" else d)
ids, counts = np.unique(f.sc, return_counts=True)
print(f"{len(f.st)} spikes, {f.n_ch} channels, {f.duration:.1f} s, {len(ids)} clusters")
for cid in ids[np.argsort(-counts, kind="stable")][:3]:
    s = f.spikes(cid)
    ch, _ = best_channels(mean_template(f.templates, f.cols, f.wmi, f.stt, s, f.n_ch), f.pos, f.shanks)
    print(f"cluster {cid}: n={len(s)} amplitude={f.amps[s].astype(np.float64).mean()} depth={f.pos[ch[0], 1]} channels={','.join(map(str, ch))}")
```

- [ ] **Step 4: Run both against the real dataset**

Run:
```bash
npm run check:real -w packages/extension -- ../../dataset/ks4-019e7fd7-bbe4-7eb7-8b98-8441e7c04c89/2026-05-07-R001A
npm run check:real -w packages/extension -- ../../dataset/ks4-019e7fd7-bbe4-7eb7-8b98-8441e7c04c89/2026-05-07-R001A --dat ../../dataset/2026-05-07-R001.bin
uv run --project tools/goldens python tools/goldens/real_summary.py dataset/ks4-019e7fd7-bbe4-7eb7-8b98-8441e7c04c89/2026-05-07-R001A
```
The relative paths in the first two commands are correct because npm runs workspace scripts from `packages/extension`.

Expected:
- **First run.** It reports `3611945 spikes, 29 channels, 7539.6 s, raw: raw data not found: …`. Every view prints a time and a byte count with no `ERROR`. The waveform line shows `source=template` and a `notice="raw data not found: … — showing templates"`.
- **Second run.** It reports `raw: ok` and `waveform … source=raw`.
- **Cross-check.** The three cluster lines (n, amplitude, depth, channels) match between the TS output and the Python output: n, depth and channels are identical, and amplitude agrees to about 6 significant digits.
- **Timing.** Each view's time stays under ~200 ms, except that the first `feature` call may be slower on a cold disk cache. Record the timings in the commit message.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/test/bench/compute.bench.ts packages/extension/scripts/check-real.ts packages/extension/package.json tools/goldens/real_summary.py
git commit -m "test: performance-gate benchmarks and real-dataset check"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| §1 Desktop + Remote-SSH (`extensionKind: workspace`), pure TS | 1, 19 |
| §2 `CustomReadonlyEditorProvider` for `params.py` + `Phy: Open Dataset…` | 19 |
| §2 host owns state; `compute/` pure functions in a `worker_threads` pool (WASM seam) | 9–13, 15 |
| §2 npm workspaces, esbuild, vitest, test-electron | 1, 15, 19 |
| §3 `params.py` restricted parser, line-named errors | 2 |
| §3 `.npy` v1–3, dtypes, big-endian error, Fortran small (transpose) / large (C-order cache under globalStorage) | 1, 6, 8, 19 |
| §3 `cluster_*.tsv`, ignore `cluster_info.tsv` | 3 |
| §3 raw `dat_path` list/relative, dtype, offset, time-major | 7 |
| §3 required/optional files, `spike_clusters` fallback, 2-D KS4 `spike_templates`, `template_ind` vs `templates_ind`, whitening inverse/identity, `*_spike_ids`, `_phy_spikes_subset` | 8 |
| §3 memory strategy (SAB per-spike arrays, row reads, coalesced ranges, no mmap) | 1, 6, 8 |
| §3 cluster→spike counting-sort index owned by Session | 9, 14 |
| §3 deterministic subsampling with per-view caps | 9, 16–18 |
| §3 waveforms: best channels, precomputed → raw (filter, median) → template fallback with notice | 10, 12, 16 |
| §3 errors: missing required, missing optional ("needs"), shape mismatch naming both files | 8, 16–18 |
| §4 Session: table columns, events, colours by selection order (phy palette) | 14 |
| §4 cancellation of in-flight requests (token checks; stale `seq` dropping is Plan 2) | 16–18 |
| §5 provider halves of Waveform, Feature, Correlogram, Amplitude, Cluster statistics | 16–18 |
| §5 performance gate benchmarks | 20 |
| §8 fixture variants, goldens via a dev-only phylib script, unit tests, benchmarks, smoke test | 4, 5, all, 19, 20 |
| §4 protocol/commands/keys/persistence; §5 Cluster view, plot layer, renderers, tiling | **Plan 2** |
| §6 `PhyApi`, mods, plugin folder | **Plan 3** (`HistogramDefinition`/`ViewContext` types exist now) |
| §7 curation | design only (`onDidChangeClusters` declared) |
