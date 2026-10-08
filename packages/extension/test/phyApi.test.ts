import { API_VERSION, type PhySession } from '@phy-vscode/api';
import { expect, it } from 'vitest';
import { Emitter } from '../src/host/emitter';
import { ModRegistry } from '../src/host/modRegistry';
import { createPhyApi } from '../src/host/phyApi';

it('forwards registrations to the registry and exposes the API version', () => {
  const mods = new ModRegistry();
  const opened = new Emitter<PhySession>();
  const api = createPhyApi(mods, { activeSession: () => undefined, onDidOpenSession: opened.event });
  expect(api.version).toBe(API_VERSION);
  expect(api.activeSession()).toBeUndefined();
  const d = api.registerClusterMetric({ id: 'm', label: 'm', compute: () => 1 });
  expect(mods.metrics().map((m) => m.id)).toEqual(['m']);
  d.dispose();
  expect(mods.metrics()).toEqual([]);
  const seen: PhySession[] = [];
  api.onDidOpenSession((s) => seen.push(s));
  opened.fire('S' as never);
  expect(seen).toEqual(['S']);
});
