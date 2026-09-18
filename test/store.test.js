import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../src/store.js";

function tmpStore(opts = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "payrollcall-"));
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  return { rootDir, store: new JsonStore({ rootDir, logger, ...opts }) };
}

test("writeJson is pretty-printed and skipped on re-run", () => {
  const { rootDir, store } = tmpStore();
  store.writeJson("congress/119/meta.json", { ok: true });
  const filePath = path.join(rootDir, "congress/119/meta.json");
  const text = fs.readFileSync(filePath, "utf8");
  assert.match(text, /\n  "ok": true\n/);
  assert.equal(store.written, 1);
  assert.equal(store.shouldSkip("congress/119/meta.json"), true);
  store.skip("congress/119/meta.json");
  assert.equal(store.skipped, 1);
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test("force overwrites; dry-run writes nothing", () => {
  const { rootDir, store } = tmpStore({ force: true });
  store.writeJson("a.json", { n: 1 });
  assert.equal(store.shouldSkip("a.json"), false);

  const dry = tmpStore({ dryRun: true }).store;
  dry.writeJson("nope.json", { n: 1 });
  assert.equal(dry.exists("nope.json"), false);
  fs.rmSync(rootDir, { recursive: true, force: true });
});
