import assert from "node:assert/strict";
import test from "node:test";
import {
    CHECK_ERROR_MESSAGES,
    CHECK_INTERVAL_MS,
    SNOOZE_MS,
    UPDATE_STORAGE_KEY,
    UpdateController,
    checkErrorMessage,
    notificationVisible,
    parsePatchnotes,
    readPreferences,
    type UpdateBackend,
} from "../src/updates/controller";

function setup(overrides: Partial<UpdateBackend> = {}) {
  let now = Date.parse("2026-09-15T10:00:00Z");
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const calls: string[] = [];
  const backend: UpdateBackend = {
    status: async () => ({
      currentVersion: "1.4.12",
      configured: true,
      desktop: true,
    }),
    check: async () => {
      calls.push("check");
      return { version: "1.4.13", notes: "Neu" };
    },
    download: async (_version, progress) => {
      calls.push("download");
      progress({ downloaded: 10, total: 10 });
    },
    install: async () => {
      calls.push("install");
    },
    patchnotes: async (version) => ({
      version,
      title: "Neu",
      publishedAt: "2026-09-15T10:00:00Z",
      changes: ["Änderung"],
    }),
    ...overrides,
  };
  const clock = () => now;
  const controller = new UpdateController(backend, storage, clock);
  return {
    controller,
    backend,
    storage,
    calls,
    data,
    clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("automatic checks are throttled and never download or install", async () => {
  const s = setup();
  await s.controller.tick();
  await s.controller.tick();
  assert.deepEqual(s.calls, ["check"]);
  s.advance(CHECK_INTERVAL_MS);
  await s.controller.tick();
  assert.deepEqual(s.calls, ["check", "check"]);
  assert.equal(notificationVisible(s.controller.getSnapshot()), true);
});
test("seven-day dismissal survives restart and newer releases, then expires", async () => {
  const s = setup();
  await s.controller.check();
  s.controller.snooze();
  const restarted = new UpdateController(s.backend, s.storage, s.clock);
  await restarted.check();
  assert.equal(notificationVisible(restarted.getSnapshot()), false);
  s.advance(SNOOZE_MS - 1);
  await restarted.tick();
  assert.equal(notificationVisible(restarted.getSnapshot()), false);
  s.advance(1);
  await restarted.tick();
  assert.equal(notificationVisible(restarted.getSnapshot()), true);
});
test("disabling automatic checks persists but manual checks still work", async () => {
  const s = setup();
  s.controller.setAutomatic(false);
  await s.controller.tick();
  assert.equal(s.calls.length, 0);
  const restarted = new UpdateController(s.backend, s.storage, s.clock);
  await restarted.check();
  assert.equal(s.calls.length, 1);
  assert.equal(notificationVisible(restarted.getSnapshot()), false);
});
test("duplicate concurrent checks are coalesced", async () => {
  const s = setup();
  await Promise.all([
    s.controller.check(),
    s.controller.check(),
    s.controller.tick(),
  ]);
  assert.deepEqual(s.calls, ["check"]);
});
test("network errors are quiet, hide credentials, and allow retry", async () => {
  let fail = true;
  const s = setup({
    check: async () => {
      if (fail) throw new Error("https://blob/?sig=secret");
      return null;
    },
  });
  await s.controller.tick();
  assert.equal(notificationVisible(s.controller.getSnapshot()), false);
  assert.ok(!s.controller.getSnapshot().error?.includes("secret"));
  fail = false;
  await s.controller.check();
  assert.equal(s.controller.getSnapshot().phase, "current");
});
test("background failures keep a known update and surface only as a hint; manual failures show the error", async () => {
  let fail = false;
  const s = setup({
    check: async () => {
      if (fail) throw { kind: "offline" };
      return { version: "1.4.13", notes: "" };
    },
  });
  await s.controller.tick();
  fail = true;
  s.advance(CHECK_INTERVAL_MS);
  await s.controller.tick();
  let snap = s.controller.getSnapshot();
  assert.equal(snap.phase, "available");
  assert.equal(snap.error, null);
  assert.equal(snap.lastCheckError, CHECK_ERROR_MESSAGES.offline);
  assert.equal(notificationVisible(snap), true);
  await s.controller.check();
  snap = s.controller.getSnapshot();
  assert.equal(snap.phase, "error");
  assert.equal(snap.error, CHECK_ERROR_MESSAGES.offline);
  assert.equal(snap.lastCheckError, null);
  fail = false;
  await s.controller.check();
  assert.equal(s.controller.getSnapshot().lastCheckError, null);
});
test("error kinds map to texts and unknown errors fall back without leaking", () => {
  assert.equal(
    checkErrorMessage({ kind: "denied" }),
    CHECK_ERROR_MESSAGES.denied,
  );
  for (const error of [
    new Error("sig=secret"),
    { kind: "sig=secret" },
    "sig=secret",
    null,
  ]) {
    assert.ok(!checkErrorMessage(error).includes("secret"));
  }
});
test("before-install hook runs after the final guard and cannot block the installer", async () => {
  const s = setup();
  s.controller.setBeforeInstall(async () => {
    s.calls.push("flush");
    throw new Error("idb");
  });
  await s.controller.check();
  await s.controller.install();
  assert.deepEqual(s.calls, ["check", "download", "flush", "install"]);
  const blocked = setup();
  blocked.controller.setBeforeInstall(() => {
    blocked.calls.push("flush");
  });
  blocked.controller.setInstallGuard(() => false);
  await blocked.controller.check();
  await blocked.controller.install();
  assert.deepEqual(blocked.calls, ["check"]);
});
for (const rejectFlush of [false, true]) {
  test(`changes during ${rejectFlush ? "failed" : "successful"} recovery cleanup block installation and retain the verified download`, async () => {
    let clean = true;
    let markFlushStarted!: () => void;
    let finishFlush!: () => void;
    const flushStarted = new Promise<void>((resolve) => {
      markFlushStarted = resolve;
    });
    const flushPending = new Promise<void>((resolve) => {
      finishFlush = resolve;
    });
    const s = setup();
    s.controller.setInstallGuard(() => clean);
    s.controller.setBeforeInstall(async () => {
      s.calls.push("flush");
      markFlushStarted();
      await flushPending;
      if (rejectFlush) throw new Error("IndexedDB unavailable");
    });
    await s.controller.check();
    const installation = s.controller.install();
    await flushStarted;
    clean = false;
    finishFlush();
    await installation;

    assert.deepEqual(s.calls, ["check", "download", "flush"]);
    assert.equal(s.controller.getSnapshot().phase, "ready");
    assert.match(s.controller.getSnapshot().error ?? "", /speichern/);
    await s.controller.install();
    assert.deepEqual(s.calls, ["check", "download", "flush"]);

    clean = true;
    await s.controller.install();
    assert.deepEqual(s.calls, ["check", "download", "flush", "flush", "install"]);
    assert.equal(s.controller.getSnapshot().error, null);
  });
}

test("no requests for browser or unconfigured desktop", async () => {
  for (const status of [
    { desktop: false, configured: false },
    { desktop: true, configured: false },
  ]) {
    const s = setup({
      status: async () => ({ ...status, currentVersion: "1.4.12" }),
    });
    await s.controller.tick();
    await s.controller.check();
    await s.controller.install();
    assert.deepEqual(s.calls, []);
  }
});
test("installation requires a click and blocks unsaved documents", async () => {
  const s = setup();
  await s.controller.check();
  s.controller.setInstallGuard(() => false);
  await s.controller.install();
  assert.deepEqual(s.calls, ["check"]);
  s.controller.setInstallGuard(() => true);
  await s.controller.install();
  assert.deepEqual(s.calls, ["check", "download", "install"]);
});
test("edits during download stop exit; saved documents resume verified download", async () => {
  let clean = true;
  const s = setup({
    download: async () => {
      s.calls.push("download");
      clean = false;
    },
  });
  s.controller.setInstallGuard(() => clean);
  await s.controller.check();
  await s.controller.install();
  assert.equal(s.controller.getSnapshot().phase, "ready");
  assert.deepEqual(s.calls, ["check", "download"]);
  await s.controller.check();
  assert.deepEqual(s.calls, ["check", "download"]);
  clean = true;
  await s.controller.install();
  assert.deepEqual(s.calls, ["check", "download", "install"]);
});
test("a failed signature/download never reaches install and may be retried", async () => {
  let fail = true;
  const s = setup({
    download: async () => {
      if (fail) throw new Error("bad signature");
    },
  });
  await s.controller.check();
  await s.controller.install();
  assert.equal(s.controller.getSnapshot().phase, "error");
  assert.ok(!s.calls.includes("install"));
  fail = false;
  await s.controller.install();
  assert.ok(s.calls.includes("install"));
});
test("malformed preferences and unavailable storage don't break update checks", async () => {
  const s = setup();
  s.data.set(UPDATE_STORAGE_KEY, "not json");
  assert.deepEqual(readPreferences(s.storage), {
    automatic: true,
    snoozedUntil: 0,
    lastCheckedAt: null,
  });
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  const c = new UpdateController(s.backend, blocked, s.clock);
  c.snooze();
  await c.check();
  assert.equal(notificationVisible(c.getSnapshot()), false);
});
test("patchnotes require matching version and renderable text arrays", async () => {
  const s = setup();
  await s.controller.check();
  await s.controller.loadPatchnotes();
  assert.equal(s.controller.getSnapshot().patchnotes?.version, "1.4.13");
  assert.throws(() => parsePatchnotes({ version: "wrong" }, "1.4.13"));
  assert.throws(() =>
    parsePatchnotes(
      { version: "1.4.13", title: "X", publishedAt: "n/a", changes: [] },
      "1.4.13",
    ),
  );
});
