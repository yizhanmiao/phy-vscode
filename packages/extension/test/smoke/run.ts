import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';
import { makeAllFixtures, OUT } from '../fixtures/makeFixture';

makeAllFixtures();
await runTests({
  extensionDevelopmentPath: resolve('.'),
  extensionTestsPath: resolve('dist-test/smoke.cjs'),
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'phy-'))}`],
  extensionTestsEnv: { PHY_FIXTURES: OUT },
});
