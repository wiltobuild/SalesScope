import test from "node:test";
import assert from "node:assert/strict";
import {
  validDate,
  moneyValue,
  validateRecord,
  metrics,
  riskReasons,
  defaultSettings,
} from "../src/domain.js";
test("calendar validation rejects rollover dates and ambiguous formats", () => {
  assert.equal(validDate("2026-02-31"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("10/12/2026"), false);
});
test("money parses explicit US formatted numbers without silently interpreting a foreign locale", () => {
  assert.equal(moneyValue("$1,200.00"), 1200);
  assert.equal(moneyValue("1.200,00"), null);
  assert.equal(moneyValue(""), null);
  assert.equal(moneyValue("1,2"), null);
});
test("record validation requires meaningful data and known ownership", () => {
  assert.throws(
    () =>
      validateRecord("leads", { name: " ", ownerId: "me" }, defaultSettings, [
        "me",
      ]),
    /required/,
  );
  assert.throws(
    () =>
      validateRecord(
        "deals",
        {
          name: "x",
          ownerId: "me",
          amount: 5,
          stage: "Won",
          closeDate: "2026-02-31",
        },
        defaultSettings,
        ["me"],
      ),
    /real date/,
  );
  assert.throws(
    () =>
      validateRecord(
        "deals",
        {
          name: "x",
          ownerId: "me",
          amount: 5,
          stage: "Lost",
          closeDate: "2026-02-28",
        },
        defaultSettings,
        ["me"],
      ),
    /reason/,
  );
});
test("quarter forecasts use actual won dates and mutually exclusive open categories", () => {
  const d = (amount, stage, closeDate, forecast, closedAt) => ({
    amount,
    stage,
    closeDate,
    forecast,
    closedAt,
  });
  const rows = [
    d(100, "Won", "2026-09-01", "Commit", "2026-10-02T12:00:00Z"),
    d(200, "Won", "2026-10-01", "Commit", "2026-09-02T12:00:00Z"),
    d(50, "Negotiation", "2026-11-01", "Commit"),
    d(25, "Proposal", "2026-12-01", "Best case"),
    d(999, "Discovery", "2027-01-01", "Commit"),
    d(20, "Lost", "2026-10-01", "Omitted", "2026-10-04T12:00:00Z"),
  ];
  const m = metrics(rows, { ...defaultSettings, target: 300 }, "2026-10-12");
  assert.equal(m.booked, 100);
  assert.equal(m.commit, 150);
  assert.equal(m.bestCase, 175);
  assert.equal(m.quarterPipeline, 75);
  assert.equal(m.winRate, 50);
  assert.equal(m.gap, 200);
  assert.equal(m.coverage, 0.375);
});
test("missing data and inactivity are explained without flagging closed deals", () => {
  const d = {
    id: "d",
    stage: "Discovery",
    closeDate: "2026-11-01",
    nextStep: "Call",
    nextDate: "2026-10-10",
    lastContact: "2026-09-01",
  };
  assert.deepEqual(riskReasons(d, [], defaultSettings, "2026-10-12"), [
    "Next step overdue",
    "No recent customer contact",
  ]);
  assert.deepEqual(
    riskReasons({ ...d, stage: "Won" }, [], defaultSettings, "2026-10-12"),
    [],
  );
});
