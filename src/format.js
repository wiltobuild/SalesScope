// Lives here rather than in render.js so csv.js can use it without the export
// layer depending on the presentation layer.
function formatComparisonTitle(granularity) {
  return granularity === "week" ? "Week-over-week comparison" : "Month-over-month comparison";
}

function roundTo(value, decimalPlaces) {
  const multiplier = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
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

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
}

export { escapeHtml, formatComparisonTitle, formatMoney, formatPercent, formatCompactMoney, roundTo };
