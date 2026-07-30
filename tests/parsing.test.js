import assert from "node:assert/strict";
import test from "node:test";

import { ingestRows, parseDate } from "../src/parse.js";

const baseHeaders = ["Date", "Order ID", "Customer", "Product", "Quantity", "Revenue", "Profit", "Discount"];
const baseRow = {
  Date: "3/10/2024",
  "Order ID": "ORD-1",
  Customer: "Customer",
  Product: "Product",
  Quantity: "2",
  Revenue: "100",
  Profit: "25",
  Discount: "0.3",
};

test("parsing derives cost from profit and preserves each fractional discount band", () => {
  const discounts = [0, 0.1, 0.15, 0.2, 0.3, 0.32, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const rawRows = discounts.map((discount, index) => ({
    ...baseRow,
    "Order ID": `ORD-${index}`,
    Discount: String(discount),
  }));
  const { rows, missingColumns } = ingestRows({ rawRows, headers: baseHeaders });

  assert.deepEqual(missingColumns, []);
  assert.equal(rows[0].cost, 75);
  assert.deepEqual(rows.map((row) => row.promotion), ["0% discount", "10% discount", "15% discount", "20% discount", "30% discount", "32% discount", "40% discount", "50% discount", "60% discount", "70% discount", "80% discount", "90% discount"]);
});

test("parsing accepts slash and ISO dates, ignores blank rows, and rejects invalid rows", () => {
  const { rows, invalidRows } = ingestRows({
    headers: baseHeaders,
    rawRows: [baseRow, { ...baseRow, Date: "2024-03-11", "Order ID": "ORD-2" }, {}, { ...baseRow, Revenue: "not a number" }],
  });

  assert.equal(parseDate("3/10/2024").getFullYear(), 2024);
  assert.equal(parseDate("2024-03-11").getMonth(), 2);
  assert.equal(rows.length, 2);
  assert.equal(invalidRows.length, 1);
});

test("cost or profit satisfies validation, and an explicit promotion wins over discount", () => {
  const explicitPromotion = ingestRows({
    headers: [...baseHeaders, "Cost", "Promotion"],
    rawRows: [{ ...baseRow, Cost: "80", Promotion: "VIP offer" }],
  });
  const missingBoth = ingestRows({
    headers: baseHeaders.filter((header) => header !== "Profit"),
    rawRows: [baseRow],
  });

  assert.deepEqual(explicitPromotion.missingColumns, []);
  assert.equal(explicitPromotion.rows[0].promotion, "VIP offer");
  assert.deepEqual(missingBoth.missingColumns, ["Cost (or Profit)"]);
});
