import { describe, test } from 'vitest';
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
  test('correlograms: 10 clusters × 100k spikes', async ({ bench }) => {
    const res = await bench('correlograms: 10 clusters × 100k spikes', () => {
      correlograms(times, spikes, labels, 10, 30, 25);
    }).run();
    console.log(`${res.name}: mean ${res.latency.mean.toFixed(2)} ms`);
  });
  test('filter: 100 raw windows × 12 channels', async ({ bench }) => {
    const res = await bench('filter: 100 raw windows × 12 channels', () => {
      processWindows(windows, { nWindows: 100, length: 482, nChannels: 12, pad: 200, sampleRate: 30000, highpass: true });
    }).run();
    console.log(`${res.name}: mean ${res.latency.mean.toFixed(2)} ms`);
  });
});
