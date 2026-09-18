import assert from "node:assert/strict";
import test from "node:test";
import {
  congressGovBillUrl,
  congressOrdinal,
  parseBillRef,
  parseIssue,
} from "../src/bill-ref.js";

test("parses House and Senate bill types", () => {
  assert.deepEqual(parseBillRef({ type: "HR", number: "3424", congress: 119 }).apiType, "hr");
  assert.equal(parseBillRef({ type: "H.R.", number: "3633", congress: 119 }).key, "119/hr/3633");
  assert.equal(parseBillRef({ type: "S", number: "4668", congress: 119 }).apiType, "s");
  assert.equal(parseBillRef({ type: "HRES", number: "5", congress: 119 }).apiType, "hres");
  assert.equal(parseBillRef({ type: "H.J.Res.", number: "20", congress: 119 }).apiType, "hjres");
  assert.equal(parseBillRef({ type: "S.Con.Res.", number: "1", congress: 119 }).displayType, "SCONRES");
});

test("strips leading zeros on bill numbers", () => {
  assert.equal(parseBillRef({ type: "s", number: "007", congress: 118 }).number, "7");
});

test("classifies nominations and treaties", () => {
  assert.equal(parseIssue("PN1078", { congress: 119 }).kind, "nomination");
  assert.equal(parseIssue("PN999-4", { congress: 119 }).kind, "nomination");
  assert.equal(parseIssue("Treaty Doc. 119-1", { congress: 119 }).kind, "treaty");
});

test("parses combined issue strings from Senate menus", () => {
  const hr = parseIssue("H.R. 3633", { congress: 119 });
  assert.equal(hr.kind, "bill");
  assert.equal(hr.apiType, "hr");
  assert.equal(hr.number, "3633");

  const s = parseIssue("S. 4668", { congress: 119 });
  assert.equal(s.apiType, "s");
  assert.equal(s.number, "4668");

  const hres = parseIssue("H.Res. 12", { congress: 119 });
  assert.equal(hres.apiType, "hres");
});

test("congress.gov public URLs use ordinals", () => {
  assert.equal(congressOrdinal(119), "119th");
  assert.equal(congressOrdinal(21), "21st");
  assert.equal(congressOrdinal(22), "22nd");
  assert.equal(congressOrdinal(23), "23rd");
  assert.equal(congressOrdinal(12), "12th");
  assert.equal(
    congressGovBillUrl(119, "hr", "30"),
    "https://www.congress.gov/bill/119th-congress/house-bill/30",
  );
});
