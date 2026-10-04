import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { ScatterLayer } from '../src/webview/plot/scene';
import { buildFeatureScene, cycleDim, DEFAULT_GRID, dimValues, parseDim } from '../src/views/feature/scene';
import type { FeatureMeta } from '../src/views/feature/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
// 2 channels × 2 PCs; background 1 spike, cluster 7 with 2 spikes.
const meta: FeatureMeta = { channels: [12, 13], nPcs: 2, groups: [{ id: null, n: 1 }, { id: 7, n: 2 }] };
const bgF = Float32Array.from([1, 2, 3, NaN]);
const bgT = Float32Array.from([0.5]);
const cF = Float32Array.from([10, 20, 30, 40, 11, 21, 31, 41]);
const cT = Float32Array.from([1, 2]);
const buffers = [bgF.buffer, bgT.buffer, cF.buffer, cT.buffer];
const sel = { ids: [7], colors: ['#00ff00'] };

describe('feature scene', () => {
  it('parses and cycles grid dimensions', () => {
    expect(parseDim('time')).toEqual({ kind: 'time' });
    expect(parseDim('1B')).toEqual({ kind: 'pc', ch: 1, pc: 1 });
    expect(() => parseDim('x')).toThrow(/bad feature dimension/);
    expect(cycleDim('0A', 'pc', 2, 3)).toBe('0B');
    expect(cycleDim('0C', 'pc', 2, 3)).toBe('0A');
    expect(cycleDim('1A', 'channel', 2, 3)).toBe('0A');
    expect(cycleDim('time', 'pc', 2, 3)).toBe('time');
  });

  it('reads PC values and times, NaN when out of range', () => {
    expect(Array.from(dimValues(parseDim('1A'), cF, cT, 2, 2))).toEqual([30, 31]);
    expect(Array.from(dimValues(parseDim('time'), cF, cT, 2, 2))).toEqual([1, 2]);
    expect(Array.from(dimValues(parseDim('0C'), cF, cT, 2, 2)).every(Number.isNaN)).toBe(true);
  });

  it('builds phy’s 4×4 grid with a grey background and coloured clusters', () => {
    const s = buildFeatureScene(meta, buffers, sel, theme);
    expect([s.rows, s.cols, s.panels.length]).toEqual([4, 4, 16]);
    const cell = s.panels[1]; // "1A,0A"
    expect(cell.title).toBe('ch13A / ch12A');
    const [bg, c7] = cell.layers as ScatterLayer[];
    expect(Array.from(bg.x)).toEqual([3]);
    expect(Array.from(c7.y)).toEqual([10, 11]);
    expect(bg.color[3]).toBeCloseTo(0.35);
    expect(c7.color).toEqual([0, 1, 0, 0.8]);
    expect(s.panels[0].title).toBe('time / ch12A');
  });

  it('shows a message for an empty selection', () => {
    expect(buildFeatureScene({ channels: [], nPcs: 0, groups: [] }, [], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });

  it('keeps the default grid shape', () => {
    expect(DEFAULT_GRID.map((r) => r.length)).toEqual([4, 4, 4, 4]);
  });
});
