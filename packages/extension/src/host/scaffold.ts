import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLUGIN_NAME = /^[a-z][a-z0-9-]{0,40}$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Copy the plugin template to `target` (which must not exist or be empty), fill in `__NAME__`, and add the API sources as `api/`
 * (they are plain TypeScript, so the plugin type-checks and bundles against them with no published package). Returns the files created.
 */
export function scaffoldPlugin(o: { templateDir: string; apiSrcDir: string; target: string; name: string }): string[] {
  if (!PLUGIN_NAME.test(o.name)) throw new Error(`plugin name must match ${PLUGIN_NAME}`);
  if (existsSync(o.target) && readdirSync(o.target).length) throw new Error(`${o.target} already exists and is not empty`);
  mkdirSync(o.target, { recursive: true });
  cpSync(o.templateDir, o.target, { recursive: true });
  const files = walk(o.target);
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    if (s.includes('__NAME__')) writeFileSync(f, s.replaceAll('__NAME__', o.name));
  }
  cpSync(o.apiSrcDir, join(o.target, 'api'), { recursive: true });
  return [...files, ...walk(join(o.target, 'api'))];
}
