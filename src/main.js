"use strict";

import { DEFAULT_COLLAPSED_REPORT_SECTIONS } from "./dimensions.js";
import { escapeHtml, formatMoney } from "./format.js";
import { buildReport, formatPeriodLabel, getSortedPeriodKeys } from "./report.js";
import { ingestRows } from "./parse.js";
import { KAGGLE_DATASET_URL, embeddedSuperstoreRows, readCsvTextAsRows, readFileAsRows } from "./sources.js";
import { buildReportCsv } from "./csv.js";
import { niceChartTickSize } from "./charts.js";
import { renderReport } from "./render.js";
import { createAppState } from "./state.js";

const salesFileInput = document.querySelector("#sales-file");
const uploadError = document.querySelector("#upload-error");
const selectedFileName = document.querySelector("#selected-file-name");
const generateReportButton = document.querySelector("#generate-report-button");
const downloadReportButton = document.querySelector("#download-report-button");
const loadSuperstoreButton = document.querySelector("#load-superstore-button");
const fetchSuperstoreButton = document.querySelector("#fetch-superstore-button");
const apiStatus = document.querySelector("#api-status");
const reportOutput = document.querySelector(".report-output");
const reportHeadingHint = document.querySelector("#report-heading-hint");
const reportControls = document.querySelector("#report-controls");
const granularitySelect = document.querySelector("#granularity-select");
const periodSelect = document.querySelector("#period-select");
const focusFiltersElement = document.querySelector("#focus-filters");
const toggleAllSectionsButton = document.querySelector("#toggle-all-sections-button");
const historyPanel = document.querySelector("#history-panel");
const historyStatus = document.querySelector("#history-status");
const uploadHistory = document.querySelector("#upload-history");
const uploadTrends = document.querySelector("#upload-trends");
const initialReportHeadingHint = reportHeadingHint.textContent;
const TREND_PREVIEW_ROWS = 12;
const state = createAppState();

salesFileInput.addEventListener("change", handleFileInputChange);
loadSuperstoreButton.addEventListener("click", loadSuperstoreData);
fetchSuperstoreButton.addEventListener("click", fetchSuperstoreFromApi);
generateReportButton.addEventListener("click", generateReport);
downloadReportButton.addEventListener("click", downloadCurrentReport);
document.querySelector("#reset-button").addEventListener("click", resetApp);
granularitySelect.addEventListener("change", handleGranularityChange);
periodSelect.addEventListener("change", handlePeriodChange);
toggleAllSectionsButton.addEventListener("click", toggleAllReportSections);
reportOutput.addEventListener("click", handleReportOutputClick);
reportOutput.addEventListener("input", handleReportOutputInput);
reportOutput.addEventListener("pointermove", handleChartPointerMove);
reportOutput.addEventListener("pointerleave", hideChartCrosshair);
uploadHistory.addEventListener("click", handleUploadHistoryClick);
uploadTrends.addEventListener("click", handleUploadTrendsClick);
loadUploadHistory();

function resetApp() {
  salesFileInput.value = "";
  Object.assign(state, createAppState());
  focusFiltersElement.innerHTML = "";
  clearSelectedFile(); clearUploadError(); setApiStatus(""); setGenerateButtonEnabled(false);
  reportOutput.innerHTML = ""; downloadReportButton.hidden = true; reportControls.hidden = true;
  toggleAllSectionsButton.textContent = "Collapse all"; granularitySelect.value = "month";
  periodSelect.innerHTML = ""; reportHeadingHint.textContent = initialReportHeadingHint;
}

function handleFileInputChange(event) { const [file] = event.target.files; if (file) handleFileSelection(file); }
async function handleFileSelection(file) {
  setGenerateButtonEnabled(false);
  if (!isSupportedFileType(file)) { clearSelectedFile(); showUploadError("Please choose a CSV, XLS, or XLSX file."); return; }
  if (file.size === 0) { clearSelectedFile(); showUploadError("This file is empty."); return; }
  clearUploadError(); await parseAndValidateFile(file);
}
function isSupportedFileType(file) { return [".csv", ".xls", ".xlsx"].includes(file.name.slice(file.name.lastIndexOf(".")).toLowerCase()); }
function showUploadError(message) { uploadError.textContent = message; uploadError.hidden = false; }
function clearUploadError() { uploadError.textContent = ""; uploadError.hidden = true; }
function clearSelectedFile() { selectedFileName.textContent = ""; }
function setGenerateButtonEnabled(isEnabled) { generateReportButton.disabled = !isEnabled; }

function applyIngestedRows(result, sourceLabel) {
  state.parsedSalesRows = result.rows; state.invalidSalesRows = result.invalidRows; state.currentReport = null;
  state.sourceLabel = sourceLabel; state.persistedUploadId = null; state.isStoredReport = false;
  state.selectedPeriodKey = null; state.expandedSections.clear(); state.collapsedReportSections.clear();
  DEFAULT_COLLAPSED_REPORT_SECTIONS.forEach((section) => state.collapsedReportSections.add(section));
  state.tableSorts.clear(); state.tableSearches.clear(); state.focusFilters.clear(); focusFiltersElement.innerHTML = "";
  setGenerateButtonEnabled(false); reportControls.hidden = true;
  if (result.missingColumns.length) { clearSelectedFile(); showUploadError(`Missing required column(s): ${result.missingColumns.join(", ")}.`); return; }
  state.availableDimensionKeys = result.availableDimensionKeys;
  if (!state.parsedSalesRows.length) { clearSelectedFile(); showUploadError("No valid sales rows were found in this file."); return; }
  selectedFileName.textContent = `Loaded: ${sourceLabel} (${state.parsedSalesRows.length.toLocaleString()} rows)`;
  setGenerateButtonEnabled(true); reportControls.hidden = false; populatePeriods();
  if (state.invalidSalesRows.length) { showUploadError(`${state.invalidSalesRows.length} row${state.invalidSalesRows.length === 1 ? " was" : "s were"} skipped due to invalid dates or numbers.`); return; }
  clearUploadError();
}
async function parseAndValidateFile(file) {
  try { applyIngestedRows(ingestRows(await readFileAsRows(file, XLSX)), file.name); }
  catch (error) { showUploadError(`Unable to read this file: ${error.message}`); }
}
function loadSuperstoreData() {
  if (!window.SUPERSTORE_DATA) { showUploadError("Embedded Superstore data is unavailable."); return; }
  salesFileInput.value = ""; clearUploadError(); setApiStatus("");
  applyIngestedRows(ingestRows(embeddedSuperstoreRows(window.SUPERSTORE_DATA)), "Superstore dataset");
}
function setApiStatus(message, status) { apiStatus.textContent = message; if (status) apiStatus.dataset.state = status; else delete apiStatus.dataset.state; }

function readZip64Sizes(view, extraStart, extraLength) {
  let offset = extraStart; const end = extraStart + extraLength;
  while (offset + 4 <= end) { const id = view.getUint16(offset, true); const size = view.getUint16(offset + 2, true); if (id === 1 && size >= 16) return { uncompressedSize: Number(view.getBigUint64(offset + 4, true)), compressedSize: Number(view.getBigUint64(offset + 12, true)) }; offset += 4 + size; }
  return null;
}
async function extractCsvText(buffer) {
  const view = new DataView(buffer); let offset = 0; let entry;
  while (offset + 30 <= buffer.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true); const nameLength = view.getUint16(offset + 26, true); const extraLength = view.getUint16(offset + 28, true); const dataStart = offset + 30 + nameLength + extraLength;
    let compressedSize = view.getUint32(offset + 18, true); let uncompressedSize = view.getUint32(offset + 22, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) { const sizes = readZip64Sizes(view, offset + 30 + nameLength, extraLength); if (!sizes) throw new Error("ZIP64 entry is missing its extended size field."); ({ compressedSize, uncompressedSize } = sizes); }
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 30, nameLength));
    if (name.toLowerCase().endsWith(".csv")) { entry = { method, dataStart, compressedSize, uncompressedSize }; break; }
    offset = dataStart + compressedSize;
  }
  if (!entry) throw new Error("No CSV file was found inside the downloaded archive.");
  if (![0, 8].includes(entry.method)) throw new Error(`Unsupported compression method ${entry.method}.`);
  const payload = new Uint8Array(buffer, entry.dataStart, entry.compressedSize);
  const bytes = entry.method === 8 ? new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) : payload;
  if (bytes.length !== entry.uncompressedSize) throw new Error(`Corrupt archive: expected ${entry.uncompressedSize} bytes, got ${bytes.length}.`);
  return new TextDecoder("windows-1252").decode(bytes);
}
async function fetchSuperstoreFromApi() {
  fetchSuperstoreButton.disabled = true; setApiStatus("Requesting the dataset from the Kaggle API…", "loading");
  try {
    const response = await fetch(KAGGLE_DATASET_URL); if (!response.ok) throw new Error(`Kaggle responded with HTTP ${response.status}.`);
    const buffer = await response.arrayBuffer(); if (new TextDecoder().decode(new Uint8Array(buffer, 0, 2)) !== "PK") throw new Error("Kaggle returned a page instead of a dataset.");
    setApiStatus("Unpacking and parsing the dataset…", "loading"); salesFileInput.value = ""; clearUploadError();
    applyIngestedRows(ingestRows(readCsvTextAsRows(await extractCsvText(buffer), XLSX)), "Superstore dataset (live from Kaggle API)");
    if (state.parsedSalesRows.length) setApiStatus(`Fetched live from the Kaggle API: ${state.parsedSalesRows.length.toLocaleString()} rows (${Math.round(buffer.byteLength / 1024)} KB downloaded).`, "success");
  } catch (error) { setApiStatus(`Live fetch failed: ${error.message} Use "Load Superstore Data" for the offline copy.`, "error"); }
  finally { fetchSuperstoreButton.disabled = false; }
}

function populatePeriods() {
  const periodKeys = (state.isStoredReport
    ? state.storedPeriodKeysByGranularity?.[state.selectedGranularity] || []
    : getSortedPeriodKeys(state.parsedSalesRows, state.selectedGranularity)
  ).slice().reverse();
  if (!periodKeys.includes(state.selectedPeriodKey)) state.selectedPeriodKey = periodKeys[0] || null;
  periodSelect.innerHTML = periodKeys.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(formatPeriodLabel(key, state.selectedGranularity))}</option>`).join("");
  periodSelect.value = state.selectedPeriodKey || "";
}
function handleGranularityChange() { state.selectedGranularity = granularitySelect.value; state.expandedSections.clear(); state.focusFilters.clear(); state.selectedPeriodKey = null; populatePeriods(); if (state.isStoredReport) loadStoredReport(); else renderCurrentReport(); }
function handlePeriodChange() { state.selectedPeriodKey = periodSelect.value; state.expandedSections.clear(); state.focusFilters.clear(); if (state.isStoredReport) loadStoredReport(); else renderCurrentReport(); }
function renderFocusFilters() { focusFiltersElement.innerHTML = [...state.focusFilters].map(([key, value]) => `<button type="button" data-remove-focus="${escapeHtml(key)}">${escapeHtml(value)} ×</button>`).join(""); }
function rerenderReport() { reportOutput.innerHTML = renderReport(state.currentReport, state); }
function handleReportOutputClick(event) {
  const remove = event.target.closest("[data-remove-focus]"); if (remove && state.currentReport) { state.focusFilters.delete(remove.dataset.removeFocus); renderCurrentReport(); return; }
  const sort = event.target.closest("[data-sort-section]"); if (sort && state.currentReport) { const current = state.tableSorts.get(sort.dataset.sortSection); state.tableSorts.set(sort.dataset.sortSection, { column: sort.dataset.sortColumn, direction: current && current.column === sort.dataset.sortColumn && current.direction === "asc" ? "desc" : "asc" }); rerenderReport(); return; }
  const focus = event.target.closest("[data-focus-dimension]"); if (focus && state.currentReport && !event.target.closest("button, input, a")) { state.focusFilters.set(focus.dataset.focusDimension, focus.dataset.focusValue); renderCurrentReport(); return; }
  const chart = event.target.closest("[data-chart]"); if (chart && state.currentReport) { state.collapsedCharts.has(chart.dataset.chart) ? state.collapsedCharts.delete(chart.dataset.chart) : state.collapsedCharts.add(chart.dataset.chart); rerenderReport(); return; }
  const sectionToggle = event.target.closest("[data-report-section]"); if (sectionToggle && state.currentReport) { const section = sectionToggle.dataset.reportSection; state.collapsedReportSections.has(section) ? state.collapsedReportSections.delete(section) : state.collapsedReportSections.add(section); updateSectionToggleLabel(); rerenderReport(); return; }
  const toggle = event.target.closest("[data-section]"); if (!toggle || !state.currentReport) return; state.expandedSections.has(toggle.dataset.section) ? state.expandedSections.delete(toggle.dataset.section) : state.expandedSections.add(toggle.dataset.section); rerenderReport();
}
function handleReportOutputInput(event) { const input = event.target.closest("[data-table-search]"); if (!input || !state.currentReport) return; state.tableSearches.set(input.dataset.tableSearch, input.value); rerenderReport(); const replacement = reportOutput.querySelector(`[data-table-search="${CSS.escape(input.dataset.tableSearch)}"]`); if (replacement) { replacement.focus(); replacement.setSelectionRange(input.selectionStart, input.selectionEnd); } }
function handleChartPointerMove(event) {
  const chart = event.target.closest("[data-revenue-chart]"); if (!chart || !state.currentReport) { hideChartCrosshair(); return; }
  const svg = chart.ownerSVGElement; const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; const location = point.matrixTransform(svg.getScreenCTM().inverse()); const points = state.currentReport.revenueByPeriod; const index = Math.max(0, Math.min(points.length - 1, Math.round(((location.x - 58) / 622) * (points.length - 1)))); const period = points[index]; const x = 58 + (index / Math.max(points.length - 1, 1)) * 622; const minimum = Math.min(...points.map((item) => item.revenue)); const maximum = Math.max(...points.map((item) => item.revenue), 1); const tick = niceChartTickSize(Math.max(maximum, Math.abs(minimum)) / 3); const axisMinimum = minimum < 0 ? tick * Math.floor(minimum / tick) : 0; const axisMaximum = tick * Math.ceil(maximum / tick); const y = 22 + 175 - ((period.revenue - axisMinimum) / (axisMaximum - axisMinimum)) * 175; const crosshair = chart.querySelector(".chart-crosshair"); const tooltip = chart.querySelector(".chart-tooltip"); crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x); crosshair.hidden = false; tooltip.setAttribute("x", Math.min(x + 8, 530)); tooltip.setAttribute("y", Math.max(y - 12, 18)); tooltip.textContent = `${formatPeriodLabel(period.key, state.currentReport.granularity)}: ${formatMoney(period.revenue)}`; tooltip.hidden = false;
}
function hideChartCrosshair() { reportOutput.querySelectorAll(".chart-crosshair, .chart-tooltip").forEach((element) => { element.hidden = true; }); }
function getRenderedReportSectionKeys() { return [...reportOutput.querySelectorAll("[data-report-section]")].map((toggle) => toggle.dataset.reportSection); }
function updateSectionToggleLabel() { if (!state.currentReport) return; const keys = getRenderedReportSectionKeys(); toggleAllSectionsButton.textContent = keys.length && keys.every((key) => state.collapsedReportSections.has(key)) ? "Expand all" : "Collapse all"; }
function toggleAllReportSections() { if (!state.currentReport) return; const keys = getRenderedReportSectionKeys(); if (keys.every((key) => state.collapsedReportSections.has(key))) state.collapsedReportSections.clear(); else keys.forEach((key) => state.collapsedReportSections.add(key)); updateSectionToggleLabel(); rerenderReport(); }
function getReportFileName(report) { return report.periodKey ? `salesscope-report-${report.periodKey}.csv` : `salesscope-report-${new Date().toISOString().slice(0, 10)}.csv`; }
function downloadCurrentReport() { if (!state.currentReport) return; const objectUrl = URL.createObjectURL(new Blob([buildReportCsv(state.currentReport)], { type: "text/csv;charset=utf-8;" })); const link = document.createElement("a"); link.href = objectUrl; link.download = getReportFileName(state.currentReport); document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0); }
function renderCurrentReport() { if (!state.selectedPeriodKey) return; state.isStoredReport = false; reportControls.hidden = false; state.currentReport = buildReport(state.parsedSalesRows, { granularity: state.selectedGranularity, periodKey: state.selectedPeriodKey }, { focusFilters: state.focusFilters, availableDimensionKeys: state.availableDimensionKeys, invalidRows: state.invalidSalesRows }); renderFocusFilters(); rerenderReport(); updateSectionToggleLabel(); downloadReportButton.hidden = false; reportHeadingHint.textContent = `Showing ${formatPeriodLabel(state.selectedPeriodKey, state.selectedGranularity)}.`; }
function generateReport() { reportOutput.textContent = "Generating report..."; window.setTimeout(() => { renderCurrentReport(); persistCurrentUpload(); }, 0); }

async function persistCurrentUpload() {
  if (state.persistedUploadId || !state.parsedSalesRows.length || window.location.protocol === "file:") return;
  try {
    const response = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: state.sourceLabel || "Sales upload", source: "browser", rows: state.parsedSalesRows }) });
    if (!response.ok) return;
    const upload = await response.json(); state.persistedUploadId = upload.id; loadUploadHistory();
  } catch { /* A static host has no API; the report remains fully local. */ }
}

async function loadUploadHistory() {
  if (window.location.protocol === "file:") return;
  try {
    const response = await fetch("/api/uploads");
    if (!response.ok) throw new Error("History is unavailable.");
    const { uploads } = await response.json();
    historyPanel.hidden = false;
    historyStatus.textContent = uploads.length ? "Saved on this server." : "Reports you generate here will be saved on this server.";
    uploadHistory.innerHTML = uploads.map((upload) => `<article class="history-upload"><div><div class="history-upload-name">${escapeHtml(upload.name)}</div><p class="history-upload-meta">${upload.rowCount.toLocaleString()} rows · ${escapeHtml(new Date(upload.uploadedAt).toLocaleDateString())}</p></div><div class="history-upload-actions"><button type="button" data-load-upload="${upload.id}" data-upload-name="${escapeHtml(upload.name)}" data-upload-period="${escapeHtml(upload.latestPeriod || "")}">Load latest report</button>${state.pendingDeleteUploadId === String(upload.id)
      ? `<button type="button" class="history-delete history-delete-confirm" data-confirm-delete="${upload.id}">Delete permanently</button><button type="button" class="history-delete-cancel" data-cancel-delete>Cancel</button>`
      : `<button type="button" class="history-delete" data-delete-upload="${upload.id}">Delete</button>`}</div></article>`).join("");
    loadUploadTrends();
  } catch { historyPanel.hidden = true; }
}

async function loadUploadTrends() {
  try {
    const response = await fetch("/api/uploads/trends");
    if (!response.ok) return;
    const trends = await response.json();
    if (!trends.periods.length) { uploadTrends.innerHTML = ""; return; }
    // Every shared month at once pushed the report itself several screens down,
    // so this opens closed and shows only the most recent months until asked.
    const visiblePeriods = state.trendRowsExpanded ? trends.periods : trends.periods.slice(-TREND_PREVIEW_ROWS);
    const headings = trends.uploads.map((upload) => `<th scope="col">${escapeHtml(upload.name)}</th>`).join("");
    const rows = visiblePeriods.map((period) => `<tr><th scope="row">${escapeHtml(formatPeriodLabel(period.key, "month"))}</th>${trends.uploads.map((upload) => `<td>${formatMoney(period.revenueByUpload[upload.id])}</td>`).join("")}</tr>`).join("");
    const monthLabel = `${trends.periods.length} shared month${trends.periods.length === 1 ? "" : "s"}`;
    const rowToggle = trends.periods.length > TREND_PREVIEW_ROWS
      ? `<button type="button" class="trend-row-toggle" data-toggle-trend-rows>${state.trendRowsExpanded ? `Show ${TREND_PREVIEW_ROWS} most recent` : `Show all ${trends.periods.length} months`}</button>`
      : "";
    uploadTrends.innerHTML = `<details class="trend-details"${state.trendsExpanded ? " open" : ""}><summary class="trend-summary">Revenue across uploads <span class="trend-count">${monthLabel}</span></summary><p class="trend-note">Months shown occur in at least two saved uploads.</p><div class="table-wrap"><table class="trend-table"><thead><tr><th scope="col">Month</th>${headings}</tr></thead><tbody>${rows}</tbody></table></div>${rowToggle}</details>`;
    // "toggle" does not bubble, so delegation on the container cannot see it.
    uploadTrends.querySelector(".trend-details").addEventListener("toggle", (event) => { state.trendsExpanded = event.target.open; });
  } catch { uploadTrends.innerHTML = ""; }
}

function handleUploadTrendsClick(event) {
  if (!event.target.closest("[data-toggle-trend-rows]")) return;
  state.trendRowsExpanded = !state.trendRowsExpanded;
  loadUploadTrends();
}

async function handleUploadHistoryClick(event) {
  // Deleting a saved upload cannot be undone, so the first click only arms the
  // second one rather than destroying rows outright.
  const askDelete = event.target.closest("[data-delete-upload]");
  if (askDelete) { state.pendingDeleteUploadId = askDelete.dataset.deleteUpload; loadUploadHistory(); return; }
  if (event.target.closest("[data-cancel-delete]")) { state.pendingDeleteUploadId = null; loadUploadHistory(); return; }

  const confirmDelete = event.target.closest("[data-confirm-delete]");
  if (confirmDelete) {
    const uploadId = confirmDelete.dataset.confirmDelete;
    confirmDelete.disabled = true;
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to delete that saved upload.");
      // The open report came from rows that no longer exist, so stop treating it
      // as stored; the period controls would otherwise re-request a dead upload.
      if (state.persistedUploadId === uploadId) { state.persistedUploadId = null; state.isStoredReport = false; }
      state.pendingDeleteUploadId = null;
      await loadUploadHistory();
    } catch (error) { historyStatus.textContent = error.message; confirmDelete.disabled = false; }
    return;
  }

  const button = event.target.closest("[data-load-upload]");
  if (!button || !button.dataset.uploadPeriod) return;
  button.disabled = true;
  try {
    state.persistedUploadId = button.dataset.loadUpload; state.sourceLabel = button.dataset.uploadName;
    state.selectedGranularity = "month"; state.selectedPeriodKey = button.dataset.uploadPeriod;
    await loadStoredReport();
    document.querySelector(".report-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { historyStatus.textContent = error.message; }
  finally { button.disabled = false; }
}

async function loadStoredReport() {
  if (!state.persistedUploadId || !state.selectedPeriodKey) return;
  const response = await fetch(`/api/uploads/${encodeURIComponent(state.persistedUploadId)}/report?granularity=${encodeURIComponent(state.selectedGranularity)}&period=${encodeURIComponent(state.selectedPeriodKey)}`);
  if (!response.ok) throw new Error("Unable to load that saved report.");
  const report = await response.json();
  state.currentReport = report; state.isStoredReport = true;
  state.storedPeriodKeysByGranularity = report.periodKeysByGranularity;
  state.selectedGranularity = report.granularity; state.selectedPeriodKey = report.periodKey;
  granularitySelect.value = state.selectedGranularity; populatePeriods();
  reportControls.hidden = false; focusFiltersElement.innerHTML = ""; rerenderReport(); updateSectionToggleLabel(); downloadReportButton.hidden = false;
  reportHeadingHint.textContent = `Showing ${formatPeriodLabel(state.selectedPeriodKey, state.selectedGranularity)} from saved upload ${state.sourceLabel}.`;
}
