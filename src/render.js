import { DIMENSIONS, TOP_ROW_COUNT } from "./dimensions.js";
import { escapeHtml, formatComparisonTitle, formatMoney, formatPercent } from "./format.js";
import { formatPeriodLabel } from "./report.js";
import { renderBreakdownChart, renderDiscountMarginChart, renderRevenueOverTimeChart } from "./charts.js";

function renderSummaryCards(report) {
  const cards = [
    ["Total Revenue", formatMoney(report.totals.totalRevenue)],
    ["Total Cost", formatMoney(report.totals.totalCost)],
    ["Total Profit", formatMoney(report.profit.totalProfit), `${formatPercent(report.profit.profitMargin)} margin`],
    ["Total Orders", report.totals.totalOrders.toLocaleString()],
    ["Total Units Sold", report.totals.totalUnitsSold.toLocaleString()],
    ["Best-Selling Product", report.bestSelling ? report.bestSelling.product : "—", report.bestSelling ? `${report.bestSelling.unitsSold.toLocaleString()} units sold` : ""],
    ["Biggest Loss-Maker", report.biggestLossMaker ? report.biggestLossMaker.value : "—", report.biggestLossMaker ? formatMoney(report.biggestLossMaker.profit) : ""],
  ];

  return renderReportSection("summary", "Summary", `<div class="summary-grid">${cards.map(([label, value, detail]) => `<article class="summary-card"><span class="summary-card-label">${escapeHtml(label)}</span><strong class="summary-card-value">${escapeHtml(value)}</strong>${detail ? `<span class="summary-card-detail">${escapeHtml(detail)}</span>` : ""}</article>`).join("")}</div>`);
}

function renderPeriodComparison(periodComparison, granularity) {
  const title = "Period comparison";
  const metrics = [
    ["Revenue", "totalRevenue", "revenue", formatMoney],
    ["Profit", "totalProfit", "profit", formatMoney],
    ["Orders", "totalOrders", "orders", (value) => value.toLocaleString()],
    ["Units sold", "totalUnitsSold", "unitsSold", (value) => value.toLocaleString()],
  ];
  const renderDelta = (changes, changeKey, baselineLabel) => {
    if (!changes) {
      return `<span class="comparison-delta change-neutral">${escapeHtml(baselineLabel)}: No comparison data</span>`;
    }

    const change = changes[changeKey];
    const changeClass = change === null || change === 0 ? "change-neutral" : change > 0 ? "change-positive" : "change-negative";
    const changeText = change === null ? "No percentage baseline" : `${change > 0 ? "+" : ""}${formatPercent(change)}`;
    return `<span class="comparison-delta ${changeClass}">${escapeHtml(baselineLabel)}: ${escapeHtml(changeText)}</span>`;
  };
  const currentLabel = escapeHtml(formatPeriodLabel(periodComparison.currentPeriodKey, granularity));
  const previousLabel = periodComparison.previousPeriodKey ? formatPeriodLabel(periodComparison.previousPeriodKey, granularity) : `previous ${granularity}`;
  const yearAgoLabel = periodComparison.yearAgoPeriodKey ? formatPeriodLabel(periodComparison.yearAgoPeriodKey, granularity) : `same ${granularity} last year`;

  const previousBaseline = `Vs previous ${granularity}: ${previousLabel}`;
  const yearAgoBaseline = `Vs same ${granularity} last year: ${yearAgoLabel}`;
  const cards = metrics.map(([label, totalKey, changeKey, formatter]) => (
    `<article class="comparison-card"><span class="comparison-label">${escapeHtml(label)}</span><strong class="comparison-current">${escapeHtml(formatter(periodComparison.currentPeriodTotals[totalKey]))}</strong>${renderDelta(periodComparison.percentChange, changeKey, previousBaseline)}${renderDelta(periodComparison.yearAgoPercentChange, changeKey, yearAgoBaseline)}</article>`
  )).join("");

  return renderReportSection("comparison", title, `<p class="summary-card-detail">${currentLabel}</p><div class="comparison-grid">${cards}</div>`);
}

function renderReportSection(sectionKey, title, content) {
  const isCollapsed = collapsedReportSections.has(sectionKey);
  const toggleLabel = isCollapsed ? `Expand ${title}` : `Collapse ${title}`;
  return `<section class="report-section ${isCollapsed ? "is-collapsed" : ""}"><div class="report-section-header"><h3>${escapeHtml(title)}</h3><button type="button" class="report-section-toggle" data-report-section="${escapeHtml(sectionKey)}" aria-expanded="${String(!isCollapsed)}">${isCollapsed ? "▸" : "▾"}<span class="visually-hidden">${escapeHtml(toggleLabel)}</span></button></div>${isCollapsed ? "" : content}</section>`;
}

function renderTable(headers, rows, sectionKey = null) {
  const sort = sectionKey ? state.tableSorts.get(sectionKey) || { column: "revenue", direction: "desc" } : null;
  const headingMarkup = headers.map((header) => {
    const [label, column] = Array.isArray(header) ? header : [header, null];
    if (!sectionKey || !column) {
      return `<th scope="col">${escapeHtml(label)}</th>`;
    }

    const isActive = sort.column === column;
    const direction = isActive ? sort.direction : "none";
    const arrow = isActive ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
    return `<th scope="col" aria-sort="${direction === "none" ? "none" : direction === "asc" ? "ascending" : "descending"}"><button type="button" class="table-sort" data-sort-section="${escapeHtml(sectionKey)}" data-sort-column="${escapeHtml(column)}">${escapeHtml(label)}${arrow}</button></th>`;
  }).join("");
  return `<div class="table-wrap"><table class="report-table"><thead><tr>${headingMarkup}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function sortedBreakdownItems(sectionKey, items) {
  const sort = state.tableSorts.get(sectionKey) || { column: "revenue", direction: "desc" };
  const multiplier = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((first, second) => {
    const firstValue = first[sort.column];
    const secondValue = second[sort.column];
    const comparison = typeof firstValue === "string"
      ? firstValue.localeCompare(secondValue)
      : firstValue - secondValue;
    return comparison * multiplier || first.value.localeCompare(second.value);
  });
}

function renderTruncatedSection(title, sectionKey, itemNoun, headers, items, renderRow) {
  const search = state.tableSearches.get(sectionKey) || "";
  const filteredItems = search
    ? items.filter((item) => item.value.toLowerCase().includes(search.toLowerCase()))
    : items;
  const sortedItems = sortedBreakdownItems(sectionKey, filteredItems);
  const isExpanded = state.expandedSections.has(sectionKey);
  const visibleItems = isExpanded ? sortedItems : sortedItems.slice(0, TOP_ROW_COUNT);
  const toggleLabel = isExpanded
    ? `Show top ${TOP_ROW_COUNT}`
    : `Show all ${sortedItems.length.toLocaleString()} ${itemNoun}`;
  const toggleButton = sortedItems.length > TOP_ROW_COUNT
    ? `<button type="button" class="table-toggle" data-section="${escapeHtml(sectionKey)}">${escapeHtml(toggleLabel)}</button>`
    : "";
  const searchInput = ["product", "customer"].includes(sectionKey)
    ? `<label class="table-search-label">Search ${escapeHtml(itemNoun)}<input type="search" data-table-search="${escapeHtml(sectionKey)}" value="${escapeHtml(search)}" placeholder="Search by name"></label>`
    : "";

  return renderReportSection(sectionKey, title, `${searchInput}${renderTable(headers, visibleItems.map(renderRow).join(""), sectionKey)}${toggleButton}`);
}

function renderBreakdownSection(dimension, items) {
  const isShipMode = dimension.key === "shipMode";
  const headers = [[dimension.label, "value"], ["Revenue", "revenue"], ["Cost", "cost"], ["Profit", "profit"], ["Margin", "margin"], ["Units Sold", "unitsSold"], ["Orders", "orderCount"]];

  if (isShipMode) {
    headers.push(["Average Delivery Days", "averageDeliveryDays"], ["Maximum Delivery Days", "maximumDeliveryDays"]);
  }

  const table = renderTruncatedSection(
    `${dimension.label} performance`,
    dimension.key,
    dimension.noun,
    headers,
    items,
    (item) => {
      const deliveryDays = isShipMode
        ? `<td>${item.averageDeliveryDays === null ? "â€”" : item.averageDeliveryDays.toFixed(1)}</td><td>${item.maximumDeliveryDays === null ? "â€”" : item.maximumDeliveryDays.toLocaleString()}</td>`
        : "";
      return `<tr class="breakdown-row" data-focus-dimension="${escapeHtml(dimension.key)}" data-focus-value="${escapeHtml(item.value)}" tabindex="0" title="Focus report on ${escapeHtml(item.value)}"><td>${escapeHtml(item.value)}</td><td>${formatMoney(item.revenue)}</td><td>${formatMoney(item.cost)}</td><td>${formatMoney(item.profit)}</td><td>${formatPercent(item.margin)}</td><td>${item.unitsSold.toLocaleString()}</td><td>${item.orderCount.toLocaleString()}</td>${deliveryDays}</tr>`;
    },
  );
  const hasDiscountBands = items.length > 0 && items.every(
    (item) => Number.isFinite(Number.parseFloat(item.value)),
  );
  const chart = dimension.key === "promotion" && hasDiscountBands
    ? renderDiscountMarginChart(items)
    : renderBreakdownChart(dimension, items);

  return table.replace('<div class="table-wrap">', `${chart}<div class="table-wrap">`);
}

function renderAlerts(alerts) {
  const content = alerts.length
    ? `<ul class="alert-list">${alerts.map((alert) => `<li class="alert-item alert-${escapeHtml(alert.severity)}">${escapeHtml(alert.message)}</li>`).join("")}</ul>`
    : '<p class="report-empty-state">No major issues detected.</p>';
  return renderReportSection("alerts", "Alerts", content);
}

function renderCustomerIntelligence(intelligence, state) {
  const concentration = `<div class="summary-grid customer-kpis">${intelligence.concentration.map((item) => `<article class="summary-card"><span class="summary-card-label">Top ${item.percent}% of customers</span><strong class="summary-card-value">${formatPercent(item.revenueShare)}</strong><span class="summary-card-detail">of revenue</span></article>`).join("")}</div>`;
  const renderIntelligenceTable = (sectionKey, itemNoun, headers, items, emptyRow, renderRow) => {
    const isExpanded = state.expandedSections.has(sectionKey);
    const visibleItems = isExpanded ? items : items.slice(0, TOP_ROW_COUNT);
    const rows = items.length ? visibleItems.map(renderRow).join("") : emptyRow;
    const toggleLabel = isExpanded
      ? `Show top ${TOP_ROW_COUNT}`
      : `Show all ${items.length.toLocaleString()} ${itemNoun}`;
    const toggle = items.length > TOP_ROW_COUNT
      ? `<button type="button" class="table-toggle" data-section="${escapeHtml(sectionKey)}">${escapeHtml(toggleLabel)}</button>`
      : "";
    return `${renderTable(headers, rows)}${toggle}`;
  };
  const atRiskTable = renderIntelligenceTable(
    "at-risk-customers",
    "customers",
    ["Customer", "Previous Revenue", "Previous Orders"],
    intelligence.atRisk,
    '<tr><td colspan="3">No at-risk customers in the previous period.</td></tr>',
    (customer) => `<tr><td>${escapeHtml(customer.value)}</td><td>${escapeHtml(formatMoney(customer.revenue))}</td><td>${escapeHtml(customer.orderCount.toLocaleString())}</td></tr>`,
  );
  const unprofitableTable = renderIntelligenceTable(
    "unprofitable-customers",
    "customers",
    ["Customer", "Profit", "Revenue"],
    intelligence.unprofitable,
    '<tr><td colspan="3">No unprofitable customers in this period.</td></tr>',
    (customer) => `<tr><td>${escapeHtml(customer.value)}</td><td>${escapeHtml(formatMoney(customer.profit))}</td><td>${escapeHtml(formatMoney(customer.revenue))}</td></tr>`,
  );
  return renderReportSection("customer-intelligence", "Customer intelligence", `${concentration}<div class="intelligence-tables"><div><h4>At-risk customers</h4><p class="summary-card-detail">Top previous-period customers who did not order this period.</p>${atRiskTable}</div><div><h4>Unprofitable customers (${intelligence.unprofitable.length.toLocaleString()})</h4>${unprofitableTable}</div></div>`);
}

function renderRevenueOverTimeTable(report, state) {
  const sectionKey = "revenue-over-time";
  const isExpanded = state.expandedSections.has(sectionKey);
  const periods = report.revenueByPeriod;
  const visiblePeriods = isExpanded ? periods : periods.slice(-12);
  const toggleLabel = isExpanded
    ? "Show recent 12 periods"
    : `Show all ${periods.length.toLocaleString()} periods`;
  const toggleButton = periods.length > 12
    ? `<button type="button" class="table-toggle" data-section="${escapeHtml(sectionKey)}">${escapeHtml(toggleLabel)}</button>`
    : "";
  const rows = visiblePeriods.map((point) => (
    `<tr><td>${escapeHtml(formatPeriodLabel(point.key, report.granularity))}</td><td>${escapeHtml(formatMoney(point.revenue))}</td></tr>`
  )).join("");

  return `${renderTable(["Period", "Revenue"], rows)}${toggleButton}`;
}

function renderReport(report, state) {
  return [
    renderAlerts(report.alerts),
    renderSummaryCards(report),
    renderCustomerIntelligence(report.customerIntelligence, state),
    renderReportSection("revenue-over-time", "Revenue over time", `${renderRevenueOverTimeChart(report)}${renderRevenueOverTimeTable(report, state)}`),
    renderPeriodComparison(report.periodComparison, report.granularity),
    ...DIMENSIONS.filter((dimension) => report.breakdowns[dimension.key]).map(
      (dimension) => renderBreakdownSection(dimension, report.breakdowns[dimension.key]),
    ),
  ].join("");
}

export { formatComparisonTitle, renderSummaryCards, renderPeriodComparison, renderReportSection, renderTable, sortedBreakdownItems, renderTruncatedSection, renderBreakdownSection, renderAlerts, renderCustomerIntelligence, renderRevenueOverTimeTable, renderReport };

