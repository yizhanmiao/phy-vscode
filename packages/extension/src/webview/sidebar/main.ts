import type { Cell, HostToSidebar, SelectionMsg, SidebarToHost } from '@theia-phy/api';
import { vscodeApi } from '../vscode';

const api = vscodeApi<unknown>();
const post = (m: SidebarToHost) => api.postMessage(m);
const root = document.getElementById('root')!;
root.style.overflow = 'auto';
let columns: string[] = [];
let rows: Cell[][] = [];
let info = '';
let selection: SelectionMsg = { ids: [], colors: [] };

function render(): void {
  if (!columns.length) {
    root.textContent = 'Open a phy dataset (Phy: Open Dataset…)';
    return;
  }
  const head = document.createElement('div');
  head.textContent = info;
  const table = document.createElement('table');
  const hr = table.insertRow();
  for (const c of columns) hr.insertCell().textContent = c;
  for (const r of rows) {
    const id = r[0] as number;
    const tr = table.insertRow();
    const si = selection.ids.indexOf(id);
    if (si >= 0) tr.style.background = 'var(--vscode-list-activeSelectionBackground)';
    for (const c of r) tr.insertCell().textContent = c === null ? '' : String(c);
    tr.onclick = (ev) => post({ type: 'select', ids: ev.ctrlKey || ev.metaKey ? [...selection.ids.filter((x) => x !== id), ...(si >= 0 ? [] : [id])] : [id] });
  }
  root.replaceChildren(head, table);
}

window.addEventListener('message', (e: MessageEvent<HostToSidebar>) => {
  const m = e.data;
  if (m.type === 'clusterTable') ({ columns, rows, info } = m);
  else if (m.type === 'selection') selection = m.selection;
  else columns = [];
  render();
});
post({ type: 'ready' });
