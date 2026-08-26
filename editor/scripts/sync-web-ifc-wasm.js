const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'node_modules', 'web-ifc', 'web-ifc.wasm');
const targetDir = path.join(projectRoot, 'public', 'wasm');
const target = path.join(targetDir, 'web-ifc.wasm');

if (!fs.existsSync(source)) {
  console.warn('[sync-web-ifc-wasm] web-ifc.wasm not found. Run npm install first.');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`[sync-web-ifc-wasm] Copied ${path.relative(projectRoot, target)}`);
