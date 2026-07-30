import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted && character === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

async function readCsvFixture(relativePath) {
  const text = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const [headers, ...values] = parseCsv(text);

  return {
    headers,
    rawRows: values.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))),
  };
}

function assertSvgNumbersAreWithinViewBox(markup, { width = 720, height = 260 } = {}) {
  const attributePattern = /\b(?:x|x1|x2|cx|y|y1|y2|cy|width|height)="(-?\d+(?:\.\d+)?)"/g;
  let match;

  assert.doesNotMatch(markup, /NaN/);
  while ((match = attributePattern.exec(markup))) {
    const value = Number(match[1]);
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0);
    assert.ok(value <= Math.max(width, height));
  }
}

export { assertSvgNumbersAreWithinViewBox, parseCsv, readCsvFixture };
