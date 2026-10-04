import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { LinesLayer } from '../src/webview/plot/scene';
import { buildStatsScene, stepLine } from '../src/views/stats/scene';
import type { StatsMeta } from '../src/views/stats/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const meta: StatsMeta = {
  clusters: [7, 2],
  histograms: [
    { id: 'isi', label: 'ISI', unit: 'ms', range: [0, 50] },
    { id: 'firing_rate', label: 'Firing rate (Hz)', unit: 's' },
  ],
};
const h = (...v: number[]) => Float64Array.from(v).buffer;
const buffers = [h(1, 3), h(2, 0), h(4, 4, 4, 4), h(0, 1, 0, 1)];
const sel = { ids: [7, 2], colors: ['#ff0000', '#0000ff'] };

describe('stats scene', () => {
  it('draws step outlines', () => {
    const s = stepLine(Float64Array.from([1, 3]), 0, 25);
    expect(Array.from(s.x)).toEqual([0, 25, 25, 50]);
    expect(Array.from(s.y)).toEqual([1, 1, 3, 3]);
  });

  it('stacks one panel per histogram with one coloured outline per cluster', () => {
    const s = buildStatsScene(meta, buffers, sel, theme);
    expect([s.rows, s.cols]).toEqual([2, 1]);
    const [isi, fr] = s.panels;
    expect(isi.title).toBe('ISI');
    expect(isi.xLabel).toBe('ms');
    expect(isi.x).toEqual({ min: 0, max: 50 });
    expect(isi.y.max).toBeCloseTo(3 * 1.05);
    const [a, b] = isi.layers as LinesLayer[];
    expect(a.color).toEqual([1, 0, 0, 1]);
    expect(b.color).toEqual([0, 0, 1, 1]);
    expect(fr.x).toEqual({ min: 0, max: 4 }); // no range: bin indices
    expect(fr.row).toBe(1);
  });

  it('survives an empty range and all-zero histograms', () => {
    const s = buildStatsScene({ clusters: [7], histograms: [{ id: 'x', label: 'x', range: [3, 3] }] }, [h(0, 0)], { ids: [7], colors: ['#fff'] }, theme);
    expect(s.panels[0].x).toEqual({ min: 3, max: 4 });
    expect(s.panels[0].y).toEqual({ min: 0, max: 1.05 });
  });

  it('shows a message for an empty selection', () => {
    expect(buildStatsScene({ ...meta, clusters: [] }, [], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });
});
