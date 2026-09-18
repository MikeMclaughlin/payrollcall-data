import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getConfig } from "../src/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src/index.js");

test("CLI --help exits 0 without an API key", () => {
  const result = spawnSync(process.execPath, [entry, "--help"], {
    cwd: root,
    env: { ...process.env, CONGRESS_GOV_API_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--members-only/);
});

test("CLI without a key exits 1 with signup URL", () => {
  const result = spawnSync(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, CONGRESS_GOV_API_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /api\.congress\.gov\/sign-up/);
});

test("getConfig reads the env key", () => {
  const prev = process.env.CONGRESS_GOV_API_KEY;
  process.env.CONGRESS_GOV_API_KEY = "abc123";
  try {
    const config = getConfig({});
    assert.equal(config.apiKey, "abc123");
    assert.match(config.dataDir, /data$/);
  } finally {
    if (prev == null) delete process.env.CONGRESS_GOV_API_KEY;
    else process.env.CONGRESS_GOV_API_KEY = prev;
  }
});
