import fs from "node:fs";
import path from "node:path";

export class JsonStore {
  constructor({ rootDir, dryRun = false, force = false, logger }) {
    this.rootDir = rootDir;
    this.dryRun = dryRun;
    this.force = force;
    this.logger = logger;
    this.written = 0;
    this.skipped = 0;
  }

  resolve(...parts) {
    return path.join(this.rootDir, ...parts);
  }

  exists(relOrAbs) {
    const filePath = path.isAbsolute(relOrAbs) ? relOrAbs : this.resolve(relOrAbs);
    return fs.existsSync(filePath);
  }

  shouldSkip(relPath) {
    if (this.force) return false;
    return this.exists(relPath);
  }

  readJson(relPath) {
    const filePath = this.resolve(relPath);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  writeJson(relPath, data) {
    const filePath = this.resolve(relPath);
    if (this.dryRun) {
      this.logger.debug(`[dry-run] skip write ${relPath}`);
      return filePath;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, filePath);
    this.written += 1;
    this.logger.debug(`wrote ${relPath}`);
    return filePath;
  }

  skip(relPath) {
    this.skipped += 1;
    this.logger.debug(`skip existing ${relPath}`);
  }

  mkdirp(relPath) {
    if (this.dryRun) return;
    fs.mkdirSync(this.resolve(relPath), { recursive: true });
  }
}
