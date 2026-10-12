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
const focusFiltersElement = document.querySelector("#focus-filters");
const toggleAllSectionsButton = document.querySelector("#toggle-all-sections-button");
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
const DEFAULT_COLLAPSED_REPORT_SECTIONS = new Set([
  "category",
  "subCategory",
  "region",
  "state",
  "city",
  "segment",
  "shipMode",
]);
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
const collapsedReportSections = new Set();
// Charts start visible; this set deliberately records only charts the reader hid.
const collapsedCharts = new Set();
// Table state is kept outside the rendered HTML so interaction survives report refreshes.
const tableSorts = new Map();
const tableSearches = new Map();
const focusFilters = new Map();

salesFileInput.addEventListener("change", handleFileInputChange);
loadSuperstoreButton.addEventListener("click", loadSuperstoreData);
fetchSuperstoreButton.addEventListener("click", fetchSuperstoreFromApi);
generateReportButton.addEventListener("click", generateReport);
downloadReportButton.addEventListener("click", downloadCurrentReport);
document.querySelector("#reset-button").addEventListener("click", resetApp);
granularitySelect.addEventListener("change", handleGranularityChange);
periodSelect.addEventListener("change", handlePeriodChange);
toggleAllSectionsButton.addEventListener("click", toggleAllReportSections);
// The report HTML is replaced wholesale on every render, so per-button listeners would
// not survive. One delegated listener on the container does.
reportOutput.addEventListener("click", handleReportOutputClick);
reportOutput.addEventListener("input", handleReportOutputInput);
reportOutput.addEventListener("pointermove", handleChartPointerMove);
reportOutput.addEventListener("pointerleave", hideChartCrosshair);

function resetApp() {
  salesFileInput.value = "";
  parsedSalesRows = [];
  invalidSalesRows = [];
  currentReport = null;
  selectedGranularity = "month";
  selectedPeriodKey = null;
  availableDimensionKeys.clear();
  expandedSections.clear();
  tableSorts.clear();
  tableSearches.clear();
  focusFilters.clear();
  collapsedReportSections.clear();
  collapsedCharts.clear();
  focusFiltersElement.innerHTML = "";
  clearSelectedFile();
  clearUploadError();
  setApiStatus("");
  setGenerateButtonEnabled(false);
  reportOutput.innerHTML = "";
  downloadReportButton.hidden = true;
  reportControls.hidden = true;
  toggleAllSectionsButton.textContent = "Collapse all";
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
    discountPercent: headerMap.has("Discount") && parseNumber(valueFor("Discount")) !== null
      ? (parseNumber(valueFor("Discount")) > 1 ? parseNumber(valueFor("Discount")) : parseNumber(valueFor("Discount")) * 100)
      : null,
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
  collapsedReportSections.clear();
  DEFAULT_COLLAPSED_REPORT_SECTIONS.forEach((section) => {
    collapsedReportSections.add(section);
  });
  tableSorts.clear();
  tableSearches.clear();
  focusFilters.clear();
  focusFiltersElement.innerHTML = "";
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
  focusFilters.clear();
  // The period list is granularity-specific, so the previous selection rarely survives.
  selectedPeriodKey = null;
  populatePeriods();
  renderCurrentReport();
}

function handlePeriodChange() {
  selectedPeriodKey = periodSelect.value;
  expandedSections.clear();
  focusFilters.clear();
  renderCurrentReport();
}

function handleReportOutputClick(event) {
  const removeFocusButton = event.target.closest("[data-remove-focus]");

  if (removeFocusButton && currentReport) {
    focusFilters.delete(removeFocusButton.dataset.removeFocus);
    renderCurrentReport();
    return;
  }

  const sortButton = event.target.closest("[data-sort-section]");

  if (sortButton && currentReport) {
    const section = sortButton.dataset.sortSection;
    const column = sortButton.dataset.sortColumn;
    const currentSort = tableSorts.get(section);
    tableSorts.set(section, {
      column,
      direction: currentSort && currentSort.column === column && currentSort.direction === "asc" ? "desc" : "asc",
    });
    reportOutput.innerHTML = renderReport(currentReport);
    return;
  }

  const focusRow = event.target.closest("[data-focus-dimension]");

  if (focusRow && currentReport && !event.target.closest("button, input, a")) {
    focusFilters.set(focusRow.dataset.focusDimension, focusRow.dataset.focusValue);
    renderCurrentReport();
    return;
  }

  const chartToggle = event.target.closest("[data-chart]");

  if (chartToggle && currentReport) {
    const chart = chartToggle.dataset.chart;

    if (collapsedCharts.has(chart)) {
      collapsedCharts.delete(chart);
    } else {
      collapsedCharts.add(chart);
    }

    reportOutput.innerHTML = renderReport(currentReport);
    return;
  }

  const reportSectionToggle = event.target.closest("[data-report-section]");

  if (reportSectionToggle && currentReport) {
    const section = reportSectionToggle.dataset.reportSection;

    if (collapsedReportSections.has(section)) {
      collapsedReportSections.delete(section);
    } else {
      collapsedReportSections.add(section);
    }

    updateSectionToggleLabel();
    reportOutput.innerHTML = renderReport(currentReport);
    return;
  }

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

function handleReportOutputInput(event) {
  const searchInput = event.target.closest("[data-table-search]");

  if (!searchInput || !currentReport) {
    return;
  }

  tableSearches.set(searchInput.dataset.tableSearch, searchInput.value);
  reportOutput.innerHTML = renderReport(currentReport);
  const replacement = reportOutput.querySelector(`[data-table-search="${CSS.escape(searchInput.dataset.tableSearch)}"]`);
  if (replacement) {
    replacement.focus();
    replacement.setSelectionRange(searchInput.selectionStart, searchInput.selectionEnd);
  }
}

function handleChartPointerMove(event) {
  const chart = event.target.closest("[data-revenue-chart]");

  if (!chart || !currentReport) {
    hideChartCrosshair();
    return;
  }

  const svg = chart.ownerSVGElement;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const location = point.matrixTransform(svg.getScreenCTM().inverse());
  const index = Math.max(0, Math.min(
    currentReport.revenueByPeriod.length - 1,
    Math.round(((location.x - 58) / 622) * (currentReport.revenueByPeriod.length - 1)),
  ));
  const period = currentReport.revenueByPeriod[index];
  const x = 58 + (index / Math.max(currentReport.revenueByPeriod.length - 1, 1)) * 622;
  const minimum = Math.min(...currentReport.revenueByPeriod.map((item) => item.revenue));
  const maximum = Math.max(...currentReport.revenueByPeriod.map((item) => item.revenue), 1);
  const tickSize = niceChartTickSize(Math.max(maximum, Math.abs(minimum)) / 3);
  const axisMinimum = minimum < 0 ? tickSize * Math.floor(minimum / tickSize) : 0;
  const axisMaximum = tickSize * Math.ceil(maximum / tickSize);
  const y = 22 + 175 - ((period.revenue - axisMinimum) / (axisMaximum - axisMinimum)) * 175;
  const crosshair = chart.querySelector(".chart-crosshair");
  const tooltip = chart.querySelector(".chart-tooltip");

  crosshair.setAttribute("x1", x);
  crosshair.setAttribute("x2", x);
  crosshair.hidden = false;
  tooltip.setAttribute("x", Math.min(x + 8, 530));
  tooltip.setAttribute("y", Math.max(y - 12, 18));
  tooltip.textContent = `${formatPeriodLabel(period.key, currentReport.granularity)}: ${formatMoney(period.revenue)}`;
  tooltip.hidden = false;
}

function hideChartCrosshair() {
  reportOutput.querySelectorAll(".chart-crosshair, .chart-tooltip").forEach((element) => {
    element.hidden = true;
  });
}

function getRenderedReportSectionKeys() {
  return [...reportOutput.querySelectorAll("[data-report-section]")].map(
    (toggle) => toggle.dataset.reportSection,
  );
}

function updateSectionToggleLabel() {
  if (!currentReport) {
    return;
  }

  const sectionKeys = getRenderedReportSectionKeys();
  const allCollapsed = sectionKeys.length > 0 && sectionKeys.every(
    (section) => collapsedReportSections.has(section),
  );
  toggleAllSectionsButton.textContent = allCollapsed ? "Expand all" : "Collapse all";
}

function toggleAllReportSections() {
  if (!currentReport) {
    return;
  }

  const sectionKeys = getRenderedReportSectionKeys();
  const allCollapsed = sectionKeys.every((section) => collapsedReportSections.has(section));

  if (allCollapsed) {
    collapsedReportSections.clear();
  } else {
    sectionKeys.forEach((section) => collapsedReportSections.add(section));
  }

  updateSectionToggleLabel();
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
    const deliveryDays = dimensionKey === "shipMode"
      ? dimensionRows.map((row) => row.deliveryDays).filter(Number.isInteger)
      : [];

    return {
      value,
      revenue: totals.totalRevenue,
      cost: totals.totalCost,
      profit: totalProfit,
      margin: profitMargin,
      unitsSold: totals.totalUnitsSold,
      orderCount: totals.totalOrders,
      averageDeliveryDays: deliveryDays.length
        ? roundTo(deliveryDays.reduce((total, days) => total + days, 0) / deliveryDays.length, 1)
        : null,
      maximumDeliveryDays: deliveryDays.length ? Math.max(...deliveryDays) : null,
    };
  }).sort((first, second) => second.revenue - first.revenue);
}

function calculateBestSellingAndBiggestLossMaker(productPerformance) {
  if (!productPerformance.length) {
    return { bestSelling: null, biggestLossMaker: null };
  }

  const productsByUnitsSold = [...productPerformance].sort(
    (first, second) => second.unitsSold - first.unitsSold,
  );

  return {
    bestSelling: { ...productsByUnitsSold[0], product: productsByUnitsSold[0].value },
    biggestLossMaker: productPerformance
      .filter((product) => product.profit < 0)
      .sort((first, second) => first.profit - second.profit)[0] || null,
  };
}

function calculatePeriodComparison(rows, granularity, periodKey) {
  const periodGroups = groupRowsByPeriod(rows, granularity);
  const periodKeys = Array.from(periodGroups.keys()).sort();
  const currentIndex = periodKeys.indexOf(periodKey);
  // The preceding period *present in the data*, not the calendar-adjacent one, so a gap
  // in the file cannot produce a phantom -100%.
  const previousPeriodKey = currentIndex > 0 ? periodKeys[currentIndex - 1] : null;
  const yearAgoPeriodKey = getYearAgoPeriodKey(periodKey, granularity, periodKeys);
  const calculatePeriodTotals = (key) => {
    const totals = calculateTotals(periodGroups.get(key) || []);
    const { totalProfit } = calculateProfit(totals.totalRevenue, totals.totalCost);

    return { ...totals, totalProfit };
  };
  const currentPeriodTotals = calculatePeriodTotals(periodKey);
  const previousPeriodTotals = previousPeriodKey
    ? calculatePeriodTotals(previousPeriodKey)
    : null;
  const yearAgoTotals = yearAgoPeriodKey ? calculatePeriodTotals(yearAgoPeriodKey) : null;
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
    yearAgoPeriodKey,
    currentPeriodTotals,
    previousPeriodTotals,
    yearAgoTotals,
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
    yearAgoPercentChange: yearAgoTotals
      ? {
          revenue: percentChangeFor(currentPeriodTotals.totalRevenue, yearAgoTotals.totalRevenue),
          profit: percentChangeFor(currentPeriodTotals.totalProfit, yearAgoTotals.totalProfit),
          orders: percentChangeFor(currentPeriodTotals.totalOrders, yearAgoTotals.totalOrders),
          unitsSold: percentChangeFor(currentPeriodTotals.totalUnitsSold, yearAgoTotals.totalUnitsSold),
        }
      : { revenue: null, profit: null, orders: null, unitsSold: null },
  };
}

function getYearAgoPeriodKey(periodKey, granularity, periodKeys) {
  if (granularity === "month") {
    const [year, month] = periodKey.split("-");
    const candidate = `${Number(year) - 1}-${month}`;
    return periodKeys.includes(candidate) ? candidate : null;
  }

  const [year, month, day] = periodKey.split("-").map(Number);
  const targetTime = Date.UTC(year, month - 1, day) - 364 * 86400000;
  const nearestKey = periodKeys.reduce((closest, candidate) => {
    const [candidateYear, candidateMonth, candidateDay] = candidate.split("-").map(Number);
    const distance = Math.abs(Date.UTC(candidateYear, candidateMonth - 1, candidateDay) - targetTime);
    return !closest || distance < closest.distance ? { key: candidate, distance } : closest;
  }, null);

  return nearestKey && nearestKey.distance <= 7 * 86400000 ? nearestKey.key : null;
}

function calculateAlerts(report) {
  const alerts = [];
  const yearAgoRevenueChange = report.periodComparison.yearAgoPercentChange.revenue;
  const revenueChange = yearAgoRevenueChange === null
    ? report.periodComparison.percentChange.revenue
    : yearAgoRevenueChange;
  const revenueBaseline = yearAgoRevenueChange === null
    ? `previous ${report.granularity}`
    : `same ${report.granularity} last year`;

  if (revenueChange !== null && revenueChange <= -20) {
    alerts.push({
      severity: "warning",
      message: `Revenue declined ${Math.abs(revenueChange).toFixed(1)}% versus the ${revenueBaseline}.`,
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

  const discountedLossRows = report.rows.filter(
    (row) => row.discountPercent !== null && row.discountPercent >= 30 && row.isLoss,
  );
  const discountedProfitLost = roundTo(
    discountedLossRows.reduce((total, row) => total + (row.revenue - row.cost), 0),
    2,
  );
  if (discountedLossRows.length) {
    alerts.push({
      severity: "warning",
      message: `${discountedLossRows.length.toLocaleString()} discounted rows at 30% or more lost ${formatMoney(Math.abs(discountedProfitLost))} in profit.`,
    });
  }

  const lossMakingProducts = report.productPerformance.filter((product) => product.profit < 0);
  if (lossMakingProducts.length) {
    const worstProduct = lossMakingProducts.sort((first, second) => first.profit - second.profit)[0];
    alerts.push({
      severity: "warning",
      message: `${lossMakingProducts.length.toLocaleString()} products sold below cost; worst: ${worstProduct.value} (${formatMoney(worstProduct.profit)}).`,
    });
  }

  const sameDayBreachedOrderIds = new Set(report.rows.filter((row) => (
    row.shipMode === "Same Day"
      && Number.isInteger(row.deliveryDays)
      && row.deliveryDays > 0
  )).map((row) => row.orderId));
  if (sameDayBreachedOrderIds.size) {
    alerts.push({
      severity: "warning",
      message: `${sameDayBreachedOrderIds.size.toLocaleString()} Same Day order${sameDayBreachedOrderIds.size === 1 ? "" : "s"} took more than 0 delivery days.`,
    });
  }

  const previousCustomerPerformance = report.periodComparison.previousPeriodKey
    ? calculateBreakdown(report.rowsByPeriod.get(report.periodComparison.previousPeriodKey), "customer")
    : [];
  const currentCustomers = new Set(report.customerPerformance.map((customer) => customer.value));
  const churnedTopCustomer = previousCustomerPerformance.slice(0, 10).find(
    (customer) => !currentCustomers.has(customer.value),
  );
  if (churnedTopCustomer) {
    alerts.push({
      severity: "warning",
      message: `${churnedTopCustomer.value}, a top-10 customer in the previous ${report.granularity}, did not order this period.`,
    });
  }

  const customerRevenue = report.customerPerformance.map((customer) => customer.revenue).sort((a, b) => b - a);
  const topCustomerCount = Math.ceil(customerRevenue.length * 0.1);
  const topCustomerRevenue = customerRevenue.slice(0, topCustomerCount).reduce((total, revenue) => total + revenue, 0);
  const concentration = report.totals.totalRevenue === 0 ? 0 : (topCustomerRevenue / report.totals.totalRevenue) * 100;
  if (topCustomerCount && concentration > 30) {
    alerts.push({
      severity: "info",
      message: `The top 10% of customers account for ${concentration.toFixed(1)}% of revenue.`,
    });
  }

  return alerts;
}

function buildReport(rows, { granularity, periodKey }) {
  // Every figure below describes the selected period only; the comparison is the one
  // place that still needs the full set of rows.
  const focusedRows = rows.filter((row) => Array.from(focusFilters).every(
    ([dimensionKey, value]) => row[dimensionKey] === value,
  ));
  const periodRows = focusedRows.filter((row) => getPeriodKey(row.date, granularity) === periodKey);
  const totals = calculateTotals(periodRows);
  const profit = calculateProfit(totals.totalRevenue, totals.totalCost);
  const breakdowns = Object.fromEntries(
    DIMENSIONS.filter((dimension) => availableDimensionKeys.has(dimension.key))
      .map((dimension) => [dimension.key, calculateBreakdown(periodRows, dimension.key)]),
  );
  const productPerformance = breakdowns.product;
  const customerPerformance = breakdowns.customer;
  const promotionPerformance = breakdowns.promotion;
  const { bestSelling, biggestLossMaker } = calculateBestSellingAndBiggestLossMaker(productPerformance);
  const periodComparison = calculatePeriodComparison(focusedRows, granularity, periodKey);
  const revenueByPeriod = Array.from(groupRowsByPeriod(focusedRows, granularity), ([key, periodRows]) => ({
    key,
    revenue: calculateTotals(periodRows).totalRevenue,
  })).sort((first, second) => first.key.localeCompare(second.key));
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
    biggestLossMaker,
    periodComparison,
    rows: periodRows,
    rowsByPeriod: groupRowsByPeriod(focusedRows, granularity),
    revenueByPeriod,
  };

  return { ...report, customerIntelligence: calculateCustomerIntelligence(report), alerts: calculateAlerts(report) };
}

function renderFocusFilters() {
  focusFiltersElement.innerHTML = Array.from(focusFilters, ([dimensionKey, value]) => {
    const dimension = DIMENSIONS.find((candidate) => candidate.key === dimensionKey);
    return `<span class="focus-chip">${escapeHtml(dimension.label)}: ${escapeHtml(value)}<button type="button" data-remove-focus="${escapeHtml(dimensionKey)}" aria-label="Remove ${escapeHtml(dimension.label)} filter">×</button></span>`;
  }).join("");
}

function calculateCustomerIntelligence(report) {
  const revenue = report.customerPerformance.reduce((total, customer) => total + customer.revenue, 0);
  const concentration = [10, 20, 50].map((percent) => {
    const count = Math.ceil(report.customerPerformance.length * (percent / 100));
    const topRevenue = report.customerPerformance.slice(0, count).reduce((total, customer) => total + customer.revenue, 0);
    return { percent, revenueShare: revenue === 0 ? 0 : (topRevenue / revenue) * 100 };
  });
  const previousCustomers = report.periodComparison.previousPeriodKey
    ? calculateBreakdown(report.rowsByPeriod.get(report.periodComparison.previousPeriodKey) || [], "customer")
    : [];
  const currentCustomerNames = new Set(report.customerPerformance.map((customer) => customer.value));
  return {
    concentration,
    atRisk: previousCustomers.filter((customer) => !currentCustomerNames.has(customer.value)).slice(0, TOP_ROW_COUNT),
    unprofitable: report.customerPerformance.filter((customer) => customer.profit < 0).sort((first, second) => first.profit - second.profit),
  };
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
  const amount = Number(value);
  const formatted = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "-" : ""}$${formatted}`;
}

function formatCompactMoney(value) {
  const amount = Math.round(Number(value));
  const sign = amount < 0 ? "-" : "";
  const absoluteAmount = Math.abs(amount);

  if (absoluteAmount >= 1000) {
    return `${sign}$${Math.round(absoluteAmount / 1000)}k`;
  }

  return `${sign}$${absoluteAmount}`;
}

function niceChartTickSize(value) {
  const exponent = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  const fraction = value / exponent;
  const roundedFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;

  return roundedFraction * exponent;
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
  const sort = sectionKey ? tableSorts.get(sectionKey) || { column: "revenue", direction: "desc" } : null;
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
  const sort = tableSorts.get(sectionKey) || { column: "revenue", direction: "desc" };
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

// Real files carry hundreds of products and customers, so only the strongest are shown
// until asked otherwise. The CSV export is never truncated.
function renderTruncatedSection(title, sectionKey, itemNoun, headers, items, renderRow) {
  const search = tableSearches.get(sectionKey) || "";
  const filteredItems = search
    ? items.filter((item) => item.value.toLowerCase().includes(search.toLowerCase()))
    : items;
  const sortedItems = sortedBreakdownItems(sectionKey, filteredItems);
  const isExpanded = expandedSections.has(sectionKey);
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

function renderChart(chartKey, title, description, svg, height = 260) {
  const isCollapsed = collapsedCharts.has(chartKey);
  const toggleLabel = isCollapsed ? "Show chart" : "Hide chart";

  const content = isCollapsed
    ? ""
    : `<figure class="chart-figure"><svg class="report-chart" viewBox="0 0 720 ${height}" role="img" aria-label="${escapeHtml(description)}"><title>${escapeHtml(description)}</title>${svg}</svg></figure>`;

  return `<div class="chart-wrap ${isCollapsed ? "is-collapsed" : ""}"><div class="chart-heading"><h4>${escapeHtml(title)}</h4><button type="button" class="chart-toggle" data-chart="${escapeHtml(chartKey)}" aria-expanded="${String(!isCollapsed)}">${escapeHtml(toggleLabel)}</button></div>${content}</div>`;
}

function chartLabel(value, length = 16) {
  const label = String(value);
  return escapeHtml(label.length > length ? `${label.slice(0, length - 1)}…` : label);
}

function renderDiscountMarginChart(items) {
  const bands = [...items].sort((first, second) => (
    Number.parseFloat(first.value) - Number.parseFloat(second.value)
  ));
  const viewBoxWidth = 720;
  const leftGutter = 60;
  const rightGutter = 90;
  const plotStart = leftGutter;
  const plotEnd = viewBoxWidth - rightGutter;
  const zeroX = (plotStart + plotEnd) / 2;
  const absoluteMargins = bands.map((item) => Math.abs(item.margin)).sort((first, second) => first - second);
  const percentilePosition = (absoluteMargins.length - 1) * 0.95;
  const percentileIndex = Math.floor(percentilePosition);
  const percentileFraction = percentilePosition - percentileIndex;
  const percentileMaximum = absoluteMargins.length
    ? absoluteMargins[percentileIndex] + (
      (absoluteMargins[Math.min(percentileIndex + 1, absoluteMargins.length - 1)] - absoluteMargins[percentileIndex]) * percentileFraction
    )
    : 0;
  const maximum = Math.max(10, Math.ceil(percentileMaximum / 10) * 10);
  const scale = Math.min(zeroX - plotStart, plotEnd - zeroX) / maximum;
  const rows = bands.map((item, index) => {
    const y = 28 + index * 24;
    const isOverflow = Math.abs(item.margin) >= maximum;
    const width = Math.min(Math.abs(item.margin), maximum) * scale;
    const x = item.margin < 0 ? zeroX - width : zeroX;
    const percent = `${Number.parseFloat(item.value).toFixed(0)}%`;
    const valueLabel = formatPercent(item.margin);
    const labelWidth = valueLabel.length * 7;
    const outsideFits = item.margin < 0
      ? x - 7 - labelWidth >= plotStart
      : x + width + 7 + labelWidth <= plotEnd;
    const inside = !outsideFits;
    const labelX = item.margin < 0
      ? (inside ? x + 6 : x - 7)
      : (inside ? x + width - 6 : x + width + 7);
    const anchor = item.margin < 0
      ? (inside ? "start" : "end")
      : (inside ? "end" : "start");
    const fill = item.margin < 0 ? "#e34948" : "#2a78d6";
    const bar = `<rect x="${x}" y="${y - 8}" width="${width}" height="16" rx="4" fill="${fill}"></rect>`;
    const overflow = isOverflow
      ? (item.margin < 0
        ? `<polygon points="${plotStart},${y} ${plotStart + 10},${y - 8} ${plotStart + 10},${y + 8}" fill="${fill}"></polygon>`
        : `<polygon points="${plotEnd},${y} ${plotEnd - 10},${y - 8} ${plotEnd - 10},${y + 8}" fill="${fill}"></polygon>`)
      : "";
    return `<text x="8" y="${y + 5}" class="chart-label">${escapeHtml(percent)}</text>${bar}${overflow}<text x="${labelX}" y="${y + 5}" text-anchor="${anchor}" class="chart-value">${escapeHtml(valueLabel)}</text>`;
  }).join("");
  const height = Math.max(260, bands.length * 24 + 40);

  return renderChart(
    "discount-margin",
    "Discount vs margin, by discount level",
    "Margin by discount band, showing positive margin in blue and negative margin in red.",
    `<line x1="${zeroX}" y1="12" x2="${zeroX}" y2="${height - 12}" class="chart-zero"></line>${rows}`,
    height,
  );
}

function renderRevenueOverTimeChart(report) {
  const points = report.revenueByPeriod;
  const minimum = Math.min(...points.map((point) => point.revenue));
  const maximum = Math.max(...points.map((point) => point.revenue), 1);
  const tickSize = niceChartTickSize(Math.max(maximum, Math.abs(minimum)) / 3);
  const axisMinimum = minimum < 0 ? tickSize * Math.floor(minimum / tickSize) : 0;
  const axisMaximum = tickSize * Math.ceil(maximum / tickSize);
  const axisRange = axisMaximum - axisMinimum;
  const left = 58;
  const top = 22;
  const width = 622;
  const height = 175;
  const pointMarkup = points.map((point, index) => {
    const x = left + (index / Math.max(points.length - 1, 1)) * width;
    const y = top + height - ((point.revenue - axisMinimum) / axisRange) * height;
    return { ...point, x, y };
  });
  const selected = pointMarkup.find((point) => point.key === report.periodKey);
  const path = pointMarkup.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const dots = pointMarkup.map((point) => {
    const label = `${formatPeriodLabel(point.key, report.granularity)}: ${formatMoney(point.revenue)}`;
    return `<circle cx="${point.x}" cy="${point.y}" r="2.5" fill="#2a78d6"><title>${escapeHtml(label)}</title></circle>`;
  }).join("");
  const selectedMarkup = selected ? `<circle cx="${selected.x}" cy="${selected.y}" r="5" fill="#2a78d6"></circle><text x="${Math.min(selected.x + 9, 600)}" y="${selected.y - 9}" class="chart-value">${escapeHtml(formatMoney(selected.revenue))}</text>` : "";
  // The final label is anchored at its right edge while the others are centred, so the
  // clearance needed is the whole final label plus half of the one before it. Comparing
  // against the final width alone leaves them overlapping by that missing half.
  const estimateLabelWidth = (point) => formatPeriodLabel(point.key, report.granularity).length * 6;
  const labelPoints = pointMarkup.filter((point, index) => index === 0 || index === pointMarkup.length - 1 || index % Math.ceil(pointMarkup.length / 6) === 0).filter((point, index, selectedPoints) => {
    if (index !== selectedPoints.length - 2) {
      return true;
    }

    const finalPoint = selectedPoints[selectedPoints.length - 1];
    const requiredGap = estimateLabelWidth(finalPoint) + estimateLabelWidth(point) / 2 + 8;
    return finalPoint.x - point.x >= requiredGap;
  });
  const labels = labelPoints.map((point, index) => `<text x="${point.x}" y="220" text-anchor="${index === labelPoints.length - 1 ? "end" : "middle"}" class="chart-label">${escapeHtml(formatPeriodLabel(point.key, report.granularity))}</text>`).join("");
  const yTicks = Array.from({ length: Math.round(axisRange / tickSize) + 1 }, (_, index) => {
    const value = axisMinimum + tickSize * index;
    const y = top + height - ((value - axisMinimum) / axisRange) * height;
    return `<line x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" class="chart-grid"></line><text x="${left - 8}" y="${y + 4}" text-anchor="end" class="chart-label">${escapeHtml(formatCompactMoney(value))}</text>`;
  }).join("");
  const zeroLine = minimum < 0 && maximum > 0 ? `<line x1="${left}" y1="${top + height - ((0 - axisMinimum) / axisRange) * height}" x2="${left + width}" y2="${top + height - ((0 - axisMinimum) / axisRange) * height}" class="chart-zero"></line>` : "";
  const axes = `${yTicks}${zeroLine}<line x1="${left}" y1="${top + height}" x2="${left + width}" y2="${top + height}" class="chart-axis"></line>`;
  const chartLine = `<path d="${path}" fill="none" stroke="#2a78d6" stroke-width="2"></path>`;
  const hoverMarkup = '<line y1="22" y2="197" class="chart-crosshair" hidden></line><text class="chart-tooltip" hidden></text>';

  return renderChart(
    "revenue-over-time",
    "Revenue over time",
    "Revenue over every available period, with the selected period highlighted.",
    `<g data-revenue-chart>${axes}${chartLine}${dots}${hoverMarkup}${selectedMarkup}${labels}</g>`,
  );
}

function renderBreakdownChart(dimension, items) {
  const visible = items.slice(0, TOP_ROW_COUNT);
  const metric = visible.some((item) => item.profit < 0) ? "profit" : "revenue";
  const viewBoxWidth = 720;
  const labelPadding = 18;
  const labelStart = 8;
  const maximumGutter = Math.floor(viewBoxWidth / 3);
  const maximumLabelLength = Math.floor((maximumGutter - labelStart - labelPadding) / 8);
  const maximum = Math.max(1, ...visible.map((item) => Math.abs(item[metric])));
  const widestLabel = Math.max(...visible.map((item) => (
    String(item.value).slice(0, maximumLabelLength).length * 8
  )), 0);
  const plotStart = Math.min(maximumGutter, Math.max(70, Math.ceil(widestLabel + labelStart + labelPadding)));
  const plotEnd = viewBoxWidth - 16;
  const baseline = metric === "profit" ? (plotStart + plotEnd) / 2 : plotStart;
  const scale = (metric === "profit" ? Math.min(baseline - plotStart, plotEnd - baseline) : plotEnd - plotStart) / maximum;
  const colors = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#184f95"];
  const bars = visible.map((item, index) => {
    const y = 27 + index * 25;
    const value = item[metric];
    const barWidth = Math.abs(value) * scale;
    const x = value < 0 ? baseline - barWidth : baseline;
    const fill = metric === "profit" ? (value < 0 ? "#e34948" : "#2a78d6") : colors[Math.round((index / Math.max(visible.length - 1, 1)) * (colors.length - 1))];
    const valueLabel = formatMoney(value);
    const labelWidth = valueLabel.length * 7;
    const outsideFits = value < 0
      ? x - 6 - labelWidth >= plotStart
      : x + barWidth + 6 + labelWidth <= plotEnd;
    const inside = !outsideFits;
    const valueX = value < 0
      ? (inside ? x + 6 : x - 6)
      : (inside ? x + barWidth - 6 : x + barWidth + 6);
    const anchor = value < 0 ? (inside ? "start" : "end") : (inside ? "end" : "start");
    const fullLabel = String(item.value);
    const truncatedLabel = fullLabel.length > maximumLabelLength ? `${fullLabel.slice(0, maximumLabelLength - 1)}…` : fullLabel;
    const title = truncatedLabel === fullLabel ? "" : `<title>${escapeHtml(fullLabel)}</title>`;
    return `<text x="${labelStart}" y="${y + 5}" class="chart-label">${title}${escapeHtml(truncatedLabel)}</text><rect x="${x}" y="${y - 8}" width="${barWidth}" height="16" rx="4" fill="${fill}"></rect><text x="${valueX}" y="${y + 5}" text-anchor="${anchor}" class="chart-value">${escapeHtml(valueLabel)}</text>`;
  }).join("");
  const zeroLine = metric === "profit" ? `<line x1="${baseline}" y1="12" x2="${baseline}" y2="${visible.length * 25 + 10}" class="chart-zero"></line>` : "";
  const title = `${dimension.label} ${metric}`;

  return renderChart(
    `breakdown-${dimension.key}`,
    title,
    `Top ${Math.min(TOP_ROW_COUNT, visible.length)} ${dimension.noun} by revenue, shown as ${metric}.`,
    `${zeroLine}${bars}`,
  );
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

function renderCustomerIntelligence(intelligence) {
  const concentration = `<div class="summary-grid customer-kpis">${intelligence.concentration.map((item) => `<article class="summary-card"><span class="summary-card-label">Top ${item.percent}% of customers</span><strong class="summary-card-value">${formatPercent(item.revenueShare)}</strong><span class="summary-card-detail">of revenue</span></article>`).join("")}</div>`;
  const renderIntelligenceTable = (sectionKey, itemNoun, headers, items, emptyRow, renderRow) => {
    const isExpanded = expandedSections.has(sectionKey);
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

function renderRevenueOverTimeTable(report) {
  const sectionKey = "revenue-over-time";
  const isExpanded = expandedSections.has(sectionKey);
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

function renderReport(report) {
  return [
    renderAlerts(report.alerts),
    renderSummaryCards(report),
    renderCustomerIntelligence(report.customerIntelligence),
    renderReportSection("revenue-over-time", "Revenue over time", `${renderRevenueOverTimeChart(report)}${renderRevenueOverTimeTable(report)}`),
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
  renderFocusFilters();
  updateSectionToggleLabel();
  reportOutput.innerHTML = renderReport(currentReport);
  downloadReportButton.hidden = false;
  reportHeadingHint.textContent =
    `Showing ${formatPeriodLabel(selectedPeriodKey, selectedGranularity)}.`;
}

function generateReport() {
  reportOutput.textContent = "Generating report...";
  window.setTimeout(renderCurrentReport, 0);
}
