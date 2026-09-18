export function parseArgs(argv) {
  const args = {
    congress: null,
    membersOnly: false,
    skipBills: false,
    skipHouse: false,
    skipSenate: false,
    dryRun: false,
    verbose: false,
    force: false,
    limit: null,
    help: false,
  };

  const tokens = argv.slice(2);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = () => {
      const value = tokens[i + 1];
      if (value == null || value.startsWith("-")) {
        throw new Error(`Missing value for ${token}`);
      }
      i += 1;
      return value;
    };

    switch (token) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--congress":
        args.congress = parseCongress(next());
        break;
      case "--members-only":
        args.membersOnly = true;
        break;
      case "--skip-bills":
        args.skipBills = true;
        break;
      case "--skip-house":
        args.skipHouse = true;
        break;
      case "--skip-senate":
        args.skipSenate = true;
        break;
      case "--dry-run":
      case "--dryrun":
        args.dryRun = true;
        break;
      case "-v":
      case "--verbose":
        args.verbose = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--limit":
        args.limit = parsePositiveInt(next(), "--limit");
        break;
      default: {
        const eq = token.match(/^--([a-z-]+)=(.*)$/);
        if (eq) {
          applyEquals(args, eq[1], eq[2]);
          break;
        }
        throw new Error(`Unknown argument: ${token}\n\n${helpText()}`);
      }
    }
  }

  return args;
}

function applyEquals(args, name, value) {
  switch (name) {
    case "congress":
      args.congress = parseCongress(value);
      break;
    case "limit":
      args.limit = parsePositiveInt(value, "--limit");
      break;
    default:
      throw new Error(`Unknown argument: --${name}=${value}`);
  }
}

function parseCongress(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 300) {
    throw new Error(`Invalid --congress value: ${value}`);
  }
  return n;
}

function parsePositiveInt(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${flag} value: ${value}`);
  }
  return n;
}

export function helpText() {
  return `payrollcall-data — download Congress.gov data for PayRollCall design review

Usage:
  npm start -- [options]
  node src/index.js [options]

Requires CONGRESS_GOV_API_KEY in the environment or a local .env file.

Options:
  --congress N       Congress number (default: current, from /v3/congress/current)
  --members-only     Fetch congress metadata + sitting members only
  --skip-bills       Do not download bills referenced by votes
  --skip-house       Skip House roll-call votes
  --skip-senate      Skip Senate roll-call votes (senate.gov XML)
  --dry-run          List what would be fetched; write no data files
  --force            Re-download files that already exist
  --limit N          Cap members and votes per chamber/session (smoke tests)
  -v, --verbose      Log every HTTP request
  -h, --help         Show this help

Examples:
  npm start
  npm start -- --members-only
  npm start -- --congress 119 --skip-bills -v
  npm start -- --dry-run --limit 5
`;
}
