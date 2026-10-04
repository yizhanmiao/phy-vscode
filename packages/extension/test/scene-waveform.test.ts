import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { LinesLayer } from '../src/webview/plot/scene';
import { boxSize, buildWaveformScene } from '../src/views/waveform/scene';
import type { WaveformMeta } from '../src/views/waveform/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const sel = { ids: [7], colors: ['#ff0000'] };
// 1 cluster on channels 0 (0,0) and 1 (0,20); 3 samples; 1 spike.
const meta: WaveformMeta = {
  source: 'raw', nSamples: 3, templateSamples: 2, channelPositions: [0, 0, 0, 20],
  clusters: [{ id: 7, channels: [0, 1], spikeIds: [3] }],
};
const mean = Float32Array.from([0, 0, -2, 1, 0, 0]); // (nS × nCh): ch0 [0,-2,0], ch1 [0,1,0]
const buffers = [mean.slice().buffer, mean.slice().buffer, Float32Array.from([1, 1, 1, 1]).buffer];
const arr = (a: Float32Array) => Array.from(a, (v) => (Number.isNaN(v) ? null : Number(v.toFixed(3))));

describe('waveform scene', () => {
  it('sizes boxes from the probe spacing', () => {
    expect(boxSize([0, 0, 0, 20], [0, 1])).toEqual({ w: 36, h: 18 });
    expect(boxSize([0, 0, 16, 0, 0, 20], [0, 1, 2]).w).toBeCloseTo(14.4);
  });

  it('sizes the box height from the pitch within a column on a staggered probe', () => {
    // two columns (x 0 and 22.5), each on a 25 µm pitch, offset by 12.5 µm: boxes in different columns cannot overlap
    const stagger = [0, 0, 22.5, 12.5, 0, 25, 22.5, 37.5, 0, 50, 22.5, 62.5];
    const b = boxSize(stagger, [0, 1, 2, 3, 4, 5]);
    expect(b.w).toBeCloseTo(20.25);
    expect(b.h).toBeCloseTo(22.5);
    // a subset that only spans one column still uses its own pitch
    expect(boxSize(stagger, [0, 2, 4])).toEqual({ w: 36, h: 22.5 });
  });

  it('keeps the single-column and fallback sizes', () => {
    expect(boxSize([0, 0, 0, 20, 0, 45], [0, 1, 2])).toEqual({ w: 36, h: 18 });
    expect(boxSize([5, 5], [0])).toEqual({ w: 36, h: 36 });
    // two columns on the same row: no pair shares a column, so the height falls back to 40 µm
    expect(boxSize([0, 0, 30, 0], [0, 1])).toEqual({ w: 27, h: 36 });
  });

  it('draws each channel at its probe position, spikes faint and the mean opaque', () => {
    const s = buildWaveformScene(meta, buffers, sel, theme, { meanOnly: false, showTemplate: false });
    expect(s.panels).toHaveLength(1);
    const p = s.panels[0];
    expect(p.axes).toBe(false);
    expect(p.x).toEqual({ min: -36, max: 36 });
    expect(p.y).toEqual({ min: -18, max: 38 });
    const [spikes, m] = p.layers as LinesLayer[];
    // Spikes are faint (alpha 0.15), have data, and width undefined (repeated width passes compound alpha)
    expect(spikes.color[3]).toBeCloseTo(0.15);
    expect(spikes.x.length).toBeGreaterThan(0);
    expect(spikes.width).toBeUndefined();
    expect(m.color).toEqual([1, 0, 0, 1]);
    expect(m.width).toEqual(2.5);
    // yScale = (18/2)/max|mean| = 4.5
    expect(arr(m.x)).toEqual([-18, 0, 18, null, -18, 0, 18, null]);
    expect(arr(m.y)).toEqual([0, -9, 0, null, 20, 24.5, 20, null]);
  });

  it('honours mean-only and template overlay', () => {
    const s = buildWaveformScene(meta, buffers, sel, theme, { meanOnly: true, showTemplate: true });
    const layers = s.panels[0].layers as LinesLayer[];
    expect(layers).toHaveLength(2);
    expect(layers[0].width).toBe(2.5);
    expect(layers[1].width).toBeUndefined();
    expect(arr(layers[1].x)).toEqual([-18, 18, null, -18, 18, null]);
  });

  it('shows a message for an empty selection', () => {
    expect(buildWaveformScene({ ...meta, clusters: [] }, [], { ids: [], colors: [] }, theme, { meanOnly: false, showTemplate: false }).message).toBe('Select a cluster');
  });
});
