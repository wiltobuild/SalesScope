"use strict";

const salesFileInput = document.querySelector("#sales-file");
const uploadError = document.querySelector("#upload-error");
const selectedFileName = document.querySelector("#selected-file-name");
const generateReportButton = document.querySelector("#generate-report-button");
const downloadReportButton = document.querySelector("#download-report-button");
const loadSuperstoreButton = document.querySelector("#load-superstore-button");
const fetchSuperstoreButton = document.querySelector("#fetch-superstore-button");
const apiStatus = document.querySelector("#api-status");
const reportOutput = document.querySelector(".report-output");
const reportHeadingHint = document.querySelector("#report-heading-hint");
const reportControls = document.querySelector("#report-controls");
const granularitySelect = document.querySelector("#granularity-select");
const periodSelect = document.querySelector("#period-select");
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
// Cost is absent because it can be satisfied by either a Cost or a Profit column.
const requiredColumns = [
  "Date",
  "Order ID",
  "Customer",
  "Product",
  "Quantity",
  "Revenue",
];
// Profit and Discount are alternative inputs, not report fields: Profit stands in for a
// missing Cost, and Discount stands in for a missing Promotion.
const optionalSourceColumns = ["Profit", "Discount"];
const DIMENSIONS = [
  { key: "product", label: "Product", noun: "products", synonyms: ["product", "product name", "product_name", "item", "item name"], required: true },
  { key: "customer", label: "Customer", noun: "customers", synonyms: ["customer", "customer name", "customer_name", "client", "client name"], required: true },
  { key: "promotion", label: "Promotion", noun: "promotions", synonyms: ["promotion", "promo", "campaign"], required: true },
  { key: "category", label: "Category", noun: "categories", synonyms: ["category"] },
  { key: "subCategory", label: "Sub-Category", noun: "sub-categories", synonyms: ["sub-category", "subcategory", "sub category"] },
  { key: "region", label: "Region", noun: "regions", synonyms: ["region"] },
  { key: "state", label: "State", noun: "states", synonyms: ["state", "province"] },
  { key: "city", label: "City", noun: "cities", synonyms: ["city", "town"] },
  { key: "segment", label: "Segment", noun: "segments", synonyms: ["segment", "customer segment"] },
  { key: "shipMode", label: "Ship Mode", noun: "ship modes", synonyms: ["ship mode", "shipping mode", "ship_mode"] },
];
const headerSynonyms = {
  Date: ["date", "order date", "order_date", "sale date", "transaction date"],
  "Order ID": ["order id", "order_id", "orderid", "order #", "order number"],
  Customer: DIMENSIONS.find((dimension) => dimension.key === "customer").synonyms,
  Product: DIMENSIONS.find((dimension) => dimension.key === "product").synonyms,
  Quantity: ["quantity", "qty", "units sold", "units_sold", "unit sold", "units"],
  Revenue: ["revenue", "sales", "total revenue", "amount", "sales amount"],
  Cost: ["cost", "total cost", "total_cost", "cogs"],
  Promotion: DIMENSIONS.find((dimension) => dimension.key === "promotion").synonyms,
  Profit: ["profit", "total profit", "margin", "gross profit"],
  Discount: ["discount"],
  "Ship Date": ["ship date", "ship_date", "shipping date"],
};
DIMENSIONS.filter((dimension) => !dimension.required).forEach((dimension) => {
  headerSynonyms[dimension.label] = dimension.synonyms;
});
const NO_PROMOTION_LABEL = "No promotion";
const TOP_ROW_COUNT = 10;
// Kaggle serves this dataset with Access-Control-Allow-Origin: *, so the browser can
// call it directly - no backend, no proxy, and no API key.
const KAGGLE_DATASET_URL =
  "https://www.kaggle.com/api/v1/datasets/download/vivek468/superstore-dataset-final";
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;

let parsedSalesRows = [];
let invalidSalesRows = [];
let currentReport = null;
let selectedGranularity = "month";
let selectedPeriodKey = null;
let availableDimensionKeys = new Set();
const expandedSections = new Set();

salesFileInput.addEventListener("change", handleFileInputChange);
loadSuperstoreButton.addEventListener("click", loadSuperstoreData);
fetchSuperstoreButton.addEventListener("click", fetchSuperstoreFromApi);
generateReportButton.addEventListener("click", generateReport);
downloadReportButton.addEventListener("click", downloadCurrentReport);
document.querySelector("#reset-button").addEventListener("click", resetApp);
granularitySelect.addEventListener("change", handleGranularityChange);
periodSelect.addEventListener("change", handlePeriodChange);
// The report HTML is replaced wholesale on every render, so per-button listeners would
// not survive. One delegated listener on the container does.
reportOutput.addEventListener("click", handleReportOutputClick);

function resetApp() {
  salesFileInput.value = "";
  parsedSalesRows = [];
  invalidSalesRows = [];
  currentReport = null;
  selectedGranularity = "month";
  selectedPeriodKey = null;
  availableDimensionKeys.clear();
  expandedSections.clear();
  clearSelectedFile();
  clearUploadError();
  setApiStatus("");
  setGenerateButtonEnabled(false);
  reportOutput.innerHTML = "";
  downloadReportButton.hidden = true;
  reportControls.hidden = true;
  granularitySelect.value = "month";
  periodSelect.innerHTML = "";
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

function clearSelectedFile() {
  selectedFileName.textContent = "";
}

function setGenerateButtonEnabled(isEnabled) {
  generateReportButton.disabled = !isEnabled;
}

function workbookToRows(workbook) {
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

async function readFileAsRows(file) {
  return workbookToRows(XLSX.read(await file.arrayBuffer()));
}

function readCsvTextAsRows(csvText) {
  return workbookToRows(XLSX.read(csvText, { type: "string" }));
}

function normalizeHeaderName(header) {
  return String(header).trim().toLowerCase();
}

function normalizeHeaders(headers) {
  const headerMap = new Map();
  const knownColumns = [...expectedColumns, ...optionalSourceColumns, "Ship Date", ...DIMENSIONS.filter((dimension) => !dimension.required).map((dimension) => dimension.label)];

  headers.forEach((header) => {
    const normalizedHeader = normalizeHeaderName(header);
    const knownColumn = knownColumns.find(
      (column) => headerSynonyms[column].includes(normalizedHeader),
    );

    if (knownColumn && !headerMap.has(knownColumn)) {
      headerMap.set(knownColumn, String(header));
    }
  });

  return headerMap;
}

function validateRequiredColumns(headerMap) {
  const missing = requiredColumns.filter((column) => !headerMap.has(column));

  // Cost is satisfied by either column: a real cost, or a profit we can subtract.
  if (!headerMap.has("Cost") && !headerMap.has("Profit")) {
    missing.push("Cost (or Profit)");
  }

  return missing;
}

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function isBlankRow(rawRow, headerMap) {
  return [...expectedColumns, ...optionalSourceColumns].every((column) => {
    const sourceHeader = headerMap.get(column);
    return !sourceHeader || isEmptyValue(rawRow[sourceHeader]);
  });
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const serial = typeof value === "number" ? value : Number(String(value).trim());
  if (!isEmptyValue(value) && Number.isFinite(serial)) {
    const parsedSerial = XLSX.SSF.parse_date_code(serial);
    if (parsedSerial) {
      return new Date(parsedSerial.y, parsedSerial.m - 1, parsedSerial.d);
    }
  }

  if (typeof value === "string" && value.trim()) {
    const dateString = value.trim();
    const plainDateMatch = dateString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    // Single-digit components are allowed: real exports write 11/8/2016, not 11/08/2016.
    const slashDateMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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

function discountToPromotion(discountValue) {
  const discount = parseNumber(discountValue);

  if (discount === null) {
    return "";
  }

  // Files express discounts either as a fraction (0.2) or as a percentage (20).
  const percent = discount > 1 ? discount : discount * 100;
  return `${Math.round(percent)}% discount`;
}

function coerceRow(rawRow, headerMap) {
  const valueFor = (column) => rawRow[headerMap.get(column)];
  const date = parseDate(valueFor("Date"));
  const quantity = parseNumber(valueFor("Quantity"));
  const revenue = parseNumber(valueFor("Revenue"));
  const statedCost = parseNumber(valueFor("Cost"));
  const profit = parseNumber(valueFor("Profit"));
  const shipDate = headerMap.has("Ship Date") ? parseDate(valueFor("Ship Date")) : null;
  // A real cost always wins; otherwise recover it from profit. Negative profit is kept
  // as-is, so a loss-making row correctly reports a cost above its revenue.
  const cost = statedCost === null && profit !== null && revenue !== null
    ? revenue - profit
    : statedCost;

  if (!date || quantity === null || revenue === null || cost === null) {
    return null;
  }

  const promotionValue = headerMap.has("Promotion")
    ? String(valueFor("Promotion")).trim()
    : discountToPromotion(valueFor("Discount"));

  const row = {
    date,
    orderId: String(valueFor("Order ID")).trim(),
    customer: String(valueFor("Customer")).trim(),
    product: String(valueFor("Product")).trim(),
    quantity,
    revenue,
    cost,
    promotion: promotionValue || null,
    isLoss: profit !== null ? profit < 0 : revenue - cost < 0,
  };

  DIMENSIONS.filter((dimension) => !dimension.required).forEach((dimension) => {
    const sourceHeader = headerMap.get(dimension.label);
    if (sourceHeader) {
      row[dimension.key] = String(rawRow[sourceHeader]).trim() || null;
    }
  });

  if (shipDate) {
    row.shipDate = shipDate;
    // UTC date components avoid fractional durations during daylight-saving changes.
    row.deliveryDays = Math.round((Date.UTC(shipDate.getFullYear(), shipDate.getMonth(), shipDate.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
  }

  return row;
}

function ingestRows({ rawRows, headers }, sourceLabel) {
  parsedSalesRows = [];
  invalidSalesRows = [];
  currentReport = null;
  selectedPeriodKey = null;
  expandedSections.clear();
  setGenerateButtonEnabled(false);
  reportControls.hidden = true;

  const headerMap = normalizeHeaders(headers);
  const missingColumns = validateRequiredColumns(headerMap);
  availableDimensionKeys = new Set(
    DIMENSIONS.filter((dimension) => dimension.required || headerMap.has(dimension.label))
      .map((dimension) => dimension.key),
  );

  if (missingColumns.length) {
    clearSelectedFile();
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
    clearSelectedFile();
    showUploadError("No valid sales rows were found in this file.");
    return;
  }

  selectedFileName.textContent =
    `Loaded: ${sourceLabel} (${parsedSalesRows.length.toLocaleString()} rows)`;
  setGenerateButtonEnabled(true);
  reportControls.hidden = false;
  populatePeriods();

  if (invalidSalesRows.length) {
    showUploadError(
      `${invalidSalesRows.length} row${invalidSalesRows.length === 1 ? " was" : "s were"} skipped due to invalid dates or numbers.`,
    );
    return;
  }

  clearUploadError();
}

async function parseAndValidateFile(file) {
  try {
    ingestRows(await readFileAsRows(file), file.name);
  } catch (error) {
    showUploadError(`Unable to read this file: ${error.message}`);
  }
}

function loadSuperstoreData() {
  const data = window.SUPERSTORE_DATA;

  if (!data) {
    showUploadError("Embedded Superstore data is unavailable.");
    return;
  }

  salesFileInput.value = "";
  clearUploadError();
  setApiStatus("");
  // Rebuilt into the same shape readFileAsRows returns, so the embedded data goes
  // through exactly the same header matching and coercion as an uploaded file.
  const rawRows = data.rows.map((values) =>
    Object.fromEntries(data.headers.map((header, index) => [header, values[index]])),
  );
  ingestRows({ rawRows, headers: data.headers }, "Superstore dataset");
}

function setApiStatus(message, state) {
  apiStatus.textContent = message;

  if (state) {
    apiStatus.dataset.state = state;
  } else {
    delete apiStatus.dataset.state;
  }
}

// The archive is ZIP64, so both size fields in the local header read 0xFFFFFFFF and the
// real 64-bit sizes live in the extra field. Reading the header fields alone yields the
// sentinel, not a length.
function readZip64Sizes(view, extraStart, extraLength) {
  let offset = extraStart;
  const end = extraStart + extraLength;

  while (offset + 4 <= end) {
    const headerId = view.getUint16(offset, true);
    const dataSize = view.getUint16(offset + 2, true);

    if (headerId === 0x0001 && dataSize >= 16) {
      return {
        uncompressedSize: Number(view.getBigUint64(offset + 4, true)),
        compressedSize: Number(view.getBigUint64(offset + 12, true)),
      };
    }

    offset += 4 + dataSize;
  }

  return null;
}

function findCsvEntry(buffer) {
  const view = new DataView(buffer);
  let offset = 0;

  while (offset + 30 <= buffer.byteLength
    && view.getUint32(offset, true) === LOCAL_FILE_HEADER_SIGNATURE) {
    const method = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 30, nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    let compressedSize = view.getUint32(offset + 18, true);
    let uncompressedSize = view.getUint32(offset + 22, true);

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      const zip64Sizes = readZip64Sizes(view, offset + 30 + nameLength, extraLength);

      if (!zip64Sizes) {
        throw new Error(`ZIP64 entry "${name}" is missing its extended size field.`);
      }

      compressedSize = zip64Sizes.compressedSize;
      uncompressedSize = zip64Sizes.uncompressedSize;
    }

    if (name.toLowerCase().endsWith(".csv")) {
      return { method, dataStart, compressedSize, uncompressedSize, name };
    }

    offset = dataStart + compressedSize;
  }

  throw new Error("No CSV file was found inside the downloaded archive.");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractCsvText(buffer) {
  const entry = findCsvEntry(buffer);
  const payload = new Uint8Array(buffer, entry.dataStart, entry.compressedSize);
  const csvBytes = entry.method === 8 ? await inflateRaw(payload) : payload;

  if (entry.method !== 8 && entry.method !== 0) {
    throw new Error(`Unsupported compression method ${entry.method}.`);
  }

  if (csvBytes.length !== entry.uncompressedSize) {
    throw new Error(
      `Corrupt archive: expected ${entry.uncompressedSize} bytes, got ${csvBytes.length}.`,
    );
  }

  // The published file is Windows-1252, not UTF-8; decoding it as UTF-8 corrupts the
  // non-breaking spaces inside several product names.
  return new TextDecoder("windows-1252").decode(csvBytes);
}

async function fetchSuperstoreFromApi() {
  fetchSuperstoreButton.disabled = true;
  setApiStatus("Requesting the dataset from the Kaggle API…", "loading");

  try {
    const response = await fetch(KAGGLE_DATASET_URL);

    if (!response.ok) {
      throw new Error(`Kaggle responded with HTTP ${response.status}.`);
    }

    const buffer = await response.arrayBuffer();
    const signature = new TextDecoder().decode(new Uint8Array(buffer, 0, 2));

    // A redirect to a sign-in page can still arrive as HTTP 200, so confirm this is
    // really an archive before trusting any of it.
    if (signature !== "PK") {
      throw new Error("Kaggle returned a page instead of a dataset.");
    }

    setApiStatus("Unpacking and parsing the dataset…", "loading");
    const csvText = await extractCsvText(buffer);
    salesFileInput.value = "";
    clearUploadError();
    ingestRows(readCsvTextAsRows(csvText), "Superstore dataset (live from Kaggle API)");

    if (parsedSalesRows.length) {
      const downloadedKb = Math.round(buffer.byteLength / 1024);
      setApiStatus(
        `Fetched live from the Kaggle API: ${parsedSalesRows.length.toLocaleString()} rows (${downloadedKb} KB downloaded).`,
        "success",
      );
    }
  } catch (error) {
    setApiStatus(
      `Live fetch failed: ${error.message} Use "Load Superstore Data" for the offline copy.`,
      "error",
    );
  } finally {
    fetchSuperstoreButton.disabled = false;
  }
}

function getWeekStart(date) {
  const weekStart = new Date(date);
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;

  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function getPeriodKey(date, granularity) {
  const year = date.getFullYear();

  if (granularity === "month") {
    return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  const weekStart = getWeekStart(date);
  const month = String(weekStart.getMonth() + 1).padStart(2, "0");
  const day = String(weekStart.getDate()).padStart(2, "0");

  return `${weekStart.getFullYear()}-${month}-${day}`;
}

function formatPeriodLabel(periodKey, granularity) {
  if (granularity === "week") {
    return `Week of ${periodKey}`;
  }

  const [year, month] = periodKey.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function groupRowsBy(rows, getKey) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = getKey(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });

  return groups;
}

function groupRowsByPeriod(rows, granularity) {
  return groupRowsBy(rows, (row) => getPeriodKey(row.date, granularity));
}

function getSortedPeriodKeys(rows, granularity) {
  return Array.from(groupRowsByPeriod(rows, granularity).keys()).sort();
}

function populatePeriods() {
  const periodKeys = getSortedPeriodKeys(parsedSalesRows, selectedGranularity).reverse();

  if (!periodKeys.includes(selectedPeriodKey)) {
    selectedPeriodKey = periodKeys[0] || null;
  }

  periodSelect.innerHTML = periodKeys
    .map((periodKey) => {
      const label = escapeHtml(formatPeriodLabel(periodKey, selectedGranularity));
      return `<option value="${escapeHtml(periodKey)}">${label}</option>`;
    })
    .join("");
  periodSelect.value = selectedPeriodKey || "";
}

function handleGranularityChange() {
  selectedGranularity = granularitySelect.value;
  expandedSections.clear();
  // The period list is granularity-specific, so the previous selection rarely survives.
  selectedPeriodKey = null;
  populatePeriods();
  renderCurrentReport();
}

function handlePeriodChange() {
  selectedPeriodKey = periodSelect.value;
  expandedSections.clear();
  renderCurrentReport();
}

function handleReportOutputClick(event) {
  const toggleButton = event.target.closest("[data-section]");

  if (!toggleButton || !currentReport) {
    return;
  }

  const section = toggleButton.dataset.section;

  if (expandedSections.has(section)) {
    expandedSections.delete(section);
  } else {
    expandedSections.add(section);
  }

  reportOutput.innerHTML = renderReport(currentReport);
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

function calculateBreakdown(rows, dimensionKey) {
  const dimension = DIMENSIONS.find((candidate) => candidate.key === dimensionKey);

  if (!dimension) {
    throw new Error(`Unknown dimension: ${dimensionKey}`);
  }

  const groups = groupRowsBy(rows, (row) => {
    const value = row[dimensionKey];
    return value || (dimensionKey === "promotion" ? NO_PROMOTION_LABEL : "(not set)");
  });

  return Array.from(groups, ([value, dimensionRows]) => {
    const totals = calculateTotals(dimensionRows);
    const { totalProfit, profitMargin } = calculateProfit(totals.totalRevenue, totals.totalCost);

    return {
      value,
      revenue: totals.totalRevenue,
      cost: totals.totalCost,
      profit: totalProfit,
      margin: profitMargin,
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
    bestSelling: { ...productsByUnitsSold[0], product: productsByUnitsSold[0].value },
    lowestSelling: { ...productsByUnitsSold[productsByUnitsSold.length - 1], product: productsByUnitsSold[productsByUnitsSold.length - 1].value },
  };
}

function calculatePeriodComparison(rows, granularity, periodKey) {
  const periodGroups = groupRowsByPeriod(rows, granularity);
  const periodKeys = Array.from(periodGroups.keys()).sort();
  const currentIndex = periodKeys.indexOf(periodKey);
  // The preceding period *present in the data*, not the calendar-adjacent one, so a gap
  // in the file cannot produce a phantom -100%.
  const previousPeriodKey = currentIndex > 0 ? periodKeys[currentIndex - 1] : null;
  const calculatePeriodTotals = (key) => {
    const totals = calculateTotals(periodGroups.get(key) || []);
    const { totalProfit } = calculateProfit(totals.totalRevenue, totals.totalCost);

    return { ...totals, totalProfit };
  };
  const currentPeriodTotals = calculatePeriodTotals(periodKey);
  const previousPeriodTotals = previousPeriodKey
    ? calculatePeriodTotals(previousPeriodKey)
    : null;
  const percentChangeFor = (currentValue, previousValue) => {
    // A zero baseline has no meaningful percentage change.
    if (previousValue === 0) {
      return null;
    }

    return roundTo(((currentValue - previousValue) / previousValue) * 100, 1);
  };

  return {
    currentPeriodKey: periodKey,
    previousPeriodKey,
    currentPeriodTotals,
    previousPeriodTotals,
    percentChange: previousPeriodTotals
      ? {
          revenue: percentChangeFor(
            currentPeriodTotals.totalRevenue,
            previousPeriodTotals.totalRevenue,
          ),
          profit: percentChangeFor(
            currentPeriodTotals.totalProfit,
            previousPeriodTotals.totalProfit,
          ),
          orders: percentChangeFor(
            currentPeriodTotals.totalOrders,
            previousPeriodTotals.totalOrders,
          ),
          unitsSold: percentChangeFor(
            currentPeriodTotals.totalUnitsSold,
            previousPeriodTotals.totalUnitsSold,
          ),
        }
      : { revenue: null, profit: null, orders: null, unitsSold: null },
  };
}

function calculateAlerts(report) {
  const alerts = [];
  const revenueChange = report.periodComparison.percentChange.revenue;

  if (revenueChange !== null && revenueChange <= -20) {
    alerts.push({
      severity: "warning",
      message: `Revenue declined ${Math.abs(revenueChange).toFixed(1)}% from the previous ${report.granularity}.`,
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

function buildReport(rows, { granularity, periodKey }) {
  // Every figure below describes the selected period only; the comparison is the one
  // place that still needs the full set of rows.
  const periodRows = rows.filter((row) => getPeriodKey(row.date, granularity) === periodKey);
  const totals = calculateTotals(periodRows);
  const profit = calculateProfit(totals.totalRevenue, totals.totalCost);
  const breakdowns = Object.fromEntries(
    DIMENSIONS.filter((dimension) => availableDimensionKeys.has(dimension.key))
      .map((dimension) => [dimension.key, calculateBreakdown(periodRows, dimension.key)]),
  );
  const productPerformance = breakdowns.product;
  const customerPerformance = breakdowns.customer;
  const promotionPerformance = breakdowns.promotion;
  const { bestSelling, lowestSelling } = calculateBestAndLowestSellingProducts(productPerformance);
  const periodComparison = calculatePeriodComparison(rows, granularity, periodKey);
  const report = {
    granularity,
    periodKey,
    totals,
    profit,
    productPerformance,
    customerPerformance,
    promotionPerformance,
    breakdowns,
    bestSelling,
    lowestSelling,
    periodComparison,
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

function formatComparisonTitle(granularity) {
  return granularity === "week" ? "Week-over-week comparison" : "Month-over-month comparison";
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

function renderPeriodComparison(periodComparison, granularity) {
  const title = formatComparisonTitle(granularity);

  if (!periodComparison.previousPeriodKey) {
    return `<section class="report-section"><h3>${title}</h3><p class="report-empty-state">No previous ${granularity} data to compare yet.</p></section>`;
  }

  const metrics = [
    ["Revenue", "totalRevenue", "revenue", formatMoney],
    ["Profit", "totalProfit", "profit", formatMoney],
    ["Orders", "totalOrders", "orders", (value) => value.toLocaleString()],
    ["Units sold", "totalUnitsSold", "unitsSold", (value) => value.toLocaleString()],
  ];
  const cards = metrics.map(([label, totalKey, changeKey, formatter]) => {
    const change = periodComparison.percentChange[changeKey];
    const changeClass = change === null || change === 0 ? "change-neutral" : change > 0 ? "change-positive" : "change-negative";
    const changeText = change === null ? "No percentage baseline" : `${change > 0 ? "+" : ""}${formatPercent(change)}`;
    return `<article class="comparison-card"><span class="comparison-label">${label}</span><p class="comparison-values">Current: ${formatter(periodComparison.currentPeriodTotals[totalKey])}<br>Previous: ${formatter(periodComparison.previousPeriodTotals[totalKey])}</p><span class="${changeClass}">${changeText}</span></article>`;
  }).join("");
  const currentLabel = escapeHtml(formatPeriodLabel(periodComparison.currentPeriodKey, granularity));
  const previousLabel = escapeHtml(formatPeriodLabel(periodComparison.previousPeriodKey, granularity));

  return `<section class="report-section"><h3>${title}</h3><p class="summary-card-detail">${currentLabel} compared with ${previousLabel}</p><div class="comparison-grid">${cards}</div></section>`;
}

function renderTable(headers, rows) {
  return `<div class="table-wrap"><table class="report-table"><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Real files carry hundreds of products and customers, so only the strongest are shown
// until asked otherwise. The CSV export is never truncated.
function renderTruncatedSection(title, sectionKey, itemNoun, headers, items, renderRow) {
  const isExpanded = expandedSections.has(sectionKey);
  const visibleItems = isExpanded ? items : items.slice(0, TOP_ROW_COUNT);
  const toggleLabel = isExpanded
    ? `Show top ${TOP_ROW_COUNT}`
    : `Show all ${items.length.toLocaleString()} ${itemNoun}`;
  const toggleButton = items.length > TOP_ROW_COUNT
    ? `<button type="button" class="table-toggle" data-section="${escapeHtml(sectionKey)}">${escapeHtml(toggleLabel)}</button>`
    : "";

  return `<section class="report-section"><h3>${escapeHtml(title)}</h3>${renderTable(headers, visibleItems.map(renderRow).join(""))}${toggleButton}</section>`;
}

function renderBreakdownSection(dimension, items) {
  return renderTruncatedSection(
    `${dimension.label} performance`,
    dimension.key,
    dimension.noun,
    [dimension.label, "Revenue", "Cost", "Profit", "Margin", "Units Sold", "Orders"],
    items,
    (item) => `<tr><td>${escapeHtml(item.value)}</td><td>${formatMoney(item.revenue)}</td><td>${formatMoney(item.cost)}</td><td>${formatMoney(item.profit)}</td><td>${formatPercent(item.margin)}</td><td>${item.unitsSold.toLocaleString()}</td><td>${item.orderCount.toLocaleString()}</td></tr>`,
  );
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
    renderPeriodComparison(report.periodComparison, report.granularity),
    ...DIMENSIONS.filter((dimension) => report.breakdowns[dimension.key]).map(
      (dimension) => renderBreakdownSection(dimension, report.breakdowns[dimension.key]),
    ),
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
    ["Period", formatPeriodLabel(report.periodKey, report.granularity)],
    ["Total Revenue", report.totals.totalRevenue],
    ["Total Cost", report.totals.totalCost],
    ["Total Profit", report.profit.totalProfit],
    ["Profit Margin (%)", report.profit.profitMargin],
    ["Total Orders", report.totals.totalOrders],
    ["Total Units Sold", report.totals.totalUnitsSold],
    ["Best-Selling Product", report.bestSelling?.product ?? ""],
    ["Lowest-Selling Product", report.lowestSelling?.product ?? ""],
  ]);

  const { periodComparison } = report;
  const comparisonRows = periodComparison.previousPeriodKey
    ? [
        ["Revenue", periodComparison.currentPeriodTotals.totalRevenue, periodComparison.previousPeriodTotals.totalRevenue, periodComparison.percentChange.revenue],
        ["Profit", periodComparison.currentPeriodTotals.totalProfit, periodComparison.previousPeriodTotals.totalProfit, periodComparison.percentChange.profit],
        ["Orders", periodComparison.currentPeriodTotals.totalOrders, periodComparison.previousPeriodTotals.totalOrders, periodComparison.percentChange.orders],
        ["Units Sold", periodComparison.currentPeriodTotals.totalUnitsSold, periodComparison.previousPeriodTotals.totalUnitsSold, periodComparison.percentChange.unitsSold],
      ]
    : [[`No previous ${report.granularity} data to compare yet.`]];
  addSection(
    formatComparisonTitle(report.granularity),
    periodComparison.previousPeriodKey
      ? [`Metric`, `Current ${report.granularity}`, `Previous ${report.granularity}`, "% Change"]
      : null,
    comparisonRows,
  );

  DIMENSIONS.filter((dimension) => report.breakdowns[dimension.key]).forEach((dimension) => {
    addSection(
      `${dimension.label} Performance`,
      [dimension.label, "Revenue", "Cost", "Profit", "Margin (%)", "Units Sold", "Orders"],
      report.breakdowns[dimension.key].map((item) => [
        item.value,
        item.revenue,
        item.cost,
        item.profit,
        item.margin,
        item.unitsSold,
        item.orderCount,
      ]),
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

function getReportFileName(report) {
  if (report.periodKey) {
    return `salesscope-report-${report.periodKey}.csv`;
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

function renderCurrentReport() {
  if (!selectedPeriodKey) {
    return;
  }

  currentReport = buildReport(parsedSalesRows, {
    granularity: selectedGranularity,
    periodKey: selectedPeriodKey,
  });
  reportOutput.innerHTML = renderReport(currentReport);
  downloadReportButton.hidden = false;
  reportHeadingHint.textContent =
    `Showing ${formatPeriodLabel(selectedPeriodKey, selectedGranularity)}.`;
}

function generateReport() {
  reportOutput.textContent = "Generating report...";
  window.setTimeout(renderCurrentReport, 0);
}
