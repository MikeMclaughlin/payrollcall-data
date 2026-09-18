import { getConfig } from "./env.js";
import { JsonStore } from "./store.js";
import { ThrottledHttp, HttpError } from "./http.js";
import { CongressApi } from "./congress-api.js";
import { SenateXml } from "./senate-xml.js";
import { parseBillRef, billKey, congressGovBillUrl } from "./bill-ref.js";
import {
  asArray,
  countFiles,
  createLogger,
  normalizeName,
  nowIso,
  uniqueSessionNumbers,
} from "./util.js";

export async function run(args) {
  const config = getConfig(args);
  const logger = createLogger(args.verbose);
  const store = new JsonStore({
    rootDir: config.dataDir,
    dryRun: args.dryRun,
    force: args.force,
    logger,
  });

  const congressHttp = new ThrottledHttp({
    minIntervalMs: config.congressMinIntervalMs,
    logger,
    name: "congress.gov",
  });
  const senateHttp = new ThrottledHttp({
    minIntervalMs: config.senateMinIntervalMs,
    logger,
    name: "senate.gov",
  });
  const api = new CongressApi({ http: congressHttp, apiKey: config.apiKey });
  const senate = new SenateXml({ http: senateHttp });

  const startedAt = nowIso();
  const manifest = createManifest(args, startedAt);
  let stopping = false;

  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    logger.warn("Interrupt received — writing partial manifest and exiting…");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    logger.info("Resolving Congress metadata…");
    const current = await api.getCurrentCongress();
    const congressNumber = args.congress || Number(current.number);
    const sittingOnly = congressNumber === Number(current.number);
    const congressMeta =
      sittingOnly && !args.congress ? current : await api.getCongress(congressNumber);

    manifest.congress = congressNumber;
    manifest.congressName = congressMeta.name || `${congressNumber}th Congress`;
    const congressDir = `congress/${congressNumber}`;
    store.mkdirp(congressDir);

    const metaPath = `${congressDir}/meta.json`;
    if (store.shouldSkip(metaPath)) store.skip(metaPath);
    else {
      store.writeJson(metaPath, {
        fetchedAt: nowIso(),
        source: { url: `https://api.congress.gov/v3/congress/${congressNumber}?format=json` },
        congress: congressMeta,
      });
    }

    const sessions = uniqueSessionNumbers(congressMeta.sessions);
    if (sessions.length === 0) sessions.push(1);
    logger.info(
      `${manifest.congressName} (sessions ${sessions.join(", ")}). Throttle ${config.congressMinIntervalMs}ms between Congress.gov calls.`,
    );
    if (args.dryRun) logger.info("Dry run: list endpoints only; no data files will be written.");
    if (args.limit) logger.info(`--limit ${args.limit} is on (caps members and votes per session).`);

    const members = await fetchMembers({
      api,
      store,
      logger,
      congressNumber,
      congressDir,
      sittingOnly,
      args,
      manifest,
      shouldStop: () => stopping,
    });

    const billRefs = new Map();
    const noteRef = (ref) => rememberBillRef(billRefs, ref, manifest);

    if (!args.membersOnly && !args.skipHouse) {
      await fetchHouseVotes({
        api,
        store,
        logger,
        congressNumber,
        congressDir,
        sessions,
        args,
        manifest,
        noteRef,
        shouldStop: () => stopping,
      });
    } else if (args.membersOnly) {
      logger.info("Skipping votes (--members-only).");
    }

    if (!args.membersOnly && !args.skipSenate) {
      await fetchSenateVotes({
        senate,
        store,
        logger,
        congressNumber,
        congressDir,
        sessions,
        members,
        args,
        manifest,
        noteRef,
        shouldStop: () => stopping,
      });
    }

    if (!args.membersOnly && !args.skipBills) {
      await fetchBills({
        api,
        store,
        logger,
        congressNumber,
        congressDir,
        billRefs,
        args,
        manifest,
        shouldStop: () => stopping,
      });
    } else if (args.skipBills) {
      logger.info("Skipping bills (--skip-bills).");
    }

    manifest.status = stopping ? "interrupted" : "ok";
  } catch (err) {
    manifest.status = "error";
    pushError(manifest, {
      stage: "run",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    delete manifest._seenNonBills;
    manifest.finishedAt = nowIso();
    manifest.counts.filesWritten = store.written;
    manifest.counts.filesSkipped = store.skipped;
    if (!args.dryRun) {
      try {
        manifest.counts.filesOnDisk = countFiles(store.resolve(`congress/${manifest.congress || ""}`));
      } catch {
        manifest.counts.filesOnDisk = null;
      }
      store.writeJson("manifest.json", manifest);
    }
    logger.info(summarize(manifest, args.dryRun));
  }
}

function createManifest(args, startedAt) {
  return {
    status: "running",
    startedAt,
    finishedAt: null,
    congress: args.congress,
    congressName: null,
    options: {
      membersOnly: args.membersOnly,
      skipBills: args.skipBills,
      skipHouse: args.skipHouse,
      skipSenate: args.skipSenate,
      dryRun: args.dryRun,
      force: args.force,
      limit: args.limit,
    },
    sources: {
      congressGov: {
        base: "https://api.congress.gov/v3",
        docs: "https://github.com/LibraryOfCongress/api.congress.gov",
        rateLimit: "5000 requests per hour per api.data.gov key",
      },
      senateXml: {
        voteLists: "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml",
        voteDetail:
          "https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{roll}.xml",
        note: "Congress.gov has no Senate roll-call endpoint. Member-level Senate votes are Senate LIS XML, published on senate.gov (compiled by the Senate bill clerk).",
      },
    },
    counts: {
      membersListed: 0,
      membersSaved: 0,
      houseVotesListed: 0,
      houseVotesSaved: 0,
      senateVotesListed: 0,
      senateVotesSaved: 0,
      billsListed: 0,
      billsSaved: 0,
      filesWritten: 0,
      filesSkipped: 0,
      filesOnDisk: 0,
      skippedNominations: 0,
      skippedTreaties: 0,
    },
    gaps: [],
    errors: [],
    _seenNonBills: new Set(),
  };
}

async function fetchMembers({
  api,
  store,
  logger,
  congressNumber,
  congressDir,
  sittingOnly,
  args,
  manifest,
  shouldStop,
}) {
  logger.info(
    sittingOnly
      ? "Fetching sitting members (currentMember=true)…"
      : `Fetching members who served in Congress ${congressNumber} (currentMember=false)…`,
  );
  const listed = await api.listMembersByCongress(congressNumber, {
    currentMember: sittingOnly,
    limit: args.limit,
  });
  const summaries = listed.members.map((member) => listMemberSummary(member, congressNumber));
  manifest.counts.membersListed = summaries.length;

  const membersDir = `${congressDir}/members`;
  const details = [];

  for (const [index, summary] of summaries.entries()) {
    if (shouldStop()) break;
    const rel = `${membersDir}/${summary.bioguideId}.json`;
    if (store.shouldSkip(rel)) {
      store.skip(rel);
      if (store.exists(rel) && !args.dryRun) {
        try {
          const existing = store.readJson(rel);
          details.push(existing.member || existing);
        } catch {
          details.push(summary);
        }
      } else {
        details.push(summary);
      }
      continue;
    }

    try {
      const raw = args.dryRun ? summary : await api.getMember(summary.bioguideId);
      const member = normalizeMember(raw, congressNumber, summary);
      details.push(member);
      store.writeJson(rel, {
        fetchedAt: nowIso(),
        source: {
          url: `https://api.congress.gov/v3/member/${member.bioguideId}?format=json`,
        },
        member,
        raw,
      });
      manifest.counts.membersSaved += 1;
    } catch (err) {
      pushError(manifest, {
        stage: "member",
        id: summary.bioguideId,
        message: err.message,
        status: err.status,
      });
      details.push(summary);
    }

    if ((index + 1) % 25 === 0) {
      logger.info(`  members ${index + 1}/${summaries.length}`);
    }
  }

  const indexRecords = details.map((member) => indexMember(member, congressNumber));
  store.writeJson(`${membersDir}/index.json`, {
    congress: congressNumber,
    currentMember: true,
    fetchedAt: nowIso(),
    count: indexRecords.length,
    members: indexRecords,
  });

  logger.info(`Members: listed ${summaries.length}, wrote ${manifest.counts.membersSaved} detail files.`);
  return indexRecords;
}

function listMemberSummary(raw, congressNumber) {
  const terms = asArray(raw.terms?.item || raw.terms);
  const term = pickTerm(terms, congressNumber);
  return {
    bioguideId: raw.bioguideId,
    name: raw.name || raw.invertedOrderName || null,
    party: raw.partyName || raw.party || null,
    state: raw.state || term.stateName || null,
    district: raw.district ?? term.district ?? null,
    chamber: term.chamber || null,
    terms,
    currentMember: raw.currentMember ?? true,
  };
}

function normalizeMember(raw, congressNumber, fallback = {}) {
  const terms = asArray(raw.terms?.item || raw.terms);
  const term = pickTerm(terms, congressNumber);
  const party = asArray(raw.partyHistory)[0] || {};
  const bioguideId = raw.bioguideId || fallback.bioguideId;
  return {
    bioguideId,
    name:
      raw.invertedOrderName ||
      raw.name ||
      fallback.name ||
      [raw.lastName, raw.firstName].filter(Boolean).join(", "),
    directOrderName: raw.directOrderName || null,
    firstName: raw.firstName || null,
    lastName: raw.lastName || null,
    honorificName: raw.honorificName || null,
    chamber: term.chamber || fallback.chamber || null,
    memberType: term.memberType || null,
    party: party.partyName || raw.partyName || fallback.party || null,
    partyCode: party.partyAbbreviation || null,
    partyHistory: raw.partyHistory || [],
    state: term.stateName || raw.state || fallback.state || null,
    stateCode: term.stateCode || null,
    district: term.district ?? raw.district ?? fallback.district ?? null,
    currentMember: raw.currentMember ?? true,
    officialWebsiteUrl: raw.officialWebsiteUrl || null,
    depiction: raw.depiction || null,
    birthYear: raw.birthYear || null,
    terms,
    updateDate: raw.updateDate || null,
    apiUrl: `https://api.congress.gov/v3/member/${bioguideId}?format=json`,
    congressGovUrl: `https://www.congress.gov/member/${encodeURIComponent(bioguideId)}`,
  };
}

function indexMember(member, congressNumber) {
  const terms = asArray(member.terms);
  const term = pickTerm(terms, congressNumber);
  return {
    bioguideId: member.bioguideId,
    name: member.name,
    lastName: member.lastName || surnameFromInverted(member.name) || null,
    directOrderName: member.directOrderName || null,
    chamber: member.chamber || term.chamber || null,
    party: member.party || null,
    partyCode: member.partyCode || null,
    state: member.state || term.stateName || null,
    stateCode: member.stateCode || term.stateCode || null,
    district: member.district ?? term.district ?? null,
    currentMember: member.currentMember ?? true,
  };
}

function pickTerm(terms, congressNumber) {
  const matching = terms.filter((term) => Number(term.congress) === Number(congressNumber));
  if (matching.length) return matching[matching.length - 1];
  return terms[terms.length - 1] || {};
}

function buildLisLookup(members) {
  const byKey = new Map();
  for (const member of members) {
    if (!/senate/i.test(member.chamber || "")) continue;
    const key = `${normalizeName(member.lastName || member.name)}|${String(member.stateCode || "").toUpperCase()}`;
    if (!key.startsWith("|") && member.lastName) {
      const list = byKey.get(key) || [];
      list.push(member);
      byKey.set(key, list);
    }
    const nameKey = `${normalizeName(surnameFromInverted(member.name))}|${String(member.stateCode || "").toUpperCase()}`;
    if (member.stateCode && nameKey !== key) {
      const list = byKey.get(nameKey) || [];
      list.push(member);
      byKey.set(nameKey, list);
    }
  }
  return {
    match(lastName, state) {
      const key = `${normalizeName(lastName)}|${String(state || "").toUpperCase()}`;
      const hits = uniqueBy(
        byKey.get(key) || [],
        (m) => m.bioguideId,
      );
      if (hits.length === 1) return hits[0].bioguideId;
      return null;
    },
  };
}

function surnameFromInverted(name) {
  if (!name) return "";
  return String(name).split(",")[0] || "";
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchHouseVotes({
  api,
  store,
  logger,
  congressNumber,
  congressDir,
  sessions,
  args,
  manifest,
  noteRef,
  shouldStop,
}) {
  logger.info("Fetching House roll-call votes (Congress.gov)…");
  const index = [];

  for (const session of sessions) {
    if (shouldStop()) break;
    let listed;
    try {
      listed = await api.listHouseVotes(congressNumber, session, { limit: args.limit });
    } catch (err) {
      pushError(manifest, {
        stage: "house-vote-list",
        session,
        message: err.message,
        status: err.status,
      });
      continue;
    }

    if (listed.length === 0) {
      manifest.gaps.push({
        stage: "house-vote-list",
        session,
        message: `No House votes returned for Congress ${congressNumber} session ${session}`,
      });
      logger.info(`  House session ${session}: none`);
      continue;
    }

    logger.info(`  House session ${session}: ${listed.length} votes`);
    manifest.counts.houseVotesListed += listed.length;
    const sessionDir = `${congressDir}/house-votes/${session}`;

    for (const [i, listedVote] of listed.entries()) {
      if (shouldStop()) break;
      const roll = listedVote.rollCallNumber;
      noteRef(
        parseBillRef({
          type: listedVote.legislationType,
          number: listedVote.legislationNumber,
          congress: listedVote.congress || congressNumber,
          source: `house-vote:${session}/${roll}`,
        }),
      );

      const metaRel = `${sessionDir}/${roll}.json`;
      const membersRel = `${sessionDir}/${roll}.members.json`;
      const haveMeta = store.shouldSkip(metaRel);
      const haveMembers = store.shouldSkip(membersRel);

      let detail = listedVote;
      if (haveMeta) {
        store.skip(metaRel);
        if (!args.dryRun && store.exists(metaRel)) {
          try {
            detail = store.readJson(metaRel).vote || detail;
          } catch {
            /* keep listed vote */
          }
        }
      } else if (!args.dryRun) {
        try {
          detail = await api.getHouseVote(congressNumber, session, roll);
        } catch (err) {
          pushError(manifest, {
            stage: "house-vote",
            id: `${session}/${roll}`,
            message: err.message,
            status: err.status,
          });
        }
      }

      const vote = normalizeHouseVote(detail, listedVote, congressNumber, session);
      if (!haveMeta) {
        store.writeJson(metaRel, {
          fetchedAt: nowIso(),
          source: {
            apiUrl: `https://api.congress.gov/v3/house-vote/${congressNumber}/${session}/${roll}?format=json`,
            clerkXml: vote.sourceDataURL,
          },
          vote,
        });
        manifest.counts.houseVotesSaved += 1;
      }

      if (haveMembers) store.skip(membersRel);
      else if (!args.dryRun) {
        try {
          const memberPayload = await api.getHouseVoteMembers(congressNumber, session, roll);
          const members = asArray(memberPayload.results).map(normalizeHousePosition);
          store.writeJson(membersRel, {
            fetchedAt: nowIso(),
            congress: congressNumber,
            sessionNumber: session,
            rollCallNumber: roll,
            count: members.length,
            members,
          });
        } catch (err) {
          pushError(manifest, {
            stage: "house-vote-members",
            id: `${session}/${roll}`,
            message: err.message,
            status: err.status,
          });
        }
      }

      index.push({
        congress: congressNumber,
        sessionNumber: session,
        rollCallNumber: roll,
        voteQuestion: vote.voteQuestion,
        voteType: vote.voteType,
        result: vote.result,
        startDate: vote.startDate,
        legislationType: vote.legislationType,
        legislationNumber: vote.legislationNumber,
        billKey: vote.bill?.kind === "bill" ? vote.bill.key : null,
      });

      if ((i + 1) % 25 === 0) {
        logger.info(`    house ${session}:${i + 1}/${listed.length}`);
      }
    }
  }

  store.writeJson(`${congressDir}/house-votes/index.json`, {
    congress: congressNumber,
    fetchedAt: nowIso(),
    count: index.length,
    votes: index,
  });
}

function normalizeHouseVote(detail, listed, congressNumber, session) {
  const src = { ...listed, ...detail };
  const bill = parseBillRef({
    type: src.legislationType,
    number: src.legislationNumber,
    congress: src.congress || congressNumber,
    source: "house-vote",
  });
  return {
    congress: Number(src.congress || congressNumber),
    sessionNumber: Number(src.sessionNumber || session),
    rollCallNumber: Number(src.rollCallNumber),
    identifier: src.identifier || null,
    voteQuestion: src.voteQuestion || null,
    voteType: src.voteType || null,
    result: src.result || null,
    startDate: src.startDate || null,
    updateDate: src.updateDate || null,
    legislationType: src.legislationType || null,
    legislationNumber: src.legislationNumber || null,
    legislationUrl: src.legislationUrl || null,
    sourceDataURL: src.sourceDataURL || null,
    votePartyTotal: src.votePartyTotal || null,
    apiUrl: src.url || null,
    bill,
  };
}

function normalizeHousePosition(row) {
  return {
    bioguideId: row.bioguideID || row.bioguideId || null,
    firstName: row.firstName || null,
    lastName: row.lastName || null,
    voteCast: row.voteCast || null,
    voteParty: row.voteParty || null,
    voteState: row.voteState || null,
  };
}

async function fetchSenateVotes({
  senate,
  store,
  logger,
  congressNumber,
  congressDir,
  sessions,
  members,
  args,
  manifest,
  noteRef,
  shouldStop,
}) {
  logger.info("Fetching Senate roll-call votes (senate.gov LIS XML)…");
  const lis = buildLisLookup(members);
  const lisIndex = {};
  const index = [];

  for (const session of sessions) {
    if (shouldStop()) break;
    let listed;
    try {
      listed = await senate.listVotes(congressNumber, session);
    } catch (err) {
      pushError(manifest, {
        stage: "senate-vote-list",
        session,
        message: err.message,
        status: err.status,
      });
      continue;
    }

    if (args.limit) listed = listed.slice(0, args.limit);
    if (listed.length === 0) {
      manifest.gaps.push({
        stage: "senate-vote-list",
        session,
        message: `No Senate vote menu for Congress ${congressNumber} session ${session}`,
      });
      logger.info(`  Senate session ${session}: none`);
      continue;
    }

    logger.info(`  Senate session ${session}: ${listed.length} votes`);
    manifest.counts.senateVotesListed += listed.length;
    const sessionDir = `${congressDir}/senate-votes/${session}`;

    for (const [i, listedVote] of listed.entries()) {
      if (shouldStop()) break;
      const roll = listedVote.rollCallNumber;
      const metaRel = `${sessionDir}/${roll}.json`;
      const membersRel = `${sessionDir}/${roll}.members.json`;
      const haveMeta = store.shouldSkip(metaRel);
      const haveMembers = store.shouldSkip(membersRel);

      let detail = listedVote;
      if (haveMeta && haveMembers) {
        store.skip(metaRel);
        store.skip(membersRel);
        if (!args.dryRun && store.exists(membersRel)) {
          try {
            const existing = store.readJson(membersRel);
            for (const row of existing.members || []) {
              if (row.lisMemberId && row.bioguideId) lisIndex[row.lisMemberId] = row.bioguideId;
            }
          } catch {
            /* ignore */
          }
        }
      } else if (!args.dryRun) {
        try {
          detail = await senate.getVote(congressNumber, session, roll);
        } catch (err) {
          pushError(manifest, {
            stage: "senate-vote",
            id: `${session}/${roll}`,
            message: err.message,
            status: err.status,
          });
        }
      }

      noteRef(detail.bill || listedVote.bill);
      const positions = asArray(detail.members).map((row) => {
        const bioguideId = lis.match(row.lastName, row.state);
        if (row.lisMemberId && bioguideId) lisIndex[row.lisMemberId] = bioguideId;
        return { ...row, bioguideId };
      });

      const vote = {
        congress: congressNumber,
        sessionNumber: session,
        rollCallNumber: roll,
        voteDate: detail.voteDate || listedVote.date,
        question: detail.question || listedVote.question,
        voteTitle: detail.voteTitle || listedVote.title,
        voteResult: detail.voteResult || listedVote.result,
        voteResultText: detail.voteResultText || null,
        majorityRequirement: detail.majorityRequirement || null,
        count: detail.count || { yeas: listedVote.yeas, nays: listedVote.nays },
        document: detail.document || { name: listedVote.issue },
        bill: detail.bill || listedVote.bill,
        source: detail.source || {
          system: "senate.gov LIS XML",
          url: listedVote.voteUrl,
        },
      };

      if (!haveMeta) {
        store.writeJson(metaRel, { fetchedAt: nowIso(), vote });
        manifest.counts.senateVotesSaved += 1;
      } else if (!(haveMeta && haveMembers)) {
        store.skip(metaRel);
      }

      if (!haveMembers) {
        store.writeJson(membersRel, {
          fetchedAt: nowIso(),
          congress: congressNumber,
          sessionNumber: session,
          rollCallNumber: roll,
          count: positions.length,
          members: positions,
        });
      }

      index.push({
        congress: congressNumber,
        sessionNumber: session,
        rollCallNumber: roll,
        question: vote.question,
        result: vote.voteResult,
        voteDate: vote.voteDate,
        issue: listedVote.issue,
        billKey: vote.bill?.kind === "bill" ? vote.bill.key : null,
      });

      if ((i + 1) % 25 === 0) {
        logger.info(`    senate ${session}:${i + 1}/${listed.length}`);
      }
    }
  }

  store.writeJson(`${congressDir}/senate-votes/index.json`, {
    congress: congressNumber,
    fetchedAt: nowIso(),
    source: "https://www.senate.gov/legislative/LIS/roll_call_lists/",
    count: index.length,
    votes: index,
  });
  store.writeJson(`${congressDir}/members/lis-index.json`, {
    congress: congressNumber,
    fetchedAt: nowIso(),
    note: "Best-effort last-name + state match from sitting senators onto Senate LIS member ids. Nulls are omitted.",
    count: Object.keys(lisIndex).length,
    lisToBioguide: lisIndex,
  });
}

async function fetchBills({
  api,
  store,
  logger,
  congressNumber,
  congressDir,
  billRefs,
  args,
  manifest,
  shouldStop,
}) {
  const refs = [...billRefs.values()].filter((ref) => ref.kind === "bill");
  manifest.counts.billsListed = refs.length;
  logger.info(`Fetching ${refs.length} bills referenced by votes…`);
  const index = [];

  for (const [i, ref] of refs.entries()) {
    if (shouldStop()) break;
    const typeDir = `${congressDir}/bills/${ref.apiType}`;
    const metaRel = `${typeDir}/${ref.number}.json`;
    const actionsRel = `${typeDir}/${ref.number}.actions.json`;
    const haveMeta = store.shouldSkip(metaRel);
    const haveActions = store.shouldSkip(actionsRel);

    let bill = null;
    let actions = [];
    let summaries = [];

    if (haveMeta) {
      store.skip(metaRel);
      if (!args.dryRun && store.exists(metaRel)) {
        try {
          bill = store.readJson(metaRel).bill;
        } catch {
          bill = null;
        }
      }
    } else if (!args.dryRun) {
      try {
        const raw = await api.getBill(ref.congress || congressNumber, ref.apiType, ref.number);
        try {
          summaries = await api.getBillSummaries(
            ref.congress || congressNumber,
            ref.apiType,
            ref.number,
          );
        } catch (err) {
          pushError(manifest, {
            stage: "bill-summaries",
            id: ref.key,
            message: err.message,
            status: err.status,
          });
        }
        bill = normalizeBill(raw, ref, summaries);
        store.writeJson(metaRel, {
          fetchedAt: nowIso(),
          source: {
            apiUrl: `https://api.congress.gov/v3/bill/${ref.congress || congressNumber}/${ref.apiType}/${ref.number}?format=json`,
          },
          bill,
        });
        manifest.counts.billsSaved += 1;
      } catch (err) {
        pushError(manifest, {
          stage: "bill",
          id: ref.key,
          message: err.message,
          status: err.status,
        });
      }
    }

    if (haveActions) store.skip(actionsRel);
    else if (!args.dryRun) {
      try {
        actions = await api.getBillActions(ref.congress || congressNumber, ref.apiType, ref.number);
        store.writeJson(actionsRel, {
          fetchedAt: nowIso(),
          congress: ref.congress || congressNumber,
          type: ref.apiType,
          number: ref.number,
          count: actions.length,
          actions: actions.map(normalizeAction),
        });
      } catch (err) {
        pushError(manifest, {
          stage: "bill-actions",
          id: ref.key,
          message: err.message,
          status: err.status,
        });
      }
    }

    index.push({
      key: ref.key,
      congress: ref.congress || congressNumber,
      type: ref.displayType,
      apiType: ref.apiType,
      number: ref.number,
      title: bill?.title || null,
      latestAction: bill?.latestAction || null,
      laws: bill?.laws || [],
      congressGovUrl: bill?.congressGovUrl || congressGovBillUrl(ref.congress || congressNumber, ref.apiType, ref.number),
    });

    if ((i + 1) % 25 === 0) {
      logger.info(`  bills ${i + 1}/${refs.length}`);
    }
  }

  store.writeJson(`${congressDir}/bills/index.json`, {
    congress: congressNumber,
    fetchedAt: nowIso(),
    count: index.length,
    bills: index,
  });
}

function normalizeBill(raw, ref, summaries) {
  const congress = Number(raw.congress || ref.congress);
  const apiType = String(raw.type || ref.displayType || ref.apiType).toLowerCase();
  const number = String(raw.number || ref.number);
  return {
    congress,
    type: String(raw.type || ref.displayType),
    apiType,
    number,
    title: raw.title || null,
    originChamber: raw.originChamber || null,
    introducedDate: raw.introducedDate || null,
    latestAction: raw.latestAction || null,
    laws: asArray(raw.laws),
    policyArea: raw.policyArea?.name || null,
    sponsors: asArray(raw.sponsors).map((s) => ({
      bioguideId: s.bioguideId,
      fullName: s.fullName,
      party: s.party,
      state: s.state,
    })),
    committeesCount: raw.committees?.count ?? null,
    actionsCount: raw.actions?.count ?? null,
    summariesCount: raw.summaries?.count ?? summaries.length,
    summaries: summaries.map((item) => ({
      actionDate: item.actionDate || item.updateDate || null,
      actionDesc: item.actionDesc || item.text || null,
      updateDate: item.updateDate || null,
      text: item.text || item.actionDesc || null,
    })),
    congressGovUrl: raw.legislationUrl || congressGovBillUrl(congress, apiType, number),
    apiUrl: `https://api.congress.gov/v3/bill/${congress}/${apiType}/${number}?format=json`,
    updateDate: raw.updateDate || null,
  };
}

function normalizeAction(action) {
  return {
    actionDate: action.actionDate || null,
    actionTime: action.actionTime || null,
    actionCode: action.actionCode || null,
    type: action.type || null,
    text: action.text || null,
    sourceSystem: action.sourceSystem || null,
    committees: action.committees || null,
    recordedVotes: action.recordedVotes || null,
  };
}

function rememberBillRef(map, ref, manifest) {
  if (!ref) return;
  if (ref.kind === "bill") {
    const key = ref.key || billKey(ref.congress, ref.apiType, ref.number);
    if (!map.has(key)) map.set(key, { ...ref, key });
    return;
  }
  if (ref.kind === "nomination") manifest.counts.skippedNominations += 1;
  if (ref.kind === "treaty") manifest.counts.skippedTreaties += 1;
  const seen = manifest._seenNonBills || new Set();
  manifest._seenNonBills = seen;
  const stamp = `${ref.kind}:${ref.raw}`;
  if (seen.has(stamp)) return;
  seen.add(stamp);
  manifest.gaps.push({
    stage: "bill-ref",
    kind: ref.kind,
    raw: ref.raw,
    source: ref.source,
    message: `Skipped non-bill vote target (${ref.kind}); not downloaded as a bill`,
  });
}

function pushError(manifest, error) {
  manifest.errors.push({
    at: nowIso(),
    ...error,
  });
}

function summarize(manifest, dryRun) {
  const lines = [
    "",
    dryRun ? "Dry run complete (no data files written)." : `Finished with status=${manifest.status}.`,
    `Congress: ${manifest.congressName || manifest.congress}`,
    `Members listed/saved: ${manifest.counts.membersListed}/${manifest.counts.membersSaved}`,
    `House votes listed/saved: ${manifest.counts.houseVotesListed}/${manifest.counts.houseVotesSaved}`,
    `Senate votes listed/saved: ${manifest.counts.senateVotesListed}/${manifest.counts.senateVotesSaved}`,
    `Bills listed/saved: ${manifest.counts.billsListed}/${manifest.counts.billsSaved}`,
    `Skipped non-bills: ${manifest.counts.skippedNominations} nominations, ${manifest.counts.skippedTreaties} treaties`,
    `Files written/skipped: ${manifest.counts.filesWritten}/${manifest.counts.filesSkipped}`,
    `Gaps: ${manifest.gaps.length}  Errors: ${manifest.errors.length}`,
  ];
  if (!dryRun) lines.push("See data/manifest.json for details.");
  return lines.join("\n");
}
