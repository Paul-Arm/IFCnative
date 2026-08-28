// Copies the generated Nuxt SPA (web/.output/public) into server/public,
// which the Fastify server serves at "/". Run via `npm run build:web`.
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "web", ".output", "public");
const dest = join(root, "public");

try {
  await stat(join(src, "index.html"));
} catch {
  console.error(`No build found at ${src} — run \`npm run generate\` in web/ first.`);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Web UI synced: ${src} -> ${dest}`);
