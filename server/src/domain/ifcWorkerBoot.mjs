// Einstieg für den IFC-Worker-Thread (siehe ifcWorkerPool.ts).
//
// Der Server läuft über tsx, aber tsx' Loader-Hooks gelten unter Node 22
// nicht automatisch in Worker-Threads — dort scheiterte der Import des
// Editor-IFC-Codes (extensionslose/Directory-Imports, CommonJS-Teile) mit
// "Directory import ... is not supported". Deshalb registriert dieser
// Bootstrap tsx im Worker selbst (ESM- und CJS-Hooks) und lädt erst dann
// den eigentlichen TypeScript-Worker.
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerEsm();
registerCjs();

await import("./ifcWorker.ts");
