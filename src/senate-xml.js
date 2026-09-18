import { XMLParser } from "fast-xml-parser";
import { asArray, padRoll } from "./util.js";
import { parseIssue } from "./bill-ref.js";
import { HttpError } from "./http.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  isArray: (name) => name === "vote" || name === "member",
});

export class SenateXml {
  constructor({ http }) {
    this.http = http;
  }

  menuUrl(congress, session) {
    return `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
  }

  voteUrl(congress, session, roll) {
    return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padRoll(roll)}.xml`;
  }

  async listVotes(congress, session) {
    const url = this.menuUrl(congress, session);
    let xml;
    try {
      xml = await this.#getXml(url);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return [];
      throw err;
    }
    const parsed = parser.parse(xml);
    const root = parsed.vote_summary || parsed;
    const votes = asArray(root.votes?.vote);
    return votes.map((vote) => normalizeMenuVote(vote, congress, session, url));
  }

  async getVote(congress, session, roll) {
    const url = this.voteUrl(congress, session, roll);
    const xml = await this.#getXml(url);
    const parsed = parser.parse(xml);
    const root = parsed.roll_call_vote || parsed;
    return normalizeVoteDetail(root, congress, session, url);
  }

  async #getXml(url) {
    const buf = await this.http.getBuffer(url, { headers: { Accept: "application/xml,text/xml" } });
    return decodeXml(buf);
  }
}

export function decodeXml(buf) {
  const head = buf.subarray(0, 180).toString("ascii");
  const charset = (head.match(/encoding=["']([^"']+)["']/i) || [])[1] || "utf-8";
  const label = charset.toLowerCase() === "iso-8859-1" ? "latin1" : charset;
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

function normalizeMenuVote(vote, congress, session, sourceUrl) {
  const roll = Number(String(vote.vote_number || "").replace(/^0+/, "") || vote.vote_number);
  const yeas = Number(vote.vote_tally?.yeas ?? 0);
  const nays = Number(vote.vote_tally?.nays ?? 0);
  return {
    congress: Number(congress),
    sessionNumber: Number(session),
    rollCallNumber: roll,
    date: vote.vote_date || null,
    issue: vote.issue || null,
    question: cleanText(vote.question),
    result: vote.result || null,
    title: cleanText(vote.title),
    yeas,
    nays,
    sourceUrl,
    voteUrl: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padRoll(roll)}.xml`,
    bill: parseIssue(vote.issue, { congress, source: "senate-vote-menu" }),
  };
}

function normalizeVoteDetail(root, congress, session, sourceUrl) {
  const roll = Number(root.vote_number);
  const members = asArray(root.members?.member).map(normalizeMember);
  const document = root.document || {};
  const bill = parseIssue(
    document.document_name || `${document.document_type || ""} ${document.document_number || ""}`.trim(),
    { congress, source: "senate-vote-xml" },
  );

  return {
    congress: Number(root.congress || congress),
    sessionNumber: Number(root.session || session),
    congressYear: root.congress_year || null,
    rollCallNumber: roll,
    voteDate: root.vote_date || null,
    modifyDate: root.modify_date || null,
    question: cleanText(root.question),
    voteQuestionText: cleanText(root.vote_question_text),
    voteTitle: cleanText(root.vote_title),
    voteDocumentText: cleanText(root.vote_document_text),
    voteResult: cleanText(root.vote_result),
    voteResultText: cleanText(root.vote_result_text),
    majorityRequirement: root.majority_requirement || null,
    document: {
      congress: document.document_congress || null,
      type: cleanText(document.document_type),
      number: document.document_number || null,
      name: document.document_name || null,
      title: cleanText(document.document_title),
      shortTitle: cleanText(document.document_short_title),
    },
    amendment: root.amendment || null,
    count: {
      yeas: numberOrNull(root.count?.yeas),
      nays: numberOrNull(root.count?.nays),
      present: numberOrNull(root.count?.present),
      absent: numberOrNull(root.count?.absent),
    },
    bill,
    source: {
      system: "senate.gov LIS XML",
      url: sourceUrl,
      menuNote:
        "Congress.gov API v3 has House roll calls only. Senate member-level votes come from senate.gov XML (Senate LIS / bill clerk).",
    },
    members,
  };
}

function normalizeMember(member) {
  return {
    lisMemberId: member.lis_member_id || null,
    memberFull: member.member_full || null,
    firstName: member.first_name || null,
    lastName: member.last_name || null,
    party: member.party || null,
    state: member.state || null,
    voteCast: member.vote_cast || null,
  };
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
