import { readFile } from 'node:fs/promises';
import type { NpyDtype } from './npy';

export type PyValue = string | number | boolean | null | PyValue[];

export interface Params {
  datPath: string[];
  nChannelsDat?: number;
  dtype: NpyDtype;
  offset: number;
  sampleRate: number;
  hpFiltered: boolean;
}

/** Parse `name = <literal>` lines (strings incl. r'', numbers, booleans, None, lists/tuples). Never executes code. */
export function parsePythonLiterals(src: string, file = 'params.py'): Record<string, PyValue> {
  let i = 0;
  function fail(msg: string): never {
    throw new Error(`${file}:${src.slice(0, i).split('\n').length}: ${msg}`);
  }
  function at(re: RegExp): RegExpExecArray | null {
    re.lastIndex = i;
    const m = re.exec(src);
    if (m) i += m[0].length;
    return m;
  }
  function skip(newlines: boolean): void {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r' || (newlines && c === '\n')) i++;
      else if (c === '#') while (i < src.length && src[i] !== '\n') i++;
      else return;
    }
  }
  function str(raw: boolean, q: string): string {
    if (src[i] === q && src[i + 1] === q) fail('triple-quoted strings are not supported');
    let out = '';
    for (;;) {
      const c = src[i];
      if (c === undefined || c === '\n') fail('unterminated string');
      i++;
      if (c === q) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const n = src[i++];
      if (n === undefined) fail('unterminated string');
      out += raw ? '\\' + n : ({ n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' } as Record<string, string>)[n] ?? '\\' + n;
    }
  }
  function value(depth: number): PyValue {
    skip(depth > 0);
    const c = src[i];
    if (c === '[' || c === '(') {
      const close = c === '[' ? ']' : ')';
      i++;
      const items: PyValue[] = [];
      for (;;) {
        skip(true);
        if (src[i] === close) {
          i++;
          return items;
        }
        items.push(value(depth + 1));
        skip(true);
        if (src[i] === ',') i++;
        else if (src[i] !== close) fail(`expected ',' or '${close}'`);
      }
    }
    let m = at(/([rRuU]?)(['"])/y);
    if (m) return str(m[1].toLowerCase() === 'r', m[2]);
    if ((m = at(/[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y))) return Number(m[0].replace(/_/g, ''));
    if ((m = at(/(?:True|False|None)\b/y))) return m[0] === 'None' ? null : m[0] === 'True';
    return fail(`unsupported syntax: ${src.slice(i).split('\n')[0]}`);
  }

  const out: Record<string, PyValue> = {};
  for (;;) {
    skip(true);
    if (i >= src.length) return out;
    const name = at(/[A-Za-z_]\w*/y);
    if (!name) fail(`unsupported syntax: ${src.slice(i).split('\n')[0]}`);
    skip(false);
    if (src[i] !== '=' || src[i + 1] === '=') fail(`unsupported syntax: expected '=' after '${name[0]}'`);
    i++;
    out[name[0]] = value(0);
    skip(false);
    if (i < src.length && src[i] !== '\n') fail(`unsupported syntax after '${name[0]}'`);
  }
}

const DTYPES: Record<string, NpyDtype> = {
  int8: 'i1', int16: 'i2', int32: 'i4', int64: 'i8', uint8: 'u1', uint16: 'u2',
  uint32: 'u4', uint64: 'u8', float32: 'f4', float64: 'f8',
};

export function toParams(v: Record<string, PyValue>, file = 'params.py'): Params {
  const num = (k: string, fallback?: number): number => {
    const x = v[k] ?? fallback;
    if (typeof x !== 'number') throw new Error(`${file}: '${k}' must be a number`);
    return x;
  };
  const dp = v.dat_path ?? [];
  const datPath = (Array.isArray(dp) ? dp : [dp])
    .map((p) => {
      if (typeof p !== 'string') throw new Error(`${file}: 'dat_path' must be a string or a list of strings`);
      return p;
    })
    .filter((p) => p !== '');
  const dt = v.dtype ?? 'int16';
  const dtype =
    typeof dt === 'string'
      ? DTYPES[dt] ?? (/^[<|=]?(i[1248]|u[1248]|f[48])$/.exec(dt)?.[1] as NpyDtype | undefined)
      : undefined;
  if (!dtype) throw new Error(`${file}: unsupported dtype ${JSON.stringify(dt)}`);
  return {
    datPath,
    nChannelsDat: v.n_channels_dat === undefined ? undefined : num('n_channels_dat'),
    dtype,
    offset: num('offset', 0),
    sampleRate: num('sample_rate'),
    hpFiltered: v.hp_filtered === true,
  };
}

export async function readParams(path: string): Promise<Params> {
  return toParams(parsePythonLiterals(await readFile(path, 'utf8'), path), path);
}
