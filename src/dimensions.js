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

export { expectedColumns, requiredColumns, optionalSourceColumns, DIMENSIONS, headerSynonyms, NO_PROMOTION_LABEL, TOP_ROW_COUNT, DEFAULT_COLLAPSED_REPORT_SECTIONS };

