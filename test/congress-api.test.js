import assert from "node:assert/strict";
import test from "node:test";
import { CongressApi, unwrapHouseVote } from "../src/congress-api.js";
import { uniqueSessionNumbers } from "../src/util.js";

test("unwrapHouseVote finds the vote object among wrapper keys", () => {
  const payload = {
    request: {},
    pagination: { count: 2 },
    houseRollCallVote: {
      rollCallNumber: 17,
      voteQuestion: "On Passage",
      results: [{ bioguideID: "A000055", voteCast: "Yea" }],
    },
  };
  const vote = unwrapHouseVote(payload);
  assert.equal(vote.rollCallNumber, 17);
  assert.equal(vote.results.length, 1);
});

test("uniqueSessionNumbers de-dupes chamber rows", () => {
  assert.deepEqual(
    uniqueSessionNumbers([
      { chamber: "Senate", number: 1 },
      { chamber: "House of Representatives", number: 1 },
      { chamber: "Senate", number: 2 },
    ]),
    [1, 2],
  );
});

test("CongressApi paginates member lists", async () => {
  const calls = [];
  const api = new CongressApi({
    apiKey: "test-key",
    http: {
      async getJson(url) {
        calls.push(url);
        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get("offset") || 0);
        if (offset === 0) {
          return {
            members: [{ bioguideId: "A" }, { bioguideId: "B" }],
            pagination: { count: 3, next: "next" },
          };
        }
        return {
          members: [{ bioguideId: "C" }],
          pagination: { count: 3 },
        };
      },
    },
  });

  const { members, currentMember } = await api.listMembersByCongress(119, {
    currentMember: true,
  });
  assert.equal(currentMember, true);
  assert.deepEqual(
    members.map((m) => m.bioguideId),
    ["A", "B", "C"],
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0], /currentMember=true/);
  assert.match(calls[0], /limit=250/);
});

test("listHouseVotes treats 404 as empty session", async () => {
  const { HttpError } = await import("../src/http.js");
  const api = new CongressApi({
    apiKey: "x",
    http: {
      async getJson() {
        throw new HttpError("missing", { status: 404, url: "https://example" });
      },
    },
  });
  const votes = await api.listHouseVotes(119, 9);
  assert.deepEqual(votes, []);
});
