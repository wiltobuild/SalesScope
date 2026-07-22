"use strict";

const salesFileInput = document.querySelector("#sales-file");
const uploadError = document.querySelector("#upload-error");
const selectedFileName = document.querySelector("#selected-file-name");
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

salesFileInput.addEventListener("change", handleFileInputChange);

function handleFileInputChange(event) {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  handleFileSelection(file);
}

async function handleFileSelection(file) {
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
