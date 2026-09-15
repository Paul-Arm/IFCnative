import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeTelemetryText, telemetryFileNames } from "../src/diagnostics/telemetry-sanitize";
import { createTelemetryTransport } from "../src/diagnostics/telemetry-transport";

test("telemetry removes credentials, local paths and STEP payloads", () => {
  assert.equal(sanitizeTelemetryText("Failed https://blob.example/model?sig=secret"), "Failed [url]");
  assert.equal(sanitizeTelemetryText("password=secret"), "[credential]");
  assert.equal(sanitizeTelemetryText("Authorization: Bearer SECRET"), "[credential]");
  assert.ok(!sanitizeTelemetryText('{"token":"SECRET"}').includes("SECRET"));
  assert.equal(sanitizeTelemetryText("Could not parse #123=IFCWALL('private data')"), "[IFC content removed]");
  assert.equal(sanitizeTelemetryText("Failed C:\\Users\\person\\secret.ifc"), "Failed [path]");
  assert.deepEqual(telemetryFileNames(["C:\\private\\model.ifc", "/private/second.ifc"]), ["model.ifc", "second.ifc"]);
  assert.equal(sanitizeTelemetryText("a".repeat(20_000)).length, 8192);
});

test("offline sends nothing and network failure pauses for a minute", async () => {
  let online = false;
  let calls = 0;
  let clock = 1_000;
  const transport = createTelemetryTransport(() => online, async () => {
    calls += 1;
    throw new Error("Cannot reach server with token=SECRET");
  }, () => clock);
  await assert.rejects(transport.send("https://example.test"), /paused/);
  assert.equal(calls, 0);
  online = true;
  await assert.rejects(transport.send("https://example.test"), /unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(transport.send("https://example.test"), /paused/);
  assert.equal(calls, 1);
  clock += 60_001;
  assert.equal(transport.canSend(), true);
});

test("rate limit is respected and requests exclude browser credentials", async () => {
  let clock = 1_000;
  let options: RequestInit | undefined;
  const transport = createTelemetryTransport(() => true, async (_input, init) => {
    options = init;
    return new Response(null, { status: 429, headers: { "Retry-After": "120" } });
  }, () => clock);
  await transport.send("https://example.test");
  assert.equal(options?.credentials, "omit");
  assert.equal(options?.referrerPolicy, "no-referrer");
  assert.equal(options?.redirect, "error");
  assert.ok(options?.signal);
  clock += 60_001;
  assert.equal(transport.canSend(), false);
  clock += 60_001;
  assert.equal(transport.canSend(), true);
});
