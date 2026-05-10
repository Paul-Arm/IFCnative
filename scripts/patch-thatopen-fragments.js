const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'node_modules', '@thatopen', 'fragments', 'package.json');
const target = path.join(projectRoot, 'node_modules', '@thatopen', 'fragments', 'dist', 'index.mjs');
const workerSource = path.join(projectRoot, 'node_modules', '@thatopen', 'fragments', 'dist', 'Worker', 'worker.mjs');
const workerTargetDir = path.join(projectRoot, 'public', 'fragments');
const workerTarget = path.join(workerTargetDir, 'worker.mjs');

if (!fs.existsSync(packageJsonPath) || !fs.existsSync(target) || !fs.existsSync(workerSource)) {
  console.warn('[patch-thatopen-fragments] @thatopen/fragments not found. Run npm install first.');
  process.exit(0);
}

fs.mkdirSync(workerTargetDir, { recursive: true });
fs.copyFileSync(workerSource, workerTarget);
console.log('[patch-thatopen-fragments] Copied fragments worker to public/fragments/worker.mjs.');

JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
let source = fs.readFileSync(target, 'utf8');
const from = 'const url = workerURL ?? new URL("./Worker/worker.mjs", import.meta.url).href;';
const to = 'const url = workerURL ?? "/fragments/worker.mjs";';
const oldCdnFallback = /const url = workerURL \?\? "https:\/\/unpkg\.com\/@thatopen\/fragments@[^"]+\/dist\/Worker\/worker\.mjs";/;
const getWorkerFrom = 'const url = `https://unpkg.com/@thatopen/fragments@${"3.4.5"}/dist/worker/worker.mjs`;';
const getWorkerTo = 'const url = "/fragments/worker.mjs";';

let changed = false;
if (source.includes(from)) {
  source = source.replace(from, to);
  changed = true;
} else if (oldCdnFallback.test(source)) {
  source = source.replace(oldCdnFallback, to);
  changed = true;
} else if (!source.includes(to)) {
  console.warn('[patch-thatopen-fragments] Expected import.meta fallback was not found.');
}

if (source.includes(getWorkerFrom)) {
  source = source.replace(getWorkerFrom, getWorkerTo);
  changed = true;
} else if (!source.includes(getWorkerTo)) {
  console.warn('[patch-thatopen-fragments] Expected getWorker CDN URL was not found.');
}

if (changed) {
  fs.writeFileSync(target, source);
  console.log('[patch-thatopen-fragments] Patched @thatopen/fragments worker URLs for web builds.');
} else {
  console.log('[patch-thatopen-fragments] Already patched @thatopen/fragments worker URLs.');
}
