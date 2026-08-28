// Kopiert den Fragments-Worker aus dem installierten Paket nach
// public/fragments/, damit FragmentsManager.init("/fragments/worker.mjs")
// den zur Paketversion passenden Worker lokal findet (kein CDN).
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(webRoot, "package.json"));
const source = join(
  dirname(require.resolve("@thatopen/fragments")),
  "Worker",
  "worker.mjs",
);
const targetDir = join(webRoot, "public", "fragments");
await mkdir(targetDir, { recursive: true });
await copyFile(source, join(targetDir, "worker.mjs"));
console.log("Fragments-Worker synchronisiert:", join(targetDir, "worker.mjs"));
