"use strict";

const salesFileInput = document.querySelector("#sales-file");
const uploadError = document.querySelector("#upload-error");
const selectedFileName = document.querySelector("#selected-file-name");
const generateReportButton = document.querySelector("#generate-report-button");
const downloadReportButton = document.querySelector("#download-report-button");
const reportOutput = document.querySelector(".report-output");
const reportHeadingHint = document.querySelector("#report-heading-hint");
const initialReportHeadingHint = reportHeadingHint.textContent;
const expectedColumns = [
  "Date",
  "Order ID",
  "Customer",
  "Product",
  "Quantity",
  "Revenue",
  "Cost",
  "Promotion",
];
const requiredColumns = expectedColumns.slice(0, 7);

let parsedSalesRows = [];
let invalidSalesRows = [];
let currentReport = null;

salesFileInput.addEventListener("change", handleFileInputChange);
generateReportButton.addEventListener("click", generateReport);
downloadReportButton.addEventListener("click", downloadCurrentReport);
document.querySelector("#reset-button").addEventListener("click", resetApp);

function resetApp() {
  salesFileInput.value = "";
  parsedSalesRows = [];
  invalidSalesRows = [];
  currentReport = null;
  clearSelectedFile();
  clearUploadError();
  setGenerateButtonEnabled(false);
  reportOutput.innerHTML = "";
  downloadReportButton.hidden = true;
  reportHeadingHint.textContent = initialReportHeadingHint;
}

function handleFileInputChange(event) {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  handleFileSelection(file);
}

async function handleFileSelection(file) {
  setGenerateButtonEnabled(false);

  if (!isSupportedFileType(file)) {
    clearSelectedFile();
    showUploadError("Please choose a CSV, XLS, or XLSX file.");
    return;
  }

  if (file.size === 0) {
    clearSelectedFile();
    showUploadError("This file is empty.");
    return;
  }

  clearUploadError();
  showSelectedFile(file);
  await parseAndValidateFile(file);
}

function isSupportedFileType(file) {
  // Extensions are normalized because file names may use uppercase letters.
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return [".csv", ".xls", ".xlsx"].includes(extension);
}

function showUploadError(message) {
  uploadError.textContent = message;
  uploadError.hidden = false;
}

function clearUploadError() {
  uploadError.textContent = "";
  uploadError.hidden = true;
}

function showSelectedFile(file) {
  selectedFileName.textContent = `Selected file: ${file.name}`;
}

function clearSelectedFile() {
  selectedFileName.textContent = "";
}

function setGenerateButtonEnabled(isEnabled) {
  generateReportButton.disabled = !isEnabled;
}

async function readFileAsRows(file) {
  const workbook = XLSX.read(await file.arrayBuffer());
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("The file does not contain a worksheet.");
  }

  const sheet = workbook.Sheets[firstSheetName];
  return {
    rawRows: XLSX.utils.sheet_to_json(sheet, { defval: "" }),
    headers: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })[0] || [],
  };
}

function normalizeHeaderName(header) {
  return String(header).trim().toLowerCase();
}

function normalizeHeaders(headers) {
  const headerMap = new Map();

  headers.forEach((header) => {
    const normalizedHeader = normalizeHeaderName(header);
    const expectedColumn = expectedColumns.find(
      (column) => normalizeHeaderName(column) === normalizedHeader,
    );

    if (expectedColumn && !headerMap.has(expectedColumn)) {
      headerMap.set(expectedColumn, String(header));
    }
  });

  return headerMap;
}

function validateRequiredColumns(headerMap) {
  return requiredColumns.filter((column) => !headerMap.has(column));
}

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function isBlankRow(rawRow, headerMap) {
  return expectedColumns.every((column) => {
    const sourceHeader = headerMap.get(column);
    return !sourceHeader || isEmptyValue(rawRow[sourceHeader]);
  });
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const serial = typeof value === "number" ? value : Number(String(value).trim());
  if (!isEmptyValue(value) && Number.isFinite(serial) && String(value).trim() !== "") {
    const parsedSerial = XLSX.SSF.parse_date_code(serial);
    if (parsedSerial) {
      return new Date(parsedSerial.y, parsedSerial.m - 1, parsedSerial.d);
    }
  }

  if (typeof value === "string" && value.trim()) {
    const dateString = value.trim();
    const plainDateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const slashDateMatch = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const parsedDate = plainDateMatch
      ? new Date(Number(plainDateMatch[1]), Number(plainDateMatch[2]) - 1, Number(plainDateMatch[3]))
      : slashDateMatch
        ? new Date(Number(slashDateMatch[3]), Number(slashDateMatch[1]) - 1, Number(slashDateMatch[2]))
        : new Date(dateString);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  }

  return null;
}

function parseNumber(value) {
  if (isEmptyValue(value)) {
    return null;
  }

  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function coerceRow(rawRow, headerMap) {
  const valueFor = (column) => rawRow[headerMap.get(column)];
  const date = parseDate(valueFor("Date"));
  const quantity = parseNumber(valueFor("Quantity"));
  const revenue = parseNumber(valueFor("Revenue"));
  const cost = parseNumber(valueFor("Cost"));

  if (!date || quantity === null || revenue === null || cost === null) {
    return null;
  }

  const promotionValue = headerMap.has("Promotion")
    ? String(valueFor("Promotion")).trim()
    : "";

  return {
    date,
    orderId: String(valueFor("Order ID")).trim(),
    customer: String(valueFor("Customer")).trim(),
    product: String(valueFor("Product")).trim(),
    quantity,
    revenue,
    cost,
    promotion: promotionValue || null,
  };
}

async function parseAndValidateFile(file) {
  parsedSalesRows = [];
  invalidSalesRows = [];
  setGenerateButtonEnabled(false);

  try {
    const { rawRows, headers } = await readFileAsRows(file);
    const headerMap = normalizeHeaders(headers);
    const missingColumns = validateRequiredColumns(headerMap);

    if (missingColumns.length) {
      showUploadError(`Missing required column(s): ${missingColumns.join(", ")}.`);
      return;
    }

    rawRows.forEach((rawRow) => {
      if (isBlankRow(rawRow, headerMap)) {
        return;
      }

      const row = coerceRow(rawRow, headerMap);
      if (row) {
        parsedSalesRows.push(row);
      } else {
        invalidSalesRows.push(rawRow);
      }
    });

    if (!parsedSalesRows.length) {
      showUploadError("No valid sales rows were found in this file.");
      return;
    }

    setGenerateButtonEnabled(true);

    if (invalidSalesRows.length) {
      showUploadError(
        `${invalidSalesRows.length} row${invalidSalesRows.length === 1 ? " was" : "s were"} skipped due to invalid dates or numbers.`,
      );
      return;
    }

    clearUploadError();
  } catch (error) {
    showUploadError(`Unable to read this file: ${error.message}`);
  }
}

const NO_PROMOTION_LABEL = "No promotion";

function getWeekStart(date) {
  const weekStart = new Date(date);
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;

  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function getWeekKey(date) {
  const weekStart = getWeekStart(date);
  const year = weekStart.getFullYear();
  const month = String(weekStart.getMonth() + 1).padStart(2, "0");
  const day = String(weekStart.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function groupRowsByProduct(rows) {
  const productGroups = new Map();

  rows.forEach((row) => {
    const group = productGroups.get(row.product) || [];
    group.push(row);
    productGroups.set(row.product, group);
  });

  return productGroups;
}

function groupRowsByCustomer(rows) {
  const customerGroups = new Map();

  rows.forEach((row) => {
    const group = customerGroups.get(row.customer) || [];
    group.push(row);
    customerGroups.set(row.customer, group);
  });

  return customerGroups;
}

function groupRowsByPromotion(rows) {
  const promotionGroups = new Map();

  rows.forEach((row) => {
    const promotionKey = row.promotion === null ? NO_PROMOTION_LABEL : row.promotion;
    const group = promotionGroups.get(promotionKey) || [];
    group.push(row);
    promotionGroups.set(promotionKey, group);
  });

  return promotionGroups;
}

function groupRowsByWeek(rows) {
  const weekGroups = new Map();

  rows.forEach((row) => {
    const weekKey = getWeekKey(row.date);
    const group = weekGroups.get(weekKey) || [];
    group.push(row);
    weekGroups.set(weekKey, group);
  });

  return weekGroups;
}

function getSortedWeekKeys(weekGroups) {
  return Array.from(weekGroups.keys()).sort();
}

function roundTo(value, decimalPlaces) {
  const multiplier = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function calculateTotals(rows) {
  const totals = rows.reduce(
    (result, row) => {
      result.totalRevenue += row.revenue;
      result.totalCost += row.cost;
      result.totalUnitsSold += row.quantity;
      result.orderIds.add(row.orderId);
      return result;
    },
    { totalRevenue: 0, totalCost: 0, totalUnitsSold: 0, orderIds: new Set() },
  );

  return {
    totalRevenue: roundTo(totals.totalRevenue, 2),
    totalCost: roundTo(totals.totalCost, 2),
    totalOrders: totals.orderIds.size,
    totalUnitsSold: totals.totalUnitsSold,
  };
}

function calculateProfit(totalRevenue, totalCost) {
  const totalProfit = roundTo(totalRevenue - totalCost, 2);

  return {
    totalProfit,
    profitMargin: totalRevenue === 0 ? 0 : roundTo((totalProfit / totalRevenue) * 100, 1),
  };
}

function calculateProductPerformance(rows) {
  return Array.from(groupRowsByProduct(rows), ([product, productRows]) => {
    const totals = calculateTotals(productRows);
    const { totalProfit } = calculateProfit(totals.totalRevenue, totals.totalCost);

    return {
      product,
      revenue: totals.totalRevenue,
      cost: totals.totalCost,
      profit: totalProfit,
      unitsSold: totals.totalUnitsSold,
      orderCount: totals.totalOrders,
    };
  }).sort((first, second) => second.revenue - first.revenue);
}

function calculateCustomerPerformance(rows) {
  return Array.from(groupRowsByCustomer(rows), ([customer, customerRows]) => {
    const totals = calculateTotals(customerRows);

    return {
      customer,
      revenue: totals.totalRevenue,
      unitsSold: totals.totalUnitsSold,
      orderCount: totals.totalOrders,
    };
  }).sort((first, second) => second.revenue - first.revenue);
}

function calculatePromotionPerformance(rows) {
  return Array.from(groupRowsByPromotion(rows), ([promotion, promotionRows]) => {
    const totals = calculateTotals(promotionRows);

    return {
      promotion,
      revenue: totals.totalRevenue,
      unitsSold: totals.totalUnitsSold,
      orderCount: totals.totalOrders,
    };
  }).sort((first, second) => second.revenue - first.revenue);
}

function calculateBestAndLowestSellingProducts(productPerformance) {
  if (!productPerformance.length) {
    return { bestSelling: null, lowestSelling: null };
  }

  const productsByUnitsSold = [...productPerformance].sort(
    (first, second) => second.unitsSold - first.unitsSold,
  );

  return {
    bestSelling: productsByUnitsSold[0],
    lowestSelling: productsByUnitsSold[productsByUnitsSold.length - 1],
  };
}

function calculateWeekComparison(rows) {
  const weekGroups = groupRowsByWeek(rows);
  const weekKeys = getSortedWeekKeys(weekGroups);
  const currentWeekKey = weekKeys.at(-1) || null;
  const previousWeekKey = weekKeys.at(-2) || null;
  const calculateWeekTotals = (weekRows) => {
    const totals = calculateTotals(weekRows);
    const { totalProfit } = calculateProfit(totals.totalRevenue, totals.totalCost);

    return { ...totals, totalProfit };
  };
  const currentWeekTotals = currentWeekKey
    ? calculateWeekTotals(weekGroups.get(currentWeekKey))
    : calculateWeekTotals([]);
  const previousWeekTotals = previousWeekKey
    ? calculateWeekTotals(weekGroups.get(previousWeekKey))
    : null;
  const percentChangeFor = (currentValue, previousValue) => {
    // A zero baseline has no meaningful percentage change.
    if (previousValue === 0) {
      return null;
    }

    return roundTo(((currentValue - previousValue) / previousValue) * 100, 1);
  };

  return {
    currentWeekKey,
    previousWeekKey,
    currentWeekTotals,
    previousWeekTotals,
    percentChange: previousWeekTotals
      ? {
          revenue: percentChangeFor(
            currentWeekTotals.totalRevenue,
            previousWeekTotals.totalRevenue,
          ),
          profit: percentChangeFor(
            currentWeekTotals.totalProfit,
            previousWeekTotals.totalProfit,
          ),
          orders: percentChangeFor(
            currentWeekTotals.totalOrders,
            previousWeekTotals.totalOrders,
          ),
          unitsSold: percentChangeFor(
            currentWeekTotals.totalUnitsSold,
            previousWeekTotals.totalUnitsSold,
          ),
        }
      : { revenue: null, profit: null, orders: null, unitsSold: null },
  };
}

function calculateAlerts(report) {
  const alerts = [];
  const revenueChange = report.weekComparison.percentChange.revenue;

  if (revenueChange !== null && revenueChange <= -20) {
    alerts.push({
      severity: "warning",
      message: `Revenue declined ${Math.abs(revenueChange).toFixed(1)}% from the previous week.`,
    });
  }

  if (report.profit.profitMargin < 10) {
    alerts.push({
      severity: "warning",
      message: `Profit margin is ${report.profit.profitMargin.toFixed(1)}%.`,
    });
  }

  if (invalidSalesRows.length > 0) {
    alerts.push({
      severity: "info",
      message: `${invalidSalesRows.length} row${invalidSalesRows.length === 1 ? " was" : "s were"} skipped due to invalid data.`,
    });
  }

  return alerts;
}

function buildReport(rows) {
  const totals = calculateTotals(rows);
  const profit = calculateProfit(totals.totalRevenue, totals.totalCost);
  const productPerformance = calculateProductPerformance(rows);
  const customerPerformance = calculateCustomerPerformance(rows);
  const promotionPerformance = calculatePromotionPerformance(rows);
  const { bestSelling, lowestSelling } = calculateBestAndLowestSellingProducts(productPerformance);
  const weekComparison = calculateWeekComparison(rows);
  const report = {
    totals,
    profit,
    productPerformance,
    customerPerformance,
    promotionPerformance,
    bestSelling,
    lowestSelling,
    weekComparison,
  };

  return { ...report, alerts: calculateAlerts(report) };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
}

function renderSummaryCards(report) {
  const cards = [
    ["Total Revenue", formatMoney(report.totals.totalRevenue)],
    ["Total Cost", formatMoney(report.totals.totalCost)],
    ["Total Profit", formatMoney(report.profit.totalProfit), `${formatPercent(report.profit.profitMargin)} margin`],
    ["Total Orders", report.totals.totalOrders.toLocaleString()],
    ["Total Units Sold", report.totals.totalUnitsSold.toLocaleString()],
    ["Best-Selling Product", report.bestSelling ? report.bestSelling.product : "—", report.bestSelling ? `${report.bestSelling.unitsSold.toLocaleString()} units sold` : ""],
    ["Lowest-Selling Product", report.lowestSelling ? report.lowestSelling.product : "—", report.lowestSelling ? `${report.lowestSelling.unitsSold.toLocaleString()} units sold` : ""],
  ];

  return `<section class="report-section"><h3>Summary</h3><div class="summary-grid">${cards.map(([label, value, detail]) => `<article class="summary-card"><span class="summary-card-label">${escapeHtml(label)}</span><strong class="summary-card-value">${escapeHtml(value)}</strong>${detail ? `<span class="summary-card-detail">${escapeHtml(detail)}</span>` : ""}</article>`).join("")}</div></section>`;
}

function renderWeekComparison(weekComparison) {
  if (!weekComparison.previousWeekKey) {
    return `<section class="report-section"><h3>Week-over-week comparison</h3><p class="report-empty-state">No previous week data to compare yet.</p></section>`;
  }

  const metrics = [
    ["Revenue", "totalRevenue", "revenue", formatMoney],
    ["Profit", "totalProfit", "profit", formatMoney],
    ["Orders", "totalOrders", "orders", (value) => value.toLocaleString()],
    ["Units sold", "totalUnitsSold", "unitsSold", (value) => value.toLocaleString()],
  ];
  const cards = metrics.map(([label, totalKey, changeKey, formatter]) => {
    const change = weekComparison.percentChange[changeKey];
    const changeClass = change === null || change === 0 ? "change-neutral" : change > 0 ? "change-positive" : "change-negative";
    const changeText = change === null ? "No percentage baseline" : `${change > 0 ? "+" : ""}${formatPercent(change)}`;
    return `<article class="comparison-card"><span class="comparison-label">${label}</span><p class="comparison-values">Current: ${formatter(weekComparison.currentWeekTotals[totalKey])}<br>Previous: ${formatter(weekComparison.previousWeekTotals[totalKey])}</p><span class="${changeClass}">${changeText}</span></article>`;
  }).join("");

  return `<section class="report-section"><h3>Week-over-week comparison</h3><p class="summary-card-detail">${escapeHtml(weekComparison.currentWeekKey)} compared with ${escapeHtml(weekComparison.previousWeekKey)}</p><div class="comparison-grid">${cards}</div></section>`;
}

function renderTable(headers, rows) {
  return `<div class="table-wrap"><table class="report-table"><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderProductTable(productPerformance) {
  const rows = productPerformance.map((product) => `<tr><td>${escapeHtml(product.product)}</td><td>${formatMoney(product.revenue)}</td><td>${formatMoney(product.cost)}</td><td>${formatMoney(product.profit)}</td><td>${product.unitsSold.toLocaleString()}</td><td>${product.orderCount.toLocaleString()}</td></tr>`).join("");
  return `<section class="report-section"><h3>Product performance</h3>${renderTable(["Product", "Revenue", "Cost", "Profit", "Units Sold", "Orders"], rows)}</section>`;
}

function renderCustomerTable(customerPerformance) {
  const rows = customerPerformance.map((customer) => `<tr><td>${escapeHtml(customer.customer)}</td><td>${formatMoney(customer.revenue)}</td><td>${customer.unitsSold.toLocaleString()}</td><td>${customer.orderCount.toLocaleString()}</td></tr>`).join("");
  return `<section class="report-section"><h3>Customer performance</h3>${renderTable(["Customer", "Revenue", "Units Sold", "Orders"], rows)}</section>`;
}

function renderPromotionSection(promotionPerformance) {
  const rows = promotionPerformance.map((promotion) => `<tr><td>${escapeHtml(promotion.promotion)}</td><td>${formatMoney(promotion.revenue)}</td><td>${promotion.unitsSold.toLocaleString()}</td><td>${promotion.orderCount.toLocaleString()}</td></tr>`).join("");
  return `<section class="report-section"><h3>Promotion performance</h3>${renderTable(["Promotion", "Revenue", "Units Sold", "Orders"], rows)}</section>`;
}

function renderAlerts(alerts) {
  const content = alerts.length
    ? `<ul class="alert-list">${alerts.map((alert) => `<li class="alert-item alert-${escapeHtml(alert.severity)}">${escapeHtml(alert.message)}</li>`).join("")}</ul>`
    : '<p class="report-empty-state">No major issues detected.</p>';
  return `<section class="report-section"><h3>Alerts</h3>${content}</section>`;
}

function renderReport(report) {
  return [
    renderAlerts(report.alerts),
    renderSummaryCards(report),
    renderWeekComparison(report.weekComparison),
    renderProductTable(report.productPerformance),
    renderCustomerTable(report.customerPerformance),
    renderPromotionSection(report.promotionPerformance),
  ].join("");
}

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
    ["Total Revenue", report.totals.totalRevenue],
    ["Total Cost", report.totals.totalCost],
    ["Total Profit", report.profit.totalProfit],
    ["Profit Margin (%)", report.profit.profitMargin],
    ["Total Orders", report.totals.totalOrders],
    ["Total Units Sold", report.totals.totalUnitsSold],
    ["Best-Selling Product", report.bestSelling?.product ?? ""],
    ["Lowest-Selling Product", report.lowestSelling?.product ?? ""],
  ]);

  const { weekComparison } = report;
  const weekRows = weekComparison.previousWeekKey
    ? [
        ["Revenue", weekComparison.currentWeekTotals.totalRevenue, weekComparison.previousWeekTotals.totalRevenue, weekComparison.percentChange.revenue],
        ["Profit", weekComparison.currentWeekTotals.totalProfit, weekComparison.previousWeekTotals.totalProfit, weekComparison.percentChange.profit],
        ["Orders", weekComparison.currentWeekTotals.totalOrders, weekComparison.previousWeekTotals.totalOrders, weekComparison.percentChange.orders],
        ["Units Sold", weekComparison.currentWeekTotals.totalUnitsSold, weekComparison.previousWeekTotals.totalUnitsSold, weekComparison.percentChange.unitsSold],
      ]
    : [["No previous week data to compare yet."]];
  addSection(
    "Week-over-Week Comparison",
    weekComparison.previousWeekKey ? ["Metric", "Current Week", "Previous Week", "% Change"] : null,
    weekRows,
  );

  addSection(
    "Product Performance",
    ["Product", "Revenue", "Cost", "Profit", "Units Sold", "Orders"],
    report.productPerformance.map((product) => [product.product, product.revenue, product.cost, product.profit, product.unitsSold, product.orderCount]),
  );
  addSection(
    "Customer Performance",
    ["Customer", "Revenue", "Units Sold", "Orders"],
    report.customerPerformance.map((customer) => [customer.customer, customer.revenue, customer.unitsSold, customer.orderCount]),
  );
  addSection(
    "Promotion Performance",
    ["Promotion", "Revenue", "Units Sold", "Orders"],
    report.promotionPerformance.map((promotion) => [promotion.promotion, promotion.revenue, promotion.unitsSold, promotion.orderCount]),
  );
  addSection(
    "Alerts",
    ["Severity", "Message"],
    report.alerts.length
      ? report.alerts.map((alert) => [alert.severity, alert.message])
      : [["None", "No major issues detected."]],
  );

  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

function getReportFileName(report) {
  const weekKey = report.weekComparison.currentWeekKey;

  if (weekKey) {
    return `salesscope-report-${weekKey}.csv`;
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `salesscope-report-${todayKey}.csv`;
}

function downloadCurrentReport() {
  if (!currentReport) {
    return;
  }

  const blob = new Blob([buildReportCsv(currentReport)], { type: "text/csv;charset=utf-8;" });
  const objectUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = objectUrl;
  downloadLink.download = getReportFileName(currentReport);
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function generateReport() {
  reportOutput.textContent = "Generating report...";

  window.setTimeout(() => {
    const report = buildReport(parsedSalesRows);
    currentReport = report;
    reportOutput.innerHTML = renderReport(report);
    downloadReportButton.hidden = false;
    reportHeadingHint.textContent = "Here's your generated report.";
  }, 0);
}
