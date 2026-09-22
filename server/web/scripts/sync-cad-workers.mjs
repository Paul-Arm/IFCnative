// Kopiert die Worker des CAD-Viewers (@mlightcad) nach public/cad/, damit
// die DWG/DXF-Vorschau sie lokal zur Paketversion passend findet (kein CDN):
//  - libredwg-parser-worker.js + libredwg-web.wasm (DWG-Parser, GPL — läuft
//    bewusst nur im Worker; die WASM muss neben dem Worker liegen)
//  - mtext-renderer-worker.js (MTEXT-Layout)
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(webRoot, "package.json"));
const targetDir = join(webRoot, "public", "cad");

const files = [
  ["@mlightcad/libredwg-converter", "libredwg-parser-worker.js"],
  ["@mlightcad/libredwg-converter", "libredwg-web.wasm"],
  ["@mlightcad/cad-simple-viewer", "mtext-renderer-worker.js"],
];

await mkdir(targetDir, { recursive: true });
for (const [pkg, file] of files) {
  // require.resolve liefert den CJS-Einstieg in dist/ — dort liegen die Worker.
  const source = join(dirname(require.resolve(pkg)), file);
  await copyFile(source, join(targetDir, file));
}
console.log("CAD-Worker synchronisiert:", targetDir);
