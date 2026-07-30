import { TOP_ROW_COUNT } from "./dimensions.js";
import { escapeHtml, formatCompactMoney, formatMoney, formatPercent } from "./format.js";
import { formatPeriodLabel } from "./report.js";

function niceChartTickSize(value) {
  const exponent = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  const fraction = value / exponent;
  const roundedFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;

  return roundedFraction * exponent;
}

function renderChart(chartKey, title, description, svg, height = 260, view = {}) {
  const isCollapsed = (view.collapsedCharts || new Set()).has(chartKey);
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

function renderDiscountMarginChart(items, view) {
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
    view,
  );
}

function renderRevenueOverTimeChart(report, view) {
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
    260,
    view,
  );
}

function renderBreakdownChart(dimension, items, view) {
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
    260,
    view,
  );
}

export { niceChartTickSize, renderChart, chartLabel, renderDiscountMarginChart, renderRevenueOverTimeChart, renderBreakdownChart };
