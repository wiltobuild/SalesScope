function createAppState() {
  return {
    parsedSalesRows: [], invalidSalesRows: [], currentReport: null,
    sourceLabel: "", persistedUploadId: null, isStoredReport: false, storedPeriodKeysByGranularity: null,
    selectedGranularity: "month", selectedPeriodKey: null, availableDimensionKeys: new Set(),
    expandedSections: new Set(), collapsedReportSections: new Set(), collapsedCharts: new Set(),
    tableSorts: new Map(), tableSearches: new Map(), focusFilters: new Map(),
  };
}

export { createAppState };
