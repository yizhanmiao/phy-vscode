import { build } from 'esbuild';

await build({ entryPoints: ['src/index.ts'], outfile: 'index.js', bundle: true, sourcemap: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], logLevel: 'info' });
