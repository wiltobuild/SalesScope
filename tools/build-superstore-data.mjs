import fs from "node:fs";

const inputPath = new URL("../Superstore.csv", import.meta.url);
const outputPath = new URL("../superstore-data.js", import.meta.url);
const columns = ["Order Date", "Order ID", "Customer Name", "Product Name", "Quantity", "Sales", "Profit", "Discount", "Category", "Sub-Category", "Region", "State", "City", "Segment", "Ship Mode", "Ship Date"];

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function normalizeDate(value) {
  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`Unsupported date format: ${value}`);
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

const text = new TextDecoder("windows-1252", { fatal: true }).decode(fs.readFileSync(inputPath));
const parsed = parseCsv(text);
const headers = parsed.shift();
const indexes = columns.map((column) => headers.indexOf(column));
if (indexes.some((index) => index === -1)) throw new Error("Expected Superstore columns were not found.");
const rows = parsed.filter((row) => row.length > 1).map((row) => indexes.map((index) => row[index] ?? ""));
const orderDateIndex = columns.indexOf("Order Date");
const shipDateIndex = columns.indexOf("Ship Date");
rows.forEach((row) => {
  row[orderDateIndex] = normalizeDate(row[orderDateIndex]);
  row[shipDateIndex] = normalizeDate(row[shipDateIndex]);
});
console.log(`Converting asserted M/D/YYYY dates for ${rows.length} rows.`);
fs.writeFileSync(outputPath, `window.SUPERSTORE_DATA = ${JSON.stringify({ headers: columns, rows })};\n`, "utf8");
console.log(`Wrote ${new URL(outputPath).pathname}`);
