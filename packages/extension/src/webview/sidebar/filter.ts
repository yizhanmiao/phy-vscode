import type { Cell } from '@phy-vscode/api';

export type RowTest = (row: Cell[]) => boolean;
export type FilterResult = { ok: true; test: RowTest | null } | { ok: false; error: string };
type Tok = { kind: 'op'; v: string } | { kind: 'word'; v: string; quoted: boolean };

function tokenize(s: string): Tok[] {
  const re = /\s*(?:(==|!=|<=|>=|<|>)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s=!<>"']+))/y;
  const out: Tok[] = [];
  let i = 0;
  while (s.slice(i).trim() !== '') {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`unexpected '${s.slice(i).trim()[0]}'`);
    i = re.lastIndex;
    if (m[1]) out.push({ kind: 'op', v: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ kind: 'word', v: (m[2] ?? m[3]).replace(/\\(.)/g, '$1'), quoted: true });
    else out.push({ kind: 'word', v: m[4], quoted: false });
  }
  return out;
}

function compare(cell: Cell, op: string, value: number | string): boolean {
  if (cell === null) return op === '!=';
  let c: number;
  if (typeof cell === 'number' && typeof value === 'number') c = cell - value;
  else {
    const a = String(cell);
    const b = String(value);
    c = a === b ? 0 : a < b ? -1 : 1;
  }
  switch (op) {
    case '==': return c === 0;
    case '!=': return c !== 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    default: return c >= 0;
  }
}

/** `<column> <op> <value>` terms joined by and/or (and binds tighter). Builds closures; never evaluates code. */
export function parseFilter(text: string, columns: string[]): FilterResult {
  try {
    const toks = tokenize(text);
    if (toks.length === 0) return { ok: true, test: null };
    let i = 0;
    const isKw = (t: Tok | undefined, kw: string) => t?.kind === 'word' && !t.quoted && t.v.toLowerCase() === kw;
    const cmp = (): RowTest => {
      const col = toks[i++];
      const op = toks[i++];
      const val = toks[i++];
      if (col?.kind !== 'word' || col.quoted) throw new Error('expected a column name');
      const ci = columns.indexOf(col.v);
      if (ci < 0) throw new Error(`unknown column '${col.v}'`);
      if (op?.kind !== 'op') throw new Error(`expected == != < <= > >= after '${col.v}'`);
      if (val?.kind !== 'word') throw new Error(`expected a value after '${op.v}'`);
      const value: number | string = !val.quoted && Number.isFinite(Number(val.v)) ? Number(val.v) : val.v;
      return (row) => compare(row[ci], op.v, value);
    };
    const term = (): RowTest => {
      let t = cmp();
      while (isKw(toks[i], 'and')) {
        i++;
        const a = t;
        const b = cmp();
        t = (r) => a(r) && b(r);
      }
      return t;
    };
    let e = term();
    while (isKw(toks[i], 'or')) {
      i++;
      const a = e;
      const b = term();
      e = (r) => a(r) || b(r);
    }
    if (i < toks.length) throw new Error(`unexpected '${toks[i].v}'`);
    return { ok: true, test: e };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
