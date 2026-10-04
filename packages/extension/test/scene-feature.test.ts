import { describe, expect, it } from 'vitest';
import type { Plot, PlotClick, Theme } from '../src/webview/plot/plot';
import type { RendererHost } from '../src/webview/plot/renderer';
import type { Scene, ScatterLayer } from '../src/webview/plot/scene';
import featureRenderer from '../src/views/feature/renderer';
import { buildFeatureScene, cycleDim, DEFAULT_GRID, dimValues, parseDim, validGrid } from '../src/views/feature/scene';
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

describe('persisted feature grid', () => {
  it('accepts only a non-empty rectangular grid of well-formed cells', () => {
    const ok = [['time,0A', '1A,0B']];
    expect(validGrid(ok)).toBe(ok);
    expect(validGrid(DEFAULT_GRID)).toBe(DEFAULT_GRID);
    expect(validGrid('grid')).toBeUndefined();
    expect(validGrid({ length: 1 })).toBeUndefined();
    expect(validGrid(undefined)).toBeUndefined();
    expect(validGrid([])).toBeUndefined();
    expect(validGrid([[]])).toBeUndefined();
    expect(validGrid([['time,0A', '1A,0A'], ['0A,1A']])).toBeUndefined(); // ragged
    expect(validGrid([['time,0A'], 'time,0A'])).toBeUndefined(); // row is not an array
    expect(validGrid([['time,0A', 7]])).toBeUndefined(); // cell is not a string
    expect(validGrid([['0A']])).toBeUndefined(); // one-part cell
    expect(validGrid([['0A,x']])).toBeUndefined(); // bad half
    expect(validGrid([['0A,1B,time']])).toBeUndefined(); // three parts
  });

  it('falls back to the default grid, and clicks stay safe, when the saved grid is bad', () => {
    let state: unknown = { grid: [['0A']] };
    const scenes: Scene[] = [];
    const click: ((e: PlotClick) => void)[] = [];
    const plot = { setScene: (s: Scene) => scenes.push(s), onClick: (l: (e: PlotClick) => void) => click.push(l), theme: () => theme, dispose() {} } as unknown as Plot;
    const host = { settings: {}, setSettings() {}, getState: () => state, setState: (s: unknown) => (state = s) } as unknown as RendererHost;
    const r = featureRenderer();
    r.mount({} as HTMLElement, plot, host);
    r.update(meta, buffers, sel);
    expect(scenes[0].panels.map((p) => p.title)).toEqual(buildFeatureScene(meta, buffers, sel, theme).panels.map((p) => p.title));
    click[0]({ panel: 1, x: 0, y: 0, shift: false, button: 0 }); // cell "1A,0A": y 0A -> 0B
    expect((state as { grid: string[][] }).grid[0][1]).toBe('1A,0B');
    expect(scenes[1].panels[1].title).toBe('ch13A / ch12B');
  });
});
