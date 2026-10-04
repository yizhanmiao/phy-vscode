import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { BarsLayer } from '../src/webview/plot/scene';
import { buildCorrelogramScene } from '../src/views/correlogram/scene';
import type { CorrelogramMeta } from '../src/views/correlogram/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const meta: CorrelogramMeta = { clusters: [7, 2], binSec: 0.001, windowSec: 0.005, nBins: 5, firingRates: [10, 20], baseline: [0.5, 1, 1, 2] };
const counts = Int32Array.from({ length: 20 }, (_, i) => i);
const sel = { ids: [7, 2], colors: ['#ff0000', '#0000ff'] };

describe('correlogram scene', () => {
  it('lays out an n×n grid of centred bars with refractory and baseline guides', () => {
    const s = buildCorrelogramScene(meta, [counts.buffer], sel, theme);
    expect([s.rows, s.cols, s.panels.length]).toEqual([2, 2, 4]);
    const p01 = s.panels[1];
    const bars = p01.layers[0] as BarsLayer;
    expect(bars.x0).toBeCloseTo(-2.5);
    expect(bars.dx).toBeCloseTo(1);
    expect(Array.from(bars.heights)).toEqual([5, 6, 7, 8, 9]);
    expect(p01.x).toEqual({ min: -2.5, max: 2.5 });
    expect(p01.y.max).toBeCloseTo(9 * 1.05);
    expect(p01.vlines).toEqual([-2, 2]);
    expect(p01.hlines).toEqual([1]);
    expect(p01.title).toBe('2');
    expect((s.panels[0].layers[0] as BarsLayer).color).toEqual([1, 0, 0, 1]); // auto-correlogram in cluster colour
    expect((s.panels[3].layers[0] as BarsLayer).color).toEqual([0, 0, 1, 1]);
    expect((p01.layers[0] as BarsLayer).color[3]).toBeCloseTo(0.55);
    expect(s.panels[2].title).toBeUndefined();
  });

  it('never makes a degenerate y range', () => {
    const s = buildCorrelogramScene({ ...meta, clusters: [7], baseline: [0], nBins: 5 }, [new Int32Array(5).buffer], { ids: [7], colors: ['#ff0000'] }, theme);
    expect(s.panels[0].y).toEqual({ min: 0, max: 1.05 });
  });

  it('shows a message for an empty selection', () => {
    expect(buildCorrelogramScene({ ...meta, clusters: [] }, [new ArrayBuffer(0)], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });
});
