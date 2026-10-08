import { API_VERSION, type Event, type PhyApi, type PhySession } from '@phy-vscode/api';
import type { ModRegistry } from './modRegistry';

/** The object mods receive: the extension's `exports`, and (scoped) a plugin's `activate` argument. */
export function createPhyApi(mods: ModRegistry, host: { activeSession(): PhySession | undefined; onDidOpenSession: Event<PhySession> }): PhyApi {
  return {
    version: API_VERSION,
    activeSession: () => host.activeSession(),
    onDidOpenSession: host.onDidOpenSession,
    registerView: (def) => mods.registerView(def),
    registerClusterMetric: (def) => mods.registerClusterMetric(def),
    registerHistogram: (def) => mods.registerHistogram(def),
  };
}
