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
