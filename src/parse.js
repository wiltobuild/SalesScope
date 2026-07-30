import { DIMENSIONS, expectedColumns, optionalSourceColumns, requiredColumns, headerSynonyms } from "./dimensions.js";

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
    // Excel's 1900 date system starts at 1899-12-30 after its historic leap-day bug.
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
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



function ingestRows({ rawRows, headers }) {
  const headerMap = normalizeHeaders(headers);
  const missingColumns = validateRequiredColumns(headerMap);
  const availableDimensionKeys = new Set(
    DIMENSIONS.filter((dimension) => dimension.required || headerMap.has(dimension.label))
      .map((dimension) => dimension.key),
  );
  const rows = [];
  const invalidRows = [];

  if (missingColumns.length) {
    return { rows, invalidRows, missingColumns, availableDimensionKeys };
  }

  rawRows.forEach((rawRow) => {
    if (isBlankRow(rawRow, headerMap)) return;
    const row = coerceRow(rawRow, headerMap);
    if (row) rows.push(row); else invalidRows.push(rawRow);
  });
  return { rows, invalidRows, missingColumns, availableDimensionKeys };
}

export { normalizeHeaderName, normalizeHeaders, validateRequiredColumns, isEmptyValue, isBlankRow, parseDate, parseNumber, discountToPromotion, coerceRow, ingestRows };
