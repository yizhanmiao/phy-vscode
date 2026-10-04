/**
 * Next selection when stepping through `order` (the Cluster view's sorted+filtered ids): one step after the
 * last selected cluster; from the start/end when none is selected or it is not in `order`.
 */
export function stepSelection(order: number[], selected: readonly number[], delta: 1 | -1, extend: boolean): number[] | undefined {
  if (order.length === 0) return undefined;
  const last = selected[selected.length - 1];
  const i = last === undefined ? -1 : order.indexOf(last);
  const j = i < 0 ? (delta > 0 ? 0 : order.length - 1) : i + delta;
  if (j < 0 || j >= order.length) return undefined;
  const next = order[j];
  return extend ? [...selected.filter((x) => x !== next), next] : [next];
}
