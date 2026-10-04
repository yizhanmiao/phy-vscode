import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cell } from '@phy-vscode/api';

const isMissing = (v: string) => v === '' || /^nan$/i.test(v);

export function parseClusterTable(text: string, sep: string, file: string): { field: string; values: Map<number, Cell> } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = (lines[0] ?? '').split(sep).map((s) => s.trim());
  if (header.length < 2) throw new Error(`${file}: expected a header "cluster_id${sep === '\t' ? '<TAB>' : sep}<field>"`);
  const rows: [number, string][] = lines.slice(1).map((line, k) => {
    const cols = line.split(sep);
    const id = Number(cols[0].trim());
    if (!Number.isInteger(id)) throw new Error(`${file}:${k + 2}: bad cluster id '${cols[0]}'`);
    return [id, (cols[1] ?? '').trim()];
  });
  const numeric = rows.every(([, v]) => isMissing(v) || !Number.isNaN(Number(v)));
  return {
    field: header[1],
    values: new Map(rows.map(([id, v]) => [id, isMissing(v) ? null : numeric ? Number(v) : v])),
  };
}

/** Every cluster_<field>.tsv/.csv in `dir` (phy ignores cluster_info.tsv); unparseable files are skipped and reported. */
export async function readClusterMetadata(
  dir: string,
): Promise<{ metadata: Map<string, Map<number, Cell>>; skipped: { file: string; error: string }[] }> {
  const out = new Map<string, Map<number, Cell>>();
  const skipped: { file: string; error: string }[] = [];
  const names = (await readdir(dir))
    .filter((n) => /^cluster_.+\.(tsv|csv)$/.test(n) && n !== 'cluster_info.tsv')
    .sort();
  for (const name of names) {
    const sep = name.endsWith('.csv') ? ',' : '\t';
    try {
      const { field, values } = parseClusterTable(await readFile(join(dir, name), 'utf8'), sep, name);
      if (!out.has(field)) out.set(field, values);
    } catch (e) {
      skipped.push({ file: name, error: (e as Error).message });
    }
  }
  return { metadata: out, skipped };
}
