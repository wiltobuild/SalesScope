// Re-downloads the Superstore dataset from Kaggle and regenerates superstore-data.js.
//
// This is a maintenance command, NOT a live data connection: the dataset is frozen at
// 9,994 rows covering 2014-2017, so a refresh returns identical data. It exists so the
// generated file is reproducible rather than a one-off artifact.
//
// The download needs no authentication, so there is deliberately no API key handling.
import fs from "node:fs";
import zlib from "node:zlib";

const datasetUrl = "https://www.kaggle.com/api/v1/datasets/download/vivek468/superstore-dataset-final";
const root = new URL("../", import.meta.url);
const ZIP64_SENTINEL = 0xffffffff;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const expected = { rows: 9994, orders: 5009, sales: "2297200.86" };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

// Kaggle serves this dataset as a ZIP64 archive, so both size fields in the local file
// header are 0xFFFFFFFF and the real 64-bit sizes live in the extra field. Reading the
// header fields directly yields the sentinel, not a length.
function readZip64Sizes(extraField) {
  let offset = 0;

  while (offset + 4 <= extraField.length) {
    const headerId = extraField.readUInt16LE(offset);
    const dataSize = extraField.readUInt16LE(offset + 2);

    if (headerId === 0x0001 && dataSize >= 16) {
      return {
        uncompressedSize: Number(extraField.readBigUInt64LE(offset + 4)),
        compressedSize: Number(extraField.readBigUInt64LE(offset + 12)),
      };
    }

    offset += 4 + dataSize;
  }

  return null;
}

function extractCsv(zip) {
  let offset = 0;

  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === LOCAL_FILE_HEADER_SIGNATURE) {
    const method = zip.readUInt16LE(offset + 8);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const extraField = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + extraLength);
    const start = offset + 30 + nameLength + extraLength;

    let compressedSize = zip.readUInt32LE(offset + 18);
    let uncompressedSize = zip.readUInt32LE(offset + 22);

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      const zip64Sizes = readZip64Sizes(extraField);

      if (!zip64Sizes) {
        throw new Error(`ZIP64 entry "${name}" is missing its extended size field.`);
      }

      compressedSize = zip64Sizes.compressedSize;
      uncompressedSize = zip64Sizes.uncompressedSize;
    }

    if (name.endsWith(".csv")) {
      const payload = zip.subarray(start, start + compressedSize);
      const data = method === 8 ? zlib.inflateRawSync(payload) : method === 0 ? payload : null;

      if (!data) {
        throw new Error(`Unsupported compression method ${method} for "${name}".`);
      }

      if (data.length !== uncompressedSize) {
        throw new Error(
          `Corrupt ZIP entry "${name}": expected ${uncompressedSize} bytes, got ${data.length}.`,
        );
      }

      return data;
    }

    offset = start + compressedSize;
  }

  throw new Error("CSV entry not found in ZIP.");
}

const response = await fetch(datasetUrl);
const zip = Buffer.from(await response.arrayBuffer());

// A redirect to an HTML page can arrive as HTTP 200, so check the payload is really a ZIP
// before trusting any of it.
if (!response.ok || zip.subarray(0, 2).toString() !== "PK") {
  throw new Error(`Kaggle did not return a ZIP file (HTTP ${response.status}).`);
}

const csv = extractCsv(zip);
// The file is Windows-1252, not UTF-8; fatal decoding catches a changed encoding.
const text = new TextDecoder("windows-1252", { fatal: true }).decode(csv);
const rows = parseCsv(text);
const headers = rows.shift();
const orderIndex = headers.indexOf("Order ID");
const salesIndex = headers.indexOf("Sales");
const orderCount = new Set(rows.map((row) => row[orderIndex])).size;
const sales = rows.reduce((total, row) => total + Number(row[salesIndex]), 0).toFixed(2);

// Validate before overwriting, so a bad download cannot destroy a working dataset.
if (rows.length !== expected.rows || orderCount !== expected.orders || sales !== expected.sales) {
  throw new Error(
    `Downloaded dataset failed validation: ${rows.length} rows (expected ${expected.rows}), ` +
      `${orderCount} orders (expected ${expected.orders}), sales ${sales} (expected ${expected.sales}). ` +
      "Existing files were left untouched.",
  );
}

fs.writeFileSync(new URL("Superstore.csv", root), csv);
await import("./build-superstore-data.mjs");
console.log(
  `Superstore data refreshed: ${rows.length} rows, ${orderCount} orders, sales ${sales}.`,
);
