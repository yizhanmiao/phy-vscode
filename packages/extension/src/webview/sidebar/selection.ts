/** phy-style click selection over the visible `order`: plain replaces, ctrl toggles, shift ranges from the anchor. */
export function clickSelect(
  order: number[],
  selected: readonly number[],
  anchor: number | undefined,
  id: number,
  mods: { ctrl: boolean; shift: boolean },
): { selected: number[]; anchor: number } {
  if (mods.shift && anchor !== undefined) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      return { selected: a <= b ? range : range.reverse(), anchor };
    }
  }
  if (mods.ctrl) return { selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], anchor: id };
  return { selected: [id], anchor: id };
}
