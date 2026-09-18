import { asArray } from "./util.js";
import { HttpError } from "./http.js";

const PAGE_LIMIT = 250;

export class CongressApi {
  constructor({ http, apiKey }) {
    this.http = http;
    this.apiKey = apiKey;
    this.base = "https://api.congress.gov/v3";
  }

  url(pathname, query = {}) {
    const url = new URL(this.base + pathname);
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    if (!url.searchParams.has("format")) url.searchParams.set("format", "json");
    return url.toString();
  }

  get(pathname, query) {
    return this.http.getJson(this.url(pathname, query), { apiKey: this.apiKey });
  }

  async getCurrentCongress() {
    const payload = await this.get("/congress/current");
    return unwrap(payload, ["congress"]);
  }

  async getCongress(congress) {
    const payload = await this.get(`/congress/${congress}`);
    return unwrap(payload, ["congress"]);
  }

  async listMembersByCongress(congress, { currentMember = true, limit = null } = {}) {
    const members = await this.#paginate(
      `/member/congress/${congress}`,
      { currentMember: currentMember ? "true" : "false" },
      "members",
      limit,
    );
    return { members, currentMember };
  }

  getMember(bioguideId) {
    return this.get(`/member/${encodeURIComponent(bioguideId)}`).then((payload) =>
      unwrap(payload, ["member"]),
    );
  }

  async listHouseVotes(congress, session, { limit = null } = {}) {
    try {
      return await this.#paginate(
        `/house-vote/${congress}/${session}`,
        {},
        "houseRollCallVotes",
        limit,
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return [];
      throw err;
    }
  }

  async getHouseVote(congress, session, roll) {
    const payload = await this.get(`/house-vote/${congress}/${session}/${roll}`);
    return unwrapHouseVote(payload);
  }

  async getHouseVoteMembers(congress, session, roll) {
    const pathname = `/house-vote/${congress}/${session}/${roll}/members`;
    let offset = 0;
    let meta = null;
    const results = [];

    while (true) {
      const payload = await this.get(pathname, { offset, limit: PAGE_LIMIT });
      const vote = unwrapHouseVote(payload);
      if (!meta) meta = vote;
      const chunk = asArray(vote.results ?? payload.results);
      results.push(...chunk);
      const total = payload.pagination?.count;
      if (chunk.length < PAGE_LIMIT) break;
      if (total != null && results.length >= total) break;
      if (!payload.pagination?.next && total == null) break;
      offset += PAGE_LIMIT;
      if (offset > 10_000) break;
    }

    return { ...meta, results };
  }

  getBill(congress, type, number) {
    return this.get(`/bill/${congress}/${type}/${number}`).then((payload) =>
      unwrap(payload, ["bill"]),
    );
  }

  async getBillActions(congress, type, number) {
    return this.#paginate(
      `/bill/${congress}/${type}/${number}/actions`,
      {},
      "actions",
    );
  }

  async getBillSummaries(congress, type, number) {
    try {
      return await this.#paginate(
        `/bill/${congress}/${type}/${number}/summaries`,
        {},
        "summaries",
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return [];
      throw err;
    }
  }

  async #paginate(pathname, query, collectionKey, limit = null) {
    const items = [];
    let offset = 0;

    while (true) {
      const pageLimit = limit == null ? PAGE_LIMIT : Math.min(PAGE_LIMIT, limit - items.length);
      const payload = await this.get(pathname, { ...query, offset, limit: pageLimit });
      const chunk = asArray(payload[collectionKey]);
      items.push(...chunk);
      const total = payload.pagination?.count;
      if (limit != null && items.length >= limit) return items.slice(0, limit);
      if (chunk.length === 0) break;
      if (total != null && items.length >= total) break;
      if (payload.pagination?.next) {
        offset += chunk.length;
        if (offset > 1_000_000) break;
        continue;
      }
      if (chunk.length < pageLimit) break;
      offset += chunk.length;
      if (offset > 1_000_000) break;
    }

    return items;
  }
}

export function unwrap(payload, keys) {
  for (const key of keys) {
    if (payload && payload[key] != null) return payload[key];
  }
  return payload;
}

export function unwrapHouseVote(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload.results) && payload.rollCallNumber != null) return payload;
  const skip = new Set(["request", "pagination"]);
  for (const [key, value] of Object.entries(payload)) {
    if (skip.has(key) || value == null || typeof value !== "object") continue;
    if (Array.isArray(value.results) || value.rollCallNumber != null || value.voteQuestion != null) {
      return value;
    }
  }
  return payload;
}
