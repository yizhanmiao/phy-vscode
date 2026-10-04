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
