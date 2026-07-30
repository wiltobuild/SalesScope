import assert from "node:assert/strict";
import test from "node:test";

import { buildReportCsv } from "../src/csv.js";
import { DIMENSIONS } from "../src/dimensions.js";
import { ingestRows } from "../src/parse.js";
import { buildReport, calculateBreakdown } from "../src/report.js";
import { renderReport } from "../src/render.js";
import { createAppState } from "../src/state.js";
import { renderBreakdownChart, renderDiscountMarginChart, renderRevenueOverTimeChart } from "../src/charts.js";
import { assertSvgNumbersAreWithinViewBox, readCsvFixture } from "./helpers.js";

const superstore = ingestRows(await readCsvFixture("../Superstore.csv"));

test("CSV export includes all sections and all summary fields even when tables are truncated on screen", () => {
  const report = buildReport(superstore.rows, { granularity: "month", periodKey: "2017-12" });
  const csv = buildReportCsv(report);

  ["Summary", "Month-over-month comparison", "Year-over-year month comparison", "Customer Concentration", "At-Risk Customers", "Unprofitable Customers", "Product Performance", "Customer Performance", "Promotion Performance", "Category Performance", "Sub-Category Performance", "Region Performance", "State Performance", "City Performance", "Segment Performance", "Ship Mode Performance", "Alerts"].forEach((section) => assert.match(csv, new RegExp(`(?:^|\\r\\n)${section}`)));
  ["Total Revenue", "Total Cost", "Total Profit", "Profit Margin (%)", "Total Orders", "Total Units Sold"].forEach((field) => assert.ok(csv.includes(`${field},`)));
  assert.match(csv, /Hewlett Packard LaserJet 3310 Copier/);
});

test("charts have finite in-bounds coordinates and clamped discount bars mark overflow", () => {
  const report = buildReport(superstore.rows, { granularity: "month", periodKey: "2017-12" });
  const revenueChart = renderRevenueOverTimeChart(report);
  const discountChart = renderDiscountMarginChart([
    { value: "0% discount", margin: 30 },
    { value: "80% discount", margin: -900 },
  ]);

  assertSvgNumbersAreWithinViewBox(revenueChart);
  assertSvgNumbersAreWithinViewBox(discountChart, { height: 260 });
  assert.match(discountChart, /<polygon points=/);
  assert.doesNotMatch(revenueChart, /y="220"[^>]*><\/text><text x="[^\"]+" y="220"/);
});

test("negative revenue stays within the line-chart viewBox and below the zero baseline", async () => {
  const refunds = ingestRows(await readCsvFixture("./fixtures/refunds.csv"));
  const report = buildReport(refunds.rows, { granularity: "month", periodKey: "2026-01" });
  const chart = renderRevenueOverTimeChart(report);
  const path = chart.match(/<path d="([^"]+)"/)[1];
  const yValues = [...path.matchAll(/,([\d.]+)/g)].map((match) => Number(match[1]));

  assertSvgNumbersAreWithinViewBox(chart);
  assert.ok(Math.max(...yValues) > 109.5);
});

test("renderReport works without globals when given view state", () => {
  const report = buildReport(superstore.rows, { granularity: "month", periodKey: "2017-12" });

  assert.equal("collapsedCharts" in globalThis, false);
  assert.equal("collapsedReportSections" in globalThis, false);
  assert.equal("state" in globalThis, false);
  assert.doesNotThrow(() => renderReport(report, createAppState()));
});

test("bars start after their axis labels in every bar chart", () => {
  const report = buildReport(superstore.rows, { granularity: "month", periodKey: "2017-12" });
  const charts = [
    renderDiscountMarginChart(report.breakdowns.promotion),
    ...Object.entries(report.breakdowns)
      .filter(([key]) => key !== "promotion")
      .map(([key, items]) => renderBreakdownChart(DIMENSIONS.find((dimension) => dimension.key === key), items)),
  ];

  charts.forEach((chart) => {
    const labelEdges = [...chart.matchAll(/<text x="(\d+(?:\.\d+)?)"[^>]*class="chart-label">(?:<title>.*?<\/title>)?([^<]*)<\/text>/g)]
      .map(([, x, label]) => Number(x) + label.length * 8);
    const barStarts = [...chart.matchAll(/<rect x="(\d+(?:\.\d+)?)"/g)].map(([, x]) => Number(x));

    assert.ok(Math.min(...barStarts) >= Math.max(...labelEdges));
  });
});

test("discount-band and Office Supplies margins retain the expected cliff", () => {
  const marginFor = (dimension, value) => calculateBreakdown(superstore.rows, dimension).find((item) => item.value === value).margin;

  assert.equal(marginFor("promotion", "0% discount"), 29.5);
  assert.equal(marginFor("promotion", "30% discount"), -10.0);
  assert.equal(marginFor("promotion", "80% discount"), -180.0);
  assert.equal(marginFor("category", "Office Supplies"), 17.0);
});
