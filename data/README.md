# `/data` dump layout

This folder is **gitignored** except for this README. Run `npm start` with a Congress.gov API key to populate it.

Nothing here is the PayRollCall web app — it is a local JSON dump for design review.

## Tree

```
data/
  manifest.json                          # run summary: congress, timestamps, counts, gaps/errors
  congress/
    {N}/
      meta.json                          # /v3/congress/{N} (sessions, years)
      members/
        index.json                       # sitting members, light records
        lis-index.json                   # Senate LIS id → bioguide (best-effort)
        {bioguide}.json                  # full member (chamber, party, state, district, terms)
      house-votes/
        index.json                       # all House roll calls this Congress
        {session}/
          {roll}.json                    # vote metadata (question, result, bill, party totals)
          {roll}.members.json            # per-member positions (bioguide + voteCast)
      senate-votes/
        index.json                       # all Senate roll calls this Congress (from senate.gov XML)
        {session}/
          {roll}.json                    # vote metadata (cloture, nomination, bill, totals)
          {roll}.members.json            # per-member positions (LIS id, bioguide if mapped)
      bills/
        index.json                       # bills referenced by those votes
        {type}/                          # hr, s, hjres, sjres, hconres, sconres, hres, sres
          {number}.json                  # title, latest action, laws, summaries, congress.gov URL
          {number}.actions.json          # full actions list (became law, committee, cloture, …)
```

`{N}` is the Congress number (119 as of 2025–2026). `{session}` is `1` or `2`. `{roll}` is the roll-call number with no padding (`240.json`, not `00240.json`).

## Sources

| Path | Source |
| --- | --- |
| `meta.json`, `members/`, `house-votes/`, `bills/` | [Congress.gov API v3](https://api.congress.gov/) |
| `senate-votes/` | Senate LIS XML on [senate.gov](https://www.senate.gov/general/XML.htm) — **not** in Congress.gov yet |

House member-level votes are the `/v3/house-vote/{congress}/{session}/{voteNumber}/members` endpoint (beta). Senate member-level votes are each `vote_{congress}_{session}_{roll}.xml` file; Congress.gov has no Senate roll-call API ([tracking issue](https://github.com/LibraryOfCongress/api.congress.gov/issues/249)).

Nominations (`PN…`) and treaty documents that appear on Senate vote menus are recorded in `manifest.json` as skipped bill refs — they are not bills.

## Re-runs

Files that already exist are skipped unless you pass `--force`. Safe to interrupt and start again.
