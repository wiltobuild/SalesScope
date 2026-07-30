import { DIMENSIONS, NO_PROMOTION_LABEL, TOP_ROW_COUNT } from "./dimensions.js";
import { formatMoney, roundTo } from "./format.js";

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

function calculateAlerts(report, invalidRows = []) {
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

  if (invalidRows.length > 0) {
    alerts.push({
      severity: "info",
      message: `${invalidRows.length} row${invalidRows.length === 1 ? " was" : "s were"} skipped due to invalid data.`,
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

function buildReport(rows, { granularity, periodKey }, {
  focusFilters = new Map(),
  availableDimensionKeys = new Set(DIMENSIONS.map((dimension) => dimension.key)),
  invalidRows = [],
} = {}) {
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

  return {
    ...report,
    customerIntelligence: calculateCustomerIntelligence(report),
    alerts: calculateAlerts(report, invalidRows),
  };
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

export { getWeekStart, getPeriodKey, formatPeriodLabel, groupRowsBy, groupRowsByPeriod, getSortedPeriodKeys, calculateTotals, calculateProfit, calculateBreakdown, calculateBestSellingAndBiggestLossMaker, calculatePeriodComparison, getYearAgoPeriodKey, calculateAlerts, buildReport, calculateCustomerIntelligence };
