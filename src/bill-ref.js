const TYPE_RULES = [
  { re: /^(?:h\.?\s*j\.?\s*res\.?|hjres)$/i, api: "hjres", display: "HJRES" },
  { re: /^(?:s\.?\s*j\.?\s*res\.?|sjres)$/i, api: "sjres", display: "SJRES" },
  { re: /^(?:h\.?\s*con\.?\s*res\.?|hconres)$/i, api: "hconres", display: "HCONRES" },
  { re: /^(?:s\.?\s*con\.?\s*res\.?|sconres)$/i, api: "sconres", display: "SCONRES" },
  { re: /^(?:h\.?\s*res\.?|hres)$/i, api: "hres", display: "HRES" },
  { re: /^(?:s\.?\s*res\.?|sres)$/i, api: "sres", display: "SRES" },
  { re: /^(?:h\.?\s*r\.?|hr)$/i, api: "hr", display: "HR" },
  { re: /^(?:s\.?)$/i, api: "s", display: "S" },
];

const COMBINED_RE =
  /\b(H\.?\s*J\.?\s*Res\.?|S\.?\s*J\.?\s*Res\.?|H\.?\s*Con\.?\s*Res\.?|S\.?\s*Con\.?\s*Res\.?|H\.?\s*Res\.?|S\.?\s*Res\.?|H\.?\s*R\.?|S\.)\s*([0-9]+)\b/i;

export function parseBillType(rawType) {
  if (rawType == null) return null;
  const text = String(rawType).trim();
  if (!text) return null;
  for (const rule of TYPE_RULES) {
    if (rule.re.test(text)) return { apiType: rule.api, displayType: rule.display };
  }
  return null;
}

export function parseBillRef({ type, number, congress, source } = {}) {
  if (isNomination(type, number)) {
    return {
      kind: "nomination",
      congress,
      raw: joinIssue(type, number),
      source,
    };
  }
  if (isTreaty(type, number)) {
    return {
      kind: "treaty",
      congress,
      raw: joinIssue(type, number),
      source,
    };
  }

  const parsedType = parseBillType(type);
  const n = normalizeNumber(number);
  if (!parsedType || n == null) return null;

  return {
    kind: "bill",
    congress: congress == null ? null : Number(congress),
    apiType: parsedType.apiType,
    displayType: parsedType.displayType,
    number: n,
    key: billKey(congress, parsedType.apiType, n),
    source,
  };
}

export function parseIssue(issue, { congress, source } = {}) {
  if (issue == null) return null;
  const text = String(issue).trim();
  if (!text) return null;
  if (/^PN/i.test(text) || /^PN/i.test(text.replace(/\s+/g, ""))) {
    return { kind: "nomination", congress, raw: text, source };
  }
  if (/^treaty/i.test(text)) {
    return { kind: "treaty", congress, raw: text, source };
  }
  const match = text.match(COMBINED_RE);
  if (!match) return null;
  return parseBillRef({ type: match[1], number: match[2], congress, source });
}

export function billKey(congress, apiType, number) {
  return `${congress}/${String(apiType).toLowerCase()}/${number}`;
}

export function congressOrdinal(n) {
  const v = Number(n);
  const mod100 = v % 100;
  const mod10 = v % 10;
  let suffix = "th";
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = "st";
    else if (mod10 === 2) suffix = "nd";
    else if (mod10 === 3) suffix = "rd";
  }
  return `${v}${suffix}`;
}

export function congressGovBillUrl(congress, apiType, number) {
  const slug = publicSlug(apiType);
  if (!slug) return null;
  return `https://www.congress.gov/bill/${congressOrdinal(congress)}-congress/${slug}/${number}`;
}

function publicSlug(apiType) {
  switch (String(apiType).toLowerCase()) {
    case "hr":
      return "house-bill";
    case "s":
      return "senate-bill";
    case "hjres":
      return "house-joint-resolution";
    case "sjres":
      return "senate-joint-resolution";
    case "hconres":
      return "house-concurrent-resolution";
    case "sconres":
      return "senate-concurrent-resolution";
    case "hres":
      return "house-resolution";
    case "sres":
      return "senate-resolution";
    default:
      return null;
  }
}

function normalizeNumber(number) {
  if (number == null || number === "") return null;
  const digits = String(number).replace(/^[^\d]*/, "").match(/\d+/);
  if (!digits) return null;
  return String(Number(digits[0]));
}

function isNomination(type, number) {
  const blob = `${type || ""} ${number || ""}`;
  return /\bPN\b/i.test(blob) || /^pn/i.test(String(type || "").trim());
}

function isTreaty(type, number) {
  const blob = `${type || ""} ${number || ""}`;
  return /treaty/i.test(blob);
}

function joinIssue(type, number) {
  return [type, number].filter((part) => part != null && part !== "").join(" ").trim();
}
