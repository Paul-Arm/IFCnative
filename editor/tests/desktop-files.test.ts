import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { pickDesktopIfcAssets, readDesktopIfcAsset } from "../src/desktop/startupIfc";
import { mergeRecentIfcFile } from "../src/components/ifc-workspace/workspaceStorage";

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
afterEach(() => clearMocks());

test("native reopening upgrades old pathless records without removing same-named files elsewhere", () => {
  const old = { id: "old", name: "Model.ifc", openedAt: "2026-09-15T10:00:00Z", source: "opened" as const };
  const other = { ...old, id: "other", path: "C:\\Other\\Model.ifc" };
  const current = { ...old, id: "current", path: "C:\\Project\\Model.ifc" };
  assert.deepEqual(mergeRecentIfcFile([old, other], current), [current, other]);
});

test("native picker retains a Unicode Windows path and recent reopen only reads the file", async () => {
  const path = "C:\\Modelle\\Gebäude Süd.ifc";
  const calls: string[] = [];
  mockIPC((command, args) => {
    calls.push(command);
    if (command === "pick_ifc_files") {
      assert.equal((args as { multiple: boolean }).multiple, false);
      return [path];
    }
    assert.equal(command, "read_ifc_file");
    assert.equal((args as { path: string }).path, path);
    return Array.from(new TextEncoder().encode("ISO-10303-21;"));
  });
  const [asset] = await pickDesktopIfcAssets(false);
  assert.equal(asset.path, path);
  assert.equal((asset.file as File & { path: string }).path, path);
  assert.equal(asset.file.name, "Gebäude Süd.ifc");
  assert.equal(await asset.file.text(), "ISO-10303-21;");
  calls.length = 0;
  await readDesktopIfcAsset(asset.path);
  assert.deepEqual(calls, ["read_ifc_file"]);
});

test("cancelling native picker reads no files", async () => {
  mockIPC((command) => { assert.equal(command, "pick_ifc_files"); return []; });
  assert.deepEqual(await pickDesktopIfcAssets(true), []);
});

test("missing recent file reports failure without opening a picker", async () => {
  mockIPC((command) => { assert.equal(command, "read_ifc_file"); throw new Error("Datei nicht gefunden"); });
  await assert.rejects(readDesktopIfcAsset("C:\\missing.ifc"), /nicht gefunden/);
});
