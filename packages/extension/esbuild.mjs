import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, external: ['vscode'], logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['src/host/worker.ts'], outfile: 'dist/worker.cjs' }),
]);
