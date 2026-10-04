import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, external: ['vscode'], logLevel: 'info' };
// dockview's default ESM entry ships no CSS; its UMD build injects the stylesheet at load (CSP allows inline styles).
const web = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  alias: { 'dockview-core': 'dockview-core/dist/dockview-core.js' },
};

await Promise.all([
  build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs' }),
  build({ ...common, entryPoints: ['src/host/worker.ts'], outfile: 'dist/worker.cjs' }),
  build({ ...web, entryPoints: ['src/webview/plot/main.ts'], outfile: 'dist/webview/plot.js' }),
  build({ ...web, entryPoints: ['src/webview/sidebar/main.ts'], outfile: 'dist/webview/sidebar.js' }),
  build({ ...common, entryPoints: ['test/smoke/index.ts'], outfile: 'dist-test/smoke.cjs' }),
]);
