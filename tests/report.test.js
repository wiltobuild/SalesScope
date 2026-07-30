import assert from "node:assert/strict";
import test from "node:test";

import { DIMENSIONS } from "../src/dimensions.js";
import { ingestRows } from "../src/parse.js";
import { buildReport, calculateBreakdown, calculatePeriodComparison, calculateProfit, calculateTotals } from "../src/report.js";
import { readCsvFixture } from "./helpers.js";

const superstore = await readCsvFixture("../Superstore.csv");
const parsedSuperstore = ingestRows(superstore);
const sample = await readCsvFixture("../sample-sales-data.csv");
const parsedSample = ingestRows(sample);

test("Superstore ingestion and December 2017 report preserve all regression anchors", () => {
  const { rows } = parsedSuperstore;
  const report = buildReport(rows, { granularity: "month", periodKey: "2017-12" });
  const totals = calculateTotals(rows);

  assert.equal(rows.length, 9994);
  assert.equal(totals.totalOrders, 5009);
  assert.equal(new Set(rows.map((row) => row.product)).size, 1850);
  assert.equal(new Set(rows.map((row) => row.customer)).size, 793);
  assert.equal(totals.totalRevenue, 2297200.86);
  assert.equal(calculateProfit(totals.totalRevenue, totals.totalCost).totalProfit, 286397.02);
  assert.equal(rows.filter((row) => row.isLoss).length, 1871);
  assert.equal(report.totals.totalRevenue, 83829.32);
  assert.equal(report.totals.totalOrders, 224);
  assert.equal(report.profit.profitMargin, 10.1);
  assert.equal(report.periodComparison.percentChange.revenue, -29.2);
  assert.equal(report.periodComparison.yearAgoPercentChange.revenue, -13.6);
  assert.deepEqual(Object.keys(report.breakdowns).length, 10);
  assert.equal(Object.keys(report.breakdowns).length + 5, 15);
});

test("Superstore breakdown margins and delivery-day fields retain their shape", () => {
  const report = buildReport(parsedSuperstore.rows, { granularity: "month", periodKey: "2017-12" });
  const marginFor = (dimension, value) => calculateBreakdown(parsedSuperstore.rows, dimension).find((item) => item.value === value).margin;
  const metricKeys = ["value", "revenue", "cost", "profit", "margin", "unitsSold", "orderCount", "averageDeliveryDays", "maximumDeliveryDays"];

  assert.equal(marginFor("promotion", "0% discount"), 29.5);
  assert.equal(marginFor("promotion", "30% discount"), -10);
  assert.equal(marginFor("promotion", "80% discount"), -180);
  assert.equal(marginFor("category", "Furniture"), 2.5);
  assert.equal(marginFor("category", "Office Supplies"), 17);
  assert.equal(marginFor("category", "Technology"), 17.4);
  assert.equal(marginFor("region", "West"), 14.9);
  assert.equal(marginFor("region", "Central"), 7.9);
  assert.ok(report.rows.filter((row) => row.deliveryDays !== undefined).every((row) => Number.isInteger(row.deliveryDays) && row.deliveryDays >= 0 && row.deliveryDays <= 7));
  Object.values(report.breakdowns).flat().forEach((item) => assert.deepEqual(Object.keys(item), metricKeys));
});

test("the earliest period has no phantom previous-period decline", () => {
  const periodKey = "2014-01";
  const comparison = calculatePeriodComparison(parsedSuperstore.rows, "month", periodKey);

  assert.equal(comparison.previousPeriodKey, null);
  assert.equal(comparison.percentChange.revenue, null);
});

test("the sample CSV remains dimension-free and has eight report sections", () => {
  const report = buildReport(parsedSample.rows, { granularity: "month", periodKey: "2026-01" }, {
    availableDimensionKeys: parsedSample.availableDimensionKeys,
  });
  const optionalKeys = DIMENSIONS.filter((dimension) => !dimension.required).map((dimension) => dimension.key);

  assert.equal(parsedSample.rows.length, 40);
  assert.equal(Object.keys(report.breakdowns).length + 5, 8);
  optionalKeys.forEach((key) => assert.equal(key in report.breakdowns, false));
});
