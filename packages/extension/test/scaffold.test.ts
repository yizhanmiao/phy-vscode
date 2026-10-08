import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_VERSION, type PhySession } from '@phy-vscode/api';
import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/host/emitter';
import { ModRegistry } from '../src/host/modRegistry';
import { createPhyApi } from '../src/host/phyApi';
import { PluginHost, requireLoader } from '../src/host/plugins';
import { scaffoldPlugin } from '../src/host/scaffold';

const templateDir = fileURLToPath(new URL('../templates/plugin', import.meta.url));
const apiSrcDir = fileURLToPath(new URL('../../api/src', import.meta.url));
const repoModules = fileURLToPath(new URL('../../../node_modules', import.meta.url));
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'phy-scaffold-'))); // real path: plugins report real paths

describe('scaffoldPlugin', () => {
  it('rejects a bad name and a non-empty target', () => {
    const base = tmp();
    expect(() => scaffoldPlugin({ templateDir, apiSrcDir, target: join(base, 'x'), name: 'Bad Name' })).toThrow(/plugin name must match/);
    mkdirSync(join(base, 'full'));
    writeFileSync(join(base, 'full', 'f.txt'), 'x');
    expect(() => scaffoldPlugin({ templateDir, apiSrcDir, target: join(base, 'full'), name: 'ok' })).toThrow(/not empty/);
  });

  it('writes a plugin that typechecks, builds, and loads against the real API', { timeout: 120_000 }, async () => {
    const parent = tmp();
    const target = join(parent, 'my-plugin');
    const files = scaffoldPlugin({ templateDir, apiSrcDir, target, name: 'my-plugin' });
    const rel = files.map((f) => relative(target, f));
    expect(rel).toEqual(expect.arrayContaining(['package.json', 'build.mjs', 'tsconfig.json', join('src', 'index.ts'), join('src', 'renderer.ts'), join('api', 'index.ts')]));
    expect(readFileSync(join(target, 'package.json'), 'utf8')).toContain('"name": "my-plugin"');
    expect(files.some((f) => readFileSync(f, 'utf8').includes('__NAME__'))).toBe(false);

    symlinkSync(repoModules, join(target, 'node_modules')); // stands in for `npm install`
    execFileSync(join(target, 'node_modules', '.bin', 'tsc'), ['-p', target], { stdio: 'pipe' }); // throws, with the diagnostics, on a type error
    execFileSync(process.execPath, ['build.mjs'], { cwd: target, stdio: 'pipe' });
    expect(readFileSync(join(target, 'renderer.js'), 'utf8')).toMatch(/export\s*\{/);

    const mods = new ModRegistry();
    const api = createPhyApi(mods, { activeSession: () => undefined, onDidOpenSession: new Emitter<PhySession>().event });
    const host = new PluginHost({ api, loader: requireLoader(createRequire(import.meta.url)), roots: () => [parent], log: vi.fn(), hold: () => mods.hold() });
    expect(await host.load()).toEqual({ loaded: 1, problems: [] });
    expect(mods.metrics().map((m) => m.id)).toEqual(['spike_share']);
    expect(mods.histograms().map((h) => h.id)).toContain('spikes_over_time');
    const v = mods.view('spike_counts')!;
    expect(dirname(v.rendererScript!.fsPath)).toBe(target);
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toContain(API_VERSION);
    host.dispose();
  });
});
