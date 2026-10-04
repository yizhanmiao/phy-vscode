import { describe, expect, it } from 'vitest';
import { stepSelection } from '../src/shared/order';

describe('stepSelection', () => {
  const order = [5, 2, 9];
  it('starts at the ends when nothing is selected', () => {
    expect(stepSelection(order, [], 1, false)).toEqual([5]);
    expect(stepSelection(order, [], -1, false)).toEqual([9]);
  });
  it('moves after the last selected cluster in the current order', () => {
    expect(stepSelection(order, [9, 5], 1, false)).toEqual([2]);
    expect(stepSelection(order, [2], -1, false)).toEqual([5]);
  });
  it('stops at the ends and on an empty order', () => {
    expect(stepSelection(order, [9], 1, false)).toBeUndefined();
    expect(stepSelection([], [], 1, false)).toBeUndefined();
  });
  it('extends the selection when asked', () => {
    expect(stepSelection(order, [5], 1, true)).toEqual([5, 2]);
  });
  it('restarts from the ends when the last selected cluster is filtered out', () => {
    expect(stepSelection(order, [42], 1, false)).toEqual([5]);
  });
});
