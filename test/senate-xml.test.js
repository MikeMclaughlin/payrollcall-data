import assert from "node:assert/strict";
import test from "node:test";
import { decodeXml, SenateXml } from "../src/senate-xml.js";
import { senateMenuXml, senateVoteXml } from "./fixtures.js";

test("decodeXml honors iso-8859-1 declaration", () => {
  const xml = '<?xml version="1.0" encoding="iso-8859-1"?><root>café</root>';
  const buf = Buffer.from(xml, "latin1");
  const text = decodeXml(buf);
  assert.match(text, /caf/);
});

test("SenateXml listVotes normalizes menu XML", async () => {
  const senate = new SenateXml({
    http: {
      async getBuffer() {
        return Buffer.from(senateMenuXml, "utf8");
      },
    },
  });
  const votes = await senate.listVotes(119, 2);
  assert.equal(votes.length, 2);
  assert.equal(votes[0].rollCallNumber, 234);
  assert.equal(votes[0].bill.kind, "bill");
  assert.equal(votes[0].bill.apiType, "hr");
  assert.equal(votes[1].bill.kind, "nomination");
  assert.match(votes[0].voteUrl, /vote_119_2_00234\.xml$/);
});

test("SenateXml getVote includes member positions and cloture result", async () => {
  const senate = new SenateXml({
    http: {
      async getBuffer() {
        return Buffer.from(senateVoteXml, "latin1");
      },
    },
  });
  const vote = await senate.getVote(119, 2, 234);
  assert.equal(vote.rollCallNumber, 234);
  assert.match(vote.voteResult, /Cloture/);
  assert.equal(vote.majorityRequirement, "3/5");
  assert.equal(vote.bill.apiType, "hr");
  assert.equal(vote.members.length, 2);
  assert.equal(vote.members[0].lisMemberId, "S354");
  assert.equal(vote.members[0].voteCast, "Nay");
  assert.equal(vote.source.system, "senate.gov LIS XML");
});
