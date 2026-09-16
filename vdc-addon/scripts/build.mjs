import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
const require = createRequire(new URL('../../editor/package.json', import.meta.url));
const { build } = require('esbuild');
const root = new URL('../', import.meta.url);
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/main.ts', root))],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
  minify: true, legalComments: 'inline',
});
const template = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('src/style.css', root), 'utf8');
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
await mkdir(new URL('dist/', root), { recursive: true });
// Function replacements preserve literal $&, $' and $$ from the bundled STEP helpers.
const page = template.replace('/* ADDON_CSS */', () => css).replace('/* ADDON_JS */', () => js);
// Syntax-check the embedded script, including HTML assembly, before delivering it.
const embedded = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
new Script(embedded, { filename: 'vdc-addon/dist/index.html' });
await writeFile(new URL('dist/index.html', root), page);
console.log('WebForm gebaut: vdc-addon/dist/index.html (offline, ohne externe Assets)');
