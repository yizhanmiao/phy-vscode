import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { API_VERSION, satisfiesApi, type Disposable, type PhyApi } from '@phy-vscode/api';

export type PluginLog = (message: string) => void;

/** What a plugin file exports. */
export interface PluginModule {
  /** Caret or exact range of `@phy-vscode/api` this plugin was written for, e.g. `^0.2.0`. Checked at load. */
  apiVersion?: string;
  activate(api: PhyApi): unknown;
  deactivate?(): unknown;
}
export interface DiscoveredPlugin {
  file: string;
  /** What reloading clears from the module cache: the file itself, or a folder plugin's whole folder. */
  scope: string;
}
export interface PluginLoader {
  load(file: string): unknown;
  /** Forget the modules at (or under) these paths, so the next `load` re-reads them. */
  unload(scopes: readonly string[]): void;
}
export interface LoadReport {
  loaded: number;
  problems: string[];
}

/** Node's `require`, with the module cache cleared only under a plugin's own scope. */
export function requireLoader(req: NodeJS.Require): PluginLoader {
  return {
    load: (file) => req(file),
    unload(scopes) {
      for (const key of Object.keys(req.cache)) if (scopes.some((s) => key === s || key.startsWith(s + sep))) delete req.cache[key];
    },
  };
}

/** `<home>/.phy-vscode/plugins`, then the `phyVscode.pluginPaths` entries that are absolute or start with `~/`. */
export function pluginRoots(setting: unknown, home: string, log: PluginLog): string[] {
  const roots = [join(home, '.phy-vscode', 'plugins')];
  for (const p of Array.isArray(setting) ? setting : []) {
    if (typeof p !== 'string' || !p.trim()) continue;
    const full = p === '~' || p.startsWith('~/') ? join(home, p.slice(1)) : p;
    if (!isAbsolute(full)) {
      log(`phyVscode.pluginPaths: '${p}' ignored, plugin paths must be absolute or start with ~/`);
      continue;
    }
    roots.push(resolve(full));
  }
  return [...new Set(roots)];
}

/**
 * A root that is a file is one plugin. A root that is a folder contributes its top-level `*.js` files and each subfolder that has an
 * `index.js`; dot-entries and `node_modules` are skipped. Plugins are never looked for inside dataset folders.
 * Paths are returned as real paths, because Node's module cache is keyed by them (on macOS `/var` is a symlink to `/private/var`).
 */
export function discoverPlugins(roots: readonly string[], log: PluginLog): DiscoveredPlugin[] {
  const found: DiscoveredPlugin[] = [];
  for (const root of roots) {
    try {
      const st = statSync(root, { throwIfNoEntry: false });
      if (!st) {
        log(`plugin path not found: ${root}`);
        continue;
      }
      if (st.isFile()) {
        const file = realpathSync(root);
        found.push({ file, scope: file });
        continue;
      }
      for (const name of readdirSync(root).sort()) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const p = join(root, name);
        try {
          const e = statSync(p, { throwIfNoEntry: false });
          if (e?.isFile() && name.endsWith('.js')) {
            const file = realpathSync(p);
            found.push({ file, scope: file });
          } else if (e?.isDirectory() && existsSync(join(p, 'index.js'))) found.push({ file: realpathSync(join(p, 'index.js')), scope: realpathSync(p) });
        } catch (err) {
          log(`plugin path unreadable: ${p}: ${text(err)}`);
        }
      }
    } catch (err) {
      log(`plugin path unreadable: ${root}: ${text(err)}`);
    }
  }
  return found;
}

export interface PluginHostDeps {
  api: PhyApi;
  loader: PluginLoader;
  roots(): string[];
  log: PluginLog;
  /** Defer the registry's change events until the returned function is called, so a reload refreshes webviews once. */
  hold(): () => void;
}

const isDisposable = (x: unknown): x is Disposable => typeof (x as Disposable | undefined)?.dispose === 'function';
const tryDispose = (d: Disposable): void => {
  try {
    d.dispose();
  } catch {
    // a failing dispose must not stop the rest being undone
  }
};
const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A copy of `api` that remembers everything a plugin registers, so it can be undone. */
function scoped(api: PhyApi, subs: Disposable[]): PhyApi {
  const track = (d: Disposable): Disposable => (subs.push(d), d);
  return {
    ...api,
    onDidOpenSession: (l) => track(api.onDidOpenSession(l)),
    registerView: (d) => track(api.registerView(d)),
    registerClusterMetric: (d) => track(api.registerClusterMetric(d)),
    registerHistogram: (d) => track(api.registerHistogram(d)),
  };
}

export class PluginHost {
  private active: { file: string; scope: string; plugin: PluginModule; subs: Disposable[] }[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PluginHostDeps) {}

  load(): Promise<LoadReport> {
    return this.enqueue(() => this.loadNow());
  }

  /** Unload every plugin, forget its modules, load again. The registry emits one merged change event. */
  reload(): Promise<LoadReport> {
    return this.enqueue(async () => {
      const release = this.deps.hold();
      try {
        await this.unloadNow();
        return await this.loadNow();
      } finally {
        release();
      }
    });
  }

  // ponytail: fire-and-forget, so deactivate() may still be running when the extension host shuts down; return the promise if that matters.
  dispose(): void {
    void this.enqueue(() => this.unloadNow());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ponytail: an activate() that never settles stalls loading; add a timeout if a plugin ever does.
  private async loadNow(): Promise<LoadReport> {
    const { loader, log } = this.deps;
    const problems: string[] = [];
    const fail = (m: string) => {
      problems.push(m);
      log(m);
    };
    let loaded = 0;
    for (const { file, scope } of discoverPlugins(this.deps.roots(), log)) {
      const subs: Disposable[] = [];
      try {
        const exported = loader.load(file) as ({ default?: unknown } & Partial<PluginModule>) | undefined;
        const plugin = (typeof exported?.activate === 'function' ? exported : exported?.default) as Partial<PluginModule> | undefined;
        if (typeof plugin?.activate !== 'function') {
          log(`${file}: no activate() export, skipped`);
          loader.unload([scope]);
          continue;
        }
        if (plugin.apiVersion !== undefined && !satisfiesApi(plugin.apiVersion)) {
          fail(`${file}: needs API ${plugin.apiVersion}, this phy-vscode has ${API_VERSION}`);
          loader.unload([scope]);
          continue;
        }
        const returned = await plugin.activate(scoped(this.deps.api, subs));
        if (isDisposable(returned)) subs.push(returned);
        this.active.push({ file, scope, plugin: plugin as PluginModule, subs });
        loaded++;
        log(`${file}: loaded`);
      } catch (e) {
        for (const s of subs.reverse()) tryDispose(s);
        loader.unload([scope]); // a module that loaded but failed to activate is cached; forget it so a fixed file is re-read on reload
        fail(`${file}: ${text(e)}`);
      }
    }
    return { loaded, problems };
  }

  private async unloadNow(): Promise<void> {
    const { log, loader } = this.deps;
    const active = this.active.reverse();
    this.active = [];
    for (const { file, plugin, subs } of active) {
      try {
        await plugin.deactivate?.();
      } catch (e) {
        log(`${file}: deactivate failed: ${text(e)}`);
      }
      for (const s of subs.reverse()) tryDispose(s);
    }
    loader.unload(active.map((a) => a.scope));
  }
}
