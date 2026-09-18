import assert from "node:assert/strict";
import test from "node:test";
import { helpText, parseArgs } from "../src/cli.js";

test("parseArgs defaults", () => {
  assert.deepEqual(parseArgs(["node", "src/index.js"]), {
    congress: null,
    membersOnly: false,
    skipBills: false,
    skipHouse: false,
    skipSenate: false,
    dryRun: false,
    verbose: false,
    force: false,
    limit: null,
    help: false,
  });
});

test("parseArgs flags and equals form", () => {
  const args = parseArgs([
    "node",
    "src/index.js",
    "--congress=119",
    "--members-only",
    "--skip-bills",
    "--skip-house",
    "--skip-senate",
    "--dry-run",
    "--force",
    "--limit",
    "5",
    "-v",
  ]);
  assert.equal(args.congress, 119);
  assert.equal(args.membersOnly, true);
  assert.equal(args.skipBills, true);
  assert.equal(args.skipHouse, true);
  assert.equal(args.skipSenate, true);
  assert.equal(args.dryRun, true);
  assert.equal(args.force, true);
  assert.equal(args.limit, 5);
  assert.equal(args.verbose, true);
});

test("parseArgs rejects unknown flags and bad numbers", () => {
  assert.throws(() => parseArgs(["node", "x", "--nope"]), /Unknown argument/);
  assert.throws(() => parseArgs(["node", "x", "--congress", "abc"]), /Invalid --congress/);
  assert.throws(() => parseArgs(["node", "x", "--limit", "0"]), /Invalid --limit/);
});

test("help text mentions key flags", () => {
  const text = helpText();
  assert.match(text, /--congress N/);
  assert.match(text, /--members-only/);
  assert.match(text, /CONGRESS_GOV_API_KEY/);
});
