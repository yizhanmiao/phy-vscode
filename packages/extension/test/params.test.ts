import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePythonLiterals, readParams, toParams } from '../src/host/dataset/params';

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

  it('ignores a leading UTF-8 BOM', async () => {
    const d = mkdtempSync(join(tmpdir(), 'bom-'));
    writeFileSync(join(d, 'params.py'), '\uFEFFsample_rate = 30000.0\n');
    expect((await readParams(join(d, 'params.py'))).sampleRate).toBe(30000);
  });
});
