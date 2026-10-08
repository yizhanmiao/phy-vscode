import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { API_VERSION, satisfiesApi, type Disposable, type PhyApi, type PhySession } from '@phy-vscode/api';

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
  const seen = new Set<string>();
  const add = (file: string, scope: string) => {
    if (!seen.has(file)) found.push({ file, scope });
    seen.add(file);
  };
  for (const root of roots) {
    try {
      const st = statSync(root, { throwIfNoEntry: false });
      if (!st) {
        log(`plugin path not found: ${root}`);
        continue;
      }
      if (st.isFile()) {
        const file = realpathSync(root);
        add(file, file);
        continue;
      }
      for (const name of readdirSync(root).sort()) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const p = join(root, name);
        try {
          const e = statSync(p, { throwIfNoEntry: false });
          if (e?.isFile() && name.endsWith('.js')) {
            const file = realpathSync(p);
            add(file, file);
          } else if (e?.isDirectory() && existsSync(join(p, 'index.js'))) add(realpathSync(join(p, 'index.js')), realpathSync(p));
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
const text = (e: unknown): string => {
  try {
    return e instanceof Error ? e.message : String(e);
  } catch {
    return 'non-printable error'; // e.g. a thrown Object.create(null)
  }
};

/**
 * A copy of `api` that remembers everything a plugin registers or subscribes to, so it can be undone, and that stops working
 * (throws) once closed, so a timer or callback that outlives its plugin cannot register into a registry nobody cleans up.
 * Sessions the plugin gets from `activeSession()` or `onDidOpenSession` are wrapped so their events are tracked too.
 * ponytail: a session reaching plugin code through a view provider's or metric's `ctx.session` is the raw session, so listeners
 * added there are not tracked; wrap ctx.session as well if plugins start doing that.
 */
function scoped(api: PhyApi, subs: Disposable[]): { api: PhyApi; close(): void } {
  let closed = false;
  const guard = () => {
    if (closed) throw new Error('plugin unloaded');
  };
  const track = (d: Disposable): Disposable => (subs.push(d), d);
  const wrappers = new WeakMap<PhySession, PhySession>();
  const wrap = (session: PhySession): PhySession => {
    let w = wrappers.get(session);
    if (!w) {
      w = {
        get dataset() {
          return session.dataset;
        },
        get clusters() {
          return session.clusters;
        },
        get selection() {
          return session.selection;
        },
        select: (ids) => session.select(ids),
        spikesOf: (id) => session.spikesOf(id),
        colorOf: (id) => session.colorOf(id),
        onDidChangeSelection: (l) => (guard(), track(session.onDidChangeSelection(l))),
        onDidChangeClusters: (l) => (guard(), track(session.onDidChangeClusters(l))),
      };
      wrappers.set(session, w);
    }
    return w;
  };
  return {
    api: {
      ...api,
      activeSession: () => {
        const s = api.activeSession();
        return s && wrap(s);
      },
      onDidOpenSession: (l) => (guard(), track(api.onDidOpenSession((s) => l(wrap(s))))),
      registerView: (d) => (guard(), track(api.registerView(d))),
      registerClusterMetric: (d) => (guard(), track(api.registerClusterMetric(d))),
      registerHistogram: (d) => (guard(), track(api.registerHistogram(d))),
    },
    close: () => {
      closed = true;
    },
  };
}

export class PluginHost {
  private active: { file: string; scope: string; plugin: PluginModule; subs: Disposable[]; close(): void }[] = [];
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
      const { api, close } = scoped(this.deps.api, subs);
      try {
        const exported = loader.load(file) as ({ default?: unknown } & Partial<PluginModule>) | undefined;
        const plugin = (typeof exported?.activate === 'function' ? exported : exported?.default) as Partial<PluginModule> | undefined;
        if (typeof plugin?.activate !== 'function') {
          log(`${file}: no activate() export, skipped`);
          close();
          loader.unload([scope]);
          continue;
        }
        if (plugin.apiVersion !== undefined && !satisfiesApi(plugin.apiVersion)) {
          fail(`${file}: needs API ${plugin.apiVersion}, this phy-vscode has ${API_VERSION}`);
          close();
          loader.unload([scope]);
          continue;
        }
        const returned = await plugin.activate(api);
        if (isDisposable(returned)) subs.push(returned);
        this.active.push({ file, scope, plugin: plugin as PluginModule, subs, close });
        loaded++;
        log(`${file}: loaded`);
      } catch (e) {
        close();
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
    for (const { file, plugin, subs, close } of active) {
      try {
        await plugin.deactivate?.();
      } catch (e) {
        log(`${file}: deactivate failed: ${text(e)}`);
      }
      close();
      for (const s of subs.reverse()) tryDispose(s);
    }
    loader.unload(active.map((a) => a.scope));
  }
}
