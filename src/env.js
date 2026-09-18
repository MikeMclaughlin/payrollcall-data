import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadEnv() {
  dotenv.config({ path: path.join(repoRoot(), ".env") });
}

export function getConfig(args) {
  const apiKey = (process.env.CONGRESS_GOV_API_KEY || "").trim();
  if (!apiKey && !args.help) {
    throw new Error(
      [
        "Missing CONGRESS_GOV_API_KEY.",
        "Get a free key at https://api.congress.gov/sign-up/",
        "then either:",
        "  export CONGRESS_GOV_API_KEY=your_key",
        "  or copy .env.example to .env and paste the key there.",
      ].join("\n"),
    );
  }

  return {
    apiKey,
    dataDir: path.join(repoRoot(), "data"),
    congressMinIntervalMs: envInt("CONGRESS_GOV_MIN_INTERVAL_MS", 800),
    senateMinIntervalMs: envInt("SENATE_XML_MIN_INTERVAL_MS", 150),
  };
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return n;
}
