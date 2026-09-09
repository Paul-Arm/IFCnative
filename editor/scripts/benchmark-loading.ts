import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { parseNativeIfcText } from "../src/ifc/nativeDocument";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node --expose-gc --import tsx scripts/benchmark-loading.ts <file.ifc>");
const readStarted = performance.now();
const bytes = readFileSync(filePath);
const text = new TextDecoder().decode(bytes);
console.log(JSON.stringify({ file: basename(filePath), bytes: bytes.byteLength, readAndDecodeMs: Math.round(performance.now() - readStarted) }));
const samples: number[] = [];
for (let iteration = 0; iteration < 3; iteration++) {
  global.gc?.();
  const started = performance.now();
  const document = parseNativeIfcText(text, basename(filePath));
  const elapsedMs = performance.now() - started;
  samples.push(elapsedMs);
  console.log(JSON.stringify({ iteration: iteration + 1, parseMs: Math.round(elapsedMs), entities: document.entities.length, diagnostics: document.diagnostics.length }));
}
console.log(JSON.stringify({ medianParseMs: Math.round(samples.sort((a,b) => a-b)[1]) }));
