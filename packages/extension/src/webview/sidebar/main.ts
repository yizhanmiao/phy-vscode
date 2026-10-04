import type { Cell, HostToSidebar, SelectionMsg, SidebarToHost, TableState } from '@theia-phy/api';
import { stepSelection } from '../../shared/order';
import { vscodeApi } from '../vscode';
import { parseFilter } from './filter';
import { clickSelect, isPlainArrow } from './selection';
import { formatCell, groupTint, scrollTopFor, sortRows, visibleRange } from './table';

const ROW_H = 22;
/** `key` ties the webview's own saved state to one dataset (`api.getState()` is per sidebar, not per dataset). */
type LocalState = TableState & { key?: string };
const api = vscodeApi<LocalState>();
const post = (m: SidebarToHost) => api.postMessage(m);
const root = document.getElementById('root')!;

const style = document.createElement('style');
style.textContent = `
#root{display:flex;flex-direction:column;font-size:12px}
.info{padding:4px 6px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.filter{margin:0 6px 4px;padding:2px 4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}
.filter.error{border-color:var(--vscode-inputValidation-errorBorder,red)}
.hdr,.row{display:grid;grid-template-columns:var(--cols);align-items:center}
.hdr{font-weight:600;border-bottom:1px solid var(--vscode-panel-border,#444);cursor:pointer;user-select:none;overflow:hidden;border-left:3px solid transparent}
.hdr>div,.row>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scroll{flex:1;overflow:auto;position:relative;outline:none;scrollbar-gutter:stable}
.row{position:absolute;left:0;right:0;height:${ROW_H}px;cursor:default;border-left:3px solid transparent}
.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.empty{padding:8px;color:var(--vscode-descriptionForeground)}`;
document.head.append(style);

const info = Object.assign(document.createElement('div'), { className: 'info' });
const filterInput = Object.assign(document.createElement('input'), { className: 'filter', placeholder: 'filter, e.g. n_spikes > 100 and group == good' });
const header = Object.assign(document.createElement('div'), { className: 'hdr' });
const scroller = Object.assign(document.createElement('div'), { className: 'scroll', tabIndex: 0 });
const spacer = document.createElement('div');
const body = document.createElement('div');
scroller.append(spacer, body);

let columns: string[] = [];
let rows: Cell[][] = [];
let view: Cell[][] = [];
let state: LocalState = {};
let selection: SelectionMsg = { ids: [], colors: [] };
let anchor: number | undefined;
let clicked: number[] | undefined; // what the last click posted; the host's echo of it must not scroll
let debounce: ReturnType<typeof setTimeout> | undefined;

const order = () => view.map((r) => r[0] as number);

function persist(): void {
  api.setState(state);
  post({ type: 'persist', table: { sort: state.sort, filter: state.filter } });
}

/** Re-derive the sorted + filtered rows and tell the host their order (it has no session tag, so after every change). */
function recompute(): void {
  const f = parseFilter(state.filter ?? '', columns);
  filterInput.classList.toggle('error', !f.ok);
  filterInput.title = f.ok ? '' : f.error;
  let out = f.ok && f.test ? rows.filter(f.test) : rows;
  const ci = state.sort ? columns.indexOf(state.sort.column) : -1;
  if (ci >= 0) out = sortRows(out, ci, state.sort!.descending);
  view = out;
  post({ type: 'order', ids: order() });
}

function renderHeader(): void {
  root.style.setProperty('--cols', `repeat(${columns.length}, minmax(48px, 1fr))`);
  header.replaceChildren(
    ...columns.map((c) => {
      const d = document.createElement('div');
      const arrow = state.sort?.column === c ? (state.sort.descending ? '▼ ' : '▲ ') : ''; // before the name so it survives truncation
      d.textContent = arrow + c;
      d.title = c;
      d.onclick = () => {
        state = { ...state, sort: { column: c, descending: state.sort?.column === c ? !state.sort.descending : false } };
        persist();
        recompute();
        renderHeader();
        renderRows();
      };
      return d;
    }),
  );
}

function renderRows(): void {
  spacer.style.height = `${view.length * ROW_H}px`;
  const { start, end } = visibleRange(scroller.scrollTop, scroller.clientHeight, ROW_H, view.length);
  const gi = columns.indexOf('group');
  const els: HTMLElement[] = [];
  for (let i = start; i < end; i++) {
    const r = view[i];
    const id = r[0] as number;
    const el = document.createElement('div');
    el.className = 'row';
    el.style.top = `${i * ROW_H}px`;
    const si = selection.ids.indexOf(id);
    if (si >= 0) {
      el.classList.add('selected');
      el.style.borderLeftColor = selection.colors[si];
    } else {
      el.style.background = groupTint(gi >= 0 ? r[gi] : null);
    }
    el.replaceChildren(
      ...r.map((c) => {
        const d = document.createElement('div');
        d.textContent = formatCell(c);
        return d;
      }),
    );
    el.onclick = (ev) => {
      const res = clickSelect(order(), selection.ids, anchor, id, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey });
      anchor = res.anchor;
      clicked = res.selected;
      post({ type: 'select', ids: res.selected });
    };
    els.push(el);
  }
  body.replaceChildren(...els);
}

function scrollTo(id: number): void {
  const i = order().indexOf(id);
  if (i < 0) return;
  const top = scrollTopFor(i, scroller.scrollTop, scroller.clientHeight, ROW_H);
  if (top !== undefined) scroller.scrollTop = top;
}

/**
 * The header sits outside the scroller, so it follows the rows' horizontal scroll (both have the same 3 px left offset) and
 * gets the scroller's scrollbar width as right padding. (`scrollbar-gutter` on the header would also narrow its content, but
 * Chrome then stops its scroll range one gutter short of the scroller's, shifting the right-hand headers.)
 */
const syncHeader = () => {
  header.style.paddingRight = `${scroller.offsetWidth - scroller.clientWidth}px`;
  header.scrollLeft = scroller.scrollLeft;
};
scroller.addEventListener('scroll', () => {
  syncHeader();
  renderRows();
});
new ResizeObserver(() => {
  syncHeader();
  renderRows();
}).observe(scroller);
scroller.addEventListener('keydown', (ev) => {
  const delta = isPlainArrow(ev);
  if (!delta) return;
  ev.preventDefault();
  const next = stepSelection(order(), selection.ids, delta, ev.shiftKey);
  if (!next) return;
  anchor = ev.shiftKey ? anchor : next[next.length - 1];
  post({ type: 'select', ids: next });
  scrollTo(next[next.length - 1]);
});
filterInput.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state = { ...state, filter: filterInput.value };
    persist();
    recompute();
    renderRows();
  }, 150);
});

window.addEventListener('message', (e: MessageEvent<HostToSidebar>) => {
  const m = e.data;
  if (m.type === 'clusterTable') {
    clearTimeout(debounce); // a pending filter edit belongs to the previous dataset; never persist it over this one
    ({ columns, rows } = m);
    info.textContent = m.info;
    info.title = m.info; // the one-line text truncates in a narrow sidebar
    const local = api.getState();
    state = { ...(local?.key === m.info ? local : m.state), key: m.info };
    api.setState(state);
    filterInput.value = state.filter ?? '';
    root.replaceChildren(info, filterInput, header, scroller);
    recompute();
    renderHeader();
    renderRows();
  } else if (m.type === 'selection') {
    selection = m.selection;
    // Selection steered from outside (Alt+↓/↑, other views) can land off-screen: reveal the newest row. A click's own echo must not move the table.
    const own = clicked && clicked.length === selection.ids.length && clicked.every((v, k) => v === selection.ids[k]);
    clicked = undefined;
    const last = selection.ids.at(-1);
    if (!own && last !== undefined) scrollTo(last);
    renderRows();
  } else {
    clearTimeout(debounce);
    columns = [];
    rows = [];
    view = [];
    const empty = Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Open a phy dataset (Phy: Open Dataset…)' });
    root.replaceChildren(empty);
  }
});
post({ type: 'ready' });
