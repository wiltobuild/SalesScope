import { DIMENSIONS } from "./dimensions.js";
import { formatComparisonTitle } from "./format.js";
import { formatPeriodLabel } from "./report.js";

function csvEscape(value) {
  const stringValue = String(value ?? "");

  return /[",\r\n]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue;
}

function buildReportCsv(report) {
  const rows = [];
  const addSection = (title, headerRow, dataRows) => {
    rows.push([title]);

    if (headerRow) {
      rows.push(headerRow);
    }

    rows.push(...dataRows, []);
  };

  addSection("Summary", ["Metric", "Value"], [
    ["Period", formatPeriodLabel(report.periodKey, report.granularity)],
    ["Total Revenue", report.totals.totalRevenue],
    ["Total Cost", report.totals.totalCost],
    ["Total Profit", report.profit.totalProfit],
    ["Profit Margin (%)", report.profit.profitMargin],
    ["Total Orders", report.totals.totalOrders],
    ["Total Units Sold", report.totals.totalUnitsSold],
    ["Best-Selling Product", report.bestSelling?.product ?? ""],
    ["Biggest Loss-Maker", report.biggestLossMaker?.value ?? ""],
    ["Biggest Loss-Maker Profit", report.biggestLossMaker?.profit ?? ""],
  ]);

  const { periodComparison } = report;
  const comparisonRows = periodComparison.previousPeriodKey
    ? [
        ["Revenue", periodComparison.currentPeriodTotals.totalRevenue, periodComparison.previousPeriodTotals.totalRevenue, periodComparison.percentChange.revenue],
        ["Profit", periodComparison.currentPeriodTotals.totalProfit, periodComparison.previousPeriodTotals.totalProfit, periodComparison.percentChange.profit],
        ["Orders", periodComparison.currentPeriodTotals.totalOrders, periodComparison.previousPeriodTotals.totalOrders, periodComparison.percentChange.orders],
        ["Units Sold", periodComparison.currentPeriodTotals.totalUnitsSold, periodComparison.previousPeriodTotals.totalUnitsSold, periodComparison.percentChange.unitsSold],
      ]
    : [[`No comparison data to compare yet.`]];
  addSection(
    formatComparisonTitle(report.granularity),
    periodComparison.previousPeriodKey
      ? [`Metric`, `Current ${report.granularity}`, `Previous ${report.granularity}`, "% Change"]
      : null,
    comparisonRows,
  );

  const yearAgoRows = periodComparison.yearAgoPeriodKey
    ? [
        ["Revenue", periodComparison.currentPeriodTotals.totalRevenue, periodComparison.yearAgoTotals.totalRevenue, periodComparison.yearAgoPercentChange.revenue],
        ["Profit", periodComparison.currentPeriodTotals.totalProfit, periodComparison.yearAgoTotals.totalProfit, periodComparison.yearAgoPercentChange.profit],
        ["Orders", periodComparison.currentPeriodTotals.totalOrders, periodComparison.yearAgoTotals.totalOrders, periodComparison.yearAgoPercentChange.orders],
        ["Units Sold", periodComparison.currentPeriodTotals.totalUnitsSold, periodComparison.yearAgoTotals.totalUnitsSold, periodComparison.yearAgoPercentChange.unitsSold],
      ]
    : [[`No same ${report.granularity} last year data to compare yet.`]];
  addSection(
    `Year-over-year ${report.granularity} comparison`,
    periodComparison.yearAgoPeriodKey
      ? ["Metric", `Current ${report.granularity}`, `Same ${report.granularity} last year`, "% Change"]
      : null,
    yearAgoRows,
  );

  addSection(
    "Customer Concentration",
    ["Customer Group", "Revenue Share (%)"],
    report.customerIntelligence.concentration.map((item) => [`Top ${item.percent}%`, item.revenueShare]),
  );
  addSection(
    "At-Risk Customers",
    ["Customer", "Previous Period Revenue", "Previous Period Orders"],
    report.customerIntelligence.atRisk.length
      ? report.customerIntelligence.atRisk.map((customer) => [customer.value, customer.revenue, customer.orderCount])
      : [["None", "", ""]],
  );
  addSection(
    "Unprofitable Customers",
    ["Customer", "Profit", "Revenue"],
    report.customerIntelligence.unprofitable.length
      ? report.customerIntelligence.unprofitable.map((customer) => [customer.value, customer.profit, customer.revenue])
      : [["None", "", ""]],
  );

  DIMENSIONS.filter((dimension) => report.breakdowns[dimension.key]).forEach((dimension) => {
    const isShipMode = dimension.key === "shipMode";
    addSection(
      `${dimension.label} Performance`,
      [dimension.label, "Revenue", "Cost", "Profit", "Margin (%)", "Units Sold", "Orders"].concat(
        isShipMode ? ["Average Delivery Days", "Maximum Delivery Days"] : [],
      ),
      report.breakdowns[dimension.key].map((item) => [
        item.value,
        item.revenue,
        item.cost,
        item.profit,
        item.margin,
        item.unitsSold,
        item.orderCount,
      ].concat(isShipMode ? [item.averageDeliveryDays ?? "", item.maximumDeliveryDays ?? ""] : [])),
    );
  });
  addSection(
    "Alerts",
    ["Severity", "Message"],
    report.alerts.length
      ? report.alerts.map((alert) => [alert.severity, alert.message])
      : [["None", "No major issues detected."]],
  );

  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}



export { buildReportCsv };

