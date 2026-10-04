import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/webview/plot/plot';
import type { BarsLayer, ScatterLayer } from '../src/webview/plot/scene';
import { AMP_BINS, buildAmplitudeScene } from '../src/views/amplitude/scene';
import type { AmplitudeMeta } from '../src/views/amplitude/provider';

const theme: Theme = { fg: [1, 1, 1, 1], muted: [0.5, 0.5, 0.5, 1], bg: [0, 0, 0, 1] };
const meta: AmplitudeMeta = { clusters: [{ id: 7, n: 4 }] };
const times = Float32Array.from([0, 1, 2, 10]);
const amps = Float32Array.from([10, 20, 20, 30]);
const sel = { ids: [7], colors: ['#ff0000'] };

describe('amplitude scene', () => {
  it('plots amplitude over time with a marginal histogram sharing the y range', () => {
    const s = buildAmplitudeScene(meta, [times.buffer, amps.buffer], sel, theme);
    expect([s.rows, s.cols, s.colWeights]).toEqual([1, 2, [4, 1]]);
    const [main, side] = s.panels;
    expect((main.layers[0] as ScatterLayer).y).toEqual(amps);
    expect(main.x).toEqual({ min: -0.5, max: 10.5 });
    expect(main.y).toEqual({ min: 9, max: 31 });
    expect(side.y).toEqual(main.y);
    expect(side.axes).toBe(false);
    const hist = side.layers[0] as BarsLayer;
    expect(hist.horizontal).toBe(true);
    expect(hist.heights).toHaveLength(AMP_BINS);
    expect(Math.max(...hist.heights)).toBe(1);
    expect(hist.heights.reduce((a, b) => a + b, 0)).toBeCloseTo(4 / 2); // counts normalised by the peak bin (2)
  });

  it('shows a message for an empty selection', () => {
    expect(buildAmplitudeScene({ clusters: [] }, [], { ids: [], colors: [] }, theme).message).toBe('Select a cluster');
  });
});
