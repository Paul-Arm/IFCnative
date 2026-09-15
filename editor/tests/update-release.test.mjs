import assert from "node:assert/strict";
import test from "node:test";
import { releaseHistory, releaseManifest } from "../scripts/prepare-update.mjs";

const args = { version: "1.4.12", baseUrl: "https://stifctool.blob.core.windows.net/editor",
  signature: "signature\n", notes: { version: "1.4.12", title: "Neu", publishedAt: "2026-09-15T10:00:00Z", changes: ["Update-Suche"] } };
test("release manifest maps signed installer and patchnotes to the exact Windows version", () => {
  const result = releaseManifest(args);
  assert.equal(result.platforms["windows-x86_64"].url, "https://stifctool.blob.core.windows.net/editor/releases/1.4.12/IFCnative_1.4.12_x64-setup.exe");
  assert.equal(result.platforms["windows-x86_64"].signature, "signature");
  assert.match(result.notes, /Update-Suche/);
});

test("release history includes older notes and excludes prepared future releases", () => {
  const notes = ["1.4.9", "1.4.14", "1.4.15"].map((version) => ({ ...args.notes, version }));
  const history = releaseHistory(notes, "1.4.14", args.baseUrl);
  assert.deepEqual(history.releases.map((item) => item.version), ["1.4.14", "1.4.9"]);
  assert.throws(() => releaseHistory([notes[0], notes[0]], "1.4.14", args.baseUrl));
});
test("release preparation rejects wrong versions, hosts and token-bearing base URLs", () => {
  assert.throws(() => releaseManifest({ ...args, notes: { ...args.notes, version: "1.4.11" } }));
  for (const baseUrl of ["http://stifctool.blob.core.windows.net/editor", "https://example.com/editor", `${args.baseUrl}?sig=secret`]) {
    assert.throws(() => releaseManifest({ ...args, baseUrl }));
  }
});
