import fs from "node:fs";
import path from "node:path";

export function createLogger(verbose = false) {
  return {
    verbose,
    info(message) {
      console.log(message);
    },
    warn(message) {
      console.warn(message);
    },
    error(message) {
      console.error(message);
    },
    debug(message) {
      if (verbose) console.log(message);
    },
  };
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function padRoll(n, width = 5) {
  return String(n).padStart(width, "0");
}

export function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function countFiles(dir) {
  if (!dir) return 0;
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

export function uniqueSessionNumbers(sessions) {
  const numbers = new Set();
  for (const session of sessions || []) {
    if (session && session.number != null) numbers.add(Number(session.number));
  }
  return [...numbers].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}

export function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
