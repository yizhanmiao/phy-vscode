import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, external: ['vscode'], logLevel: 'info' };
const web = { bundle: true, platform: 'browser', format: 'iife', target: 'es2022', sourcemap: true, logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs' }),
  build({ ...common, entryPoints: ['src/host/worker.ts'], outfile: 'dist/worker.cjs' }),
  build({ ...web, entryPoints: ['src/webview/plot/main.ts'], outfile: 'dist/webview/plot.js' }),
  build({ ...common, entryPoints: ['test/smoke/index.ts'], outfile: 'dist-test/smoke.cjs' }),
]);
