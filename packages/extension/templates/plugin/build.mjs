import { context } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, logLevel: 'info' };

const builds = await Promise.all([
  // Runs in the VS Code extension host: registers the view, metric and histogram.
  context({ ...common, entryPoints: ['src/index.ts'], outfile: 'index.js', platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }),
  // Runs in the Phy plot webview: draws the view. One self-contained file; only its folder is served.
  context({ ...common, entryPoints: ['src/renderer.ts'], outfile: 'renderer.js', platform: 'browser', format: 'esm', target: 'es2022' }),
]);
for (const b of builds) {
  if (watch) await b.watch();
  else {
    await b.rebuild();
    await b.dispose();
  }
}
