# payrollcall-data

Local Node.js CLI that dumps the Congress.gov (and Senate LIS) datasets PayRollCall will need for a public web app: **sitting members, roll-call votes, bill text/titles, and bill outcomes**.

This repo is a **laptop tool**, not a website. It does not start a server and is not deployed anywhere. Clone it, put an API key in `.env`, and it writes JSON under `data/` for design review.

## What you get

For the current Congress (or `--congress N`):

1. Congress metadata (sessions, years)
2. Sitting members with Bioguide IDs, chamber, party, state, district, terms
3. **House** roll-call votes (all sessions), including per-member positions
4. **Senate** roll-call votes (all sessions), including per-member positions
5. **Bills referenced by those votes** — title, Congress.gov URL, latest action, full actions list (became law, referred to committee, cloture, …), laws if enacted, CRS summaries when they exist
6. `data/manifest.json` — congress number, timestamps, file counts, gaps/errors

## Get a free API key

Congress.gov is served through [api.data.gov](https://api.data.gov/). Sign up:

1. Open **https://api.congress.gov/sign-up/** (same form as https://api.data.gov/signup/)
2. Use any email; the key is emailed to you
3. Keep the key private — never commit it

Official cap: **5,000 requests per hour** per key. This tool throttles (~800ms between Congress.gov calls), retries HTTP 429, and **skips files it already wrote**, so you can interrupt and re-run. Do not use api.data.gov’s `DEMO_KEY` — it is capped at about 10 requests/hour, which is not enough for this dump.

Senate votes do **not** use the key. Congress.gov has House roll calls only; Senate member-level votes are XML from [senate.gov](https://www.senate.gov/general/XML.htm) (Senate LIS / bill clerk). See [LOC issue #249](https://github.com/LibraryOfCongress/api.congress.gov/issues/249).

## Install and run

Needs **Node.js 18+** (`node -v`).

```bash
git clone https://github.com/MikeMclaughlin/payrollcall-data.git
cd payrollcall-data
npm install
cp .env.example .env
# paste your key into .env:
# CONGRESS_GOV_API_KEY=xxxxxxxx
npm start
```

Equivalent: `node src/index.js` or `export CONGRESS_GOV_API_KEY=xxxxxxxx && npm start`.

### Useful flags

```bash
npm start -- --help
npm start -- --dry-run
npm start -- --members-only
npm start -- --skip-bills
npm start -- --congress 119
npm start -- --force            # re-download files that already exist
npm start -- --limit 5 -v       # tiny smoke run, log every HTTP call
```

`--limit` caps members **and** votes per chamber/session. Use it to sanity-check your key; do not use it for a design-review dump.

| Flag | Meaning |
| --- | --- |
| `--congress N` | Congress number. Default: current (`/v3/congress/current`) |
| `--members-only` | Metadata + members; skip votes and bills |
| `--skip-bills` | Votes only; do not fetch bill detail/actions/summaries |
| `--skip-house` / `--skip-senate` | Skip one chamber’s roll calls |
| `--dry-run` | Hit list endpoints, print counts, write nothing |
| `--force` | Ignore existing files and fetch again |
| `-v` / `--verbose` | Log each request URL (API key redacted) |

## `data/` layout

`data/` is gitignored (except the README). After a run:

```
data/
  manifest.json
  congress/119/
    meta.json
    members/index.json
    members/lis-index.json          # Senate LIS id → bioguide (best-effort)
    members/L000174.json
    house-votes/index.json
    house-votes/1/240.json          # vote metadata
    house-votes/1/240.members.json  # how each member voted
    senate-votes/index.json
    senate-votes/2/234.json
    senate-votes/2/234.members.json
    bills/index.json
    bills/hr/3633.json              # title, latest action, laws, summaries
    bills/hr/3633.actions.json      # committee, cloture, became law, …
```

Roll-call files are named with the **unpadded** number (`240.json`, not `00240.json`). Bill types are the Congress.gov API slugs: `hr`, `s`, `hjres`, `sjres`, `hconres`, `sconres`, `hres`, `sres`.

Full tree notes: [`data/README.md`](data/README.md).

### How to browse outcomes

- Vote result / question (including cloture) → `house-votes/.../{roll}.json` or `senate-votes/.../{roll}.json`
- Member-level Yea/Nay → the sibling `*.members.json`
- Bill latest action + `laws[]` (Public Law number when enacted) → `bills/{type}/{number}.json`
- Committee referrals, calendar, cloture, passed, became law → `bills/{type}/{number}.actions.json` (`type` / `text` / `actionDate`)

Senate XML uses LIS member ids (`S354`, …). `members/lis-index.json` maps those onto Bioguide IDs when last name + state uniquely match a sitting senator. House positions already include Bioguide IDs.

Nominations (`PN…`) and treaty documents on the Senate vote menu are **not** bills; they are counted in `manifest.json` and skipped for the bills folder.

## Runtime and size (read this)

A **full current-Congress dump is large and slow**. Rough 119th Congress ballpark (early/mid 2026, two sessions underway):

| Slice | Request volume | Why |
| --- | --- | --- |
| Members | ~550 | 1 list + 1 detail per sitting member |
| House votes | ~2 requests × ~300–700 votes/session | detail + member positions (House endpoint is beta) |
| Senate votes | 1 XML menu/session + 1 XML/vote | no Congress.gov key used |
| Bills | ~3 requests × unique measures on those votes | detail + actions + summaries |

Stay under 5,000 Congress.gov calls/hour. Default throttle is **800ms/request** (~4,500/hour). A first full run can take **on the order of one to a few hours**; a re-run is much faster because existing JSON is skipped.

Expect **tens to low hundreds of MB** of pretty-printed JSON. House `*.members.json` files are the bulk (one row per representative per vote).

Optional env knobs (see `.env.example`):

```
CONGRESS_GOV_MIN_INTERVAL_MS=800
SENATE_XML_MIN_INTERVAL_MS=150
```

If you hit 429s, the client waits and retries. If `X-Ratelimit-Remaining` drops to 2, it pauses 60 seconds.

## Idempotent re-runs

Safe to Ctrl+C and start again. Already-written member, vote, and bill files are skipped unless `--force`. `data/manifest.json` is rewritten at the end of every run (including interrupts).

## Develop / test (no API key)

```bash
npm test
node src/index.js --help
```

`npm start` without a key exits with the signup URL.

## Sources

- [Congress.gov API v3](https://api.congress.gov/) — members, congress, house-vote, bill, actions, summaries
- [LibraryOfCongress/api.congress.gov](https://github.com/LibraryOfCongress/api.congress.gov) — docs, 5,000/hour limit
- [Senate LIS XML](https://www.senate.gov/general/XML.htm) — Senate vote menus and per-vote member lists
- House clerk XML is linked from each House vote as `sourceDataURL` (`https://clerk.house.gov/evs/...`) but member positions are taken from the Congress.gov members endpoint
