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
const initialReportHeadingHint = reportHeadingHint.textContent;
const state = createAppState();

// Render modules consume these shared interaction collections without touching the DOM.
Object.assign(globalThis, {
  state,
  collapsedCharts: state.collapsedCharts,
  collapsedReportSections: state.collapsedReportSections,
});

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

function resetApp() {
  salesFileInput.value = "";
  Object.assign(state, createAppState());
  Object.assign(globalThis, { state, collapsedCharts: state.collapsedCharts, collapsedReportSections: state.collapsedReportSections });
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
  const periodKeys = getSortedPeriodKeys(state.parsedSalesRows, state.selectedGranularity).reverse();
  if (!periodKeys.includes(state.selectedPeriodKey)) state.selectedPeriodKey = periodKeys[0] || null;
  periodSelect.innerHTML = periodKeys.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(formatPeriodLabel(key, state.selectedGranularity))}</option>`).join("");
  periodSelect.value = state.selectedPeriodKey || "";
}
function handleGranularityChange() { state.selectedGranularity = granularitySelect.value; state.expandedSections.clear(); state.focusFilters.clear(); state.selectedPeriodKey = null; populatePeriods(); renderCurrentReport(); }
function handlePeriodChange() { state.selectedPeriodKey = periodSelect.value; state.expandedSections.clear(); state.focusFilters.clear(); renderCurrentReport(); }
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
function renderCurrentReport() { if (!state.selectedPeriodKey) return; state.currentReport = buildReport(state.parsedSalesRows, { granularity: state.selectedGranularity, periodKey: state.selectedPeriodKey }, { focusFilters: state.focusFilters, availableDimensionKeys: state.availableDimensionKeys, invalidRows: state.invalidSalesRows }); renderFocusFilters(); rerenderReport(); updateSectionToggleLabel(); downloadReportButton.hidden = false; reportHeadingHint.textContent = `Showing ${formatPeriodLabel(state.selectedPeriodKey, state.selectedGranularity)}.`; }
function generateReport() { reportOutput.textContent = "Generating report..."; window.setTimeout(renderCurrentReport, 0); }
