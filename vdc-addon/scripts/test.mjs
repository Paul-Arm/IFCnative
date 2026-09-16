import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, unlink } from 'node:fs/promises';
const require = createRequire(new URL('../../editor/package.json', import.meta.url));
const output = fileURLToPath(new URL('../dist/addon.test.cjs', import.meta.url));
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
// Bundle like production: the legacy editor uses CJS package semantics, the add-on ESM.
await require('esbuild').build({ entryPoints: [fileURLToPath(new URL('../tests/addon.test.ts', import.meta.url))], outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
const result = spawnSync(process.execPath, ['--test', output], { stdio: 'inherit' });
await unlink(output);
process.exit(result.status ?? 1);
