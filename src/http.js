import { sleep } from "./util.js";

const USER_AGENT =
  "payrollcall-data/1.0 (+https://github.com/MikeMclaughlin/payrollcall-data; local Congress.gov dump)";

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class ThrottledHttp {
  constructor({ minIntervalMs = 800, logger, name = "http" }) {
    this.minIntervalMs = minIntervalMs;
    this.logger = logger;
    this.name = name;
    this.nextAllowedAt = 0;
  }

  async getJson(url, { apiKey, headers } = {}) {
    const res = await this.request(url, {
      apiKey,
      headers: { Accept: "application/json", ...headers },
    });
    return res.json();
  }

  async getBuffer(url, { headers } = {}) {
    const res = await this.request(url, { headers });
    return Buffer.from(await res.arrayBuffer());
  }

  async request(url, { apiKey, headers } = {}) {
    const target = withApiKey(url, apiKey);
    let lastError;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await this.#throttle();
      this.logger.debug(`${this.name} GET ${redact(target)}`);

      let res;
      try {
        res = await fetch(target, {
          headers: {
            "User-Agent": USER_AGENT,
            ...headers,
          },
        });
      } catch (err) {
        lastError = err;
        const wait = backoffMs(attempt, 1000);
        this.logger.warn(`Network error (${this.name}): ${err.message}. Retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }

      if (res.status === 429) {
        const suggested = retryAfterMs(res) ?? Math.max(backoffMs(attempt, 5000), 15_000);
        const wait = Math.min(suggested, 5 * 60 * 1000);
        if (suggested > wait) {
          this.logger.warn(
            `HTTP 429 Retry-After is ${Math.round(suggested / 1000)}s; capping this wait at ${Math.round(wait / 1000)}s. Re-run later if the hourly cap is still exhausted.`,
          );
        } else {
          this.logger.warn(`HTTP 429 rate limited. Waiting ${Math.round(wait / 1000)}s before retry`);
        }
        await sleep(wait);
        continue;
      }

      if (res.status >= 500) {
        const wait = backoffMs(attempt, 750);
        this.logger.warn(`HTTP ${res.status} from ${this.name}. Retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }

      if (res.status === 404) {
        const body = await safeText(res);
        throw new HttpError(`HTTP 404 ${redact(url)}`, { status: 404, url, body });
      }

      if (!res.ok) {
        const body = await safeText(res);
        throw new HttpError(`HTTP ${res.status} ${redact(url)}`, {
          status: res.status,
          url,
          body,
        });
      }

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining != null && Number(remaining) <= 0) {
        this.logger.warn(
          `Rate-limit remaining=${remaining}. Pausing 60s to stay under the hourly cap.`,
        );
        await sleep(60_000);
      }

      return res;
    }

    throw lastError || new HttpError(`Gave up requesting ${redact(url)}`, { url });
  }

  async #throttle() {
    const wait = this.nextAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.nextAllowedAt = Date.now() + this.minIntervalMs;
  }
}

function withApiKey(url, apiKey) {
  if (!apiKey) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("api_key", apiKey);
  return parsed.toString();
}

function redact(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("api_key")) parsed.searchParams.set("api_key", "***");
    return parsed.toString();
  } catch {
    return url;
  }
}

function retryAfterMs(res) {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function backoffMs(attempt, base) {
  const cap = 60_000;
  const exp = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
