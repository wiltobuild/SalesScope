const KAGGLE_DATASET_URL = "https://www.kaggle.com/api/v1/datasets/download/vivek468/superstore-dataset-final";

function workbookToRows(workbook, xlsx) {
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("The file does not contain a worksheet.");
  }
  const sheet = workbook.Sheets[firstSheetName];
  return {
    rawRows: xlsx.utils.sheet_to_json(sheet, { defval: "" }),
    headers: xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" })[0] || [],
  };
}

async function readFileAsRows(file, xlsx) {
  return workbookToRows(xlsx.read(await file.arrayBuffer()), xlsx);
}

function readCsvTextAsRows(csvText, xlsx) {
  return workbookToRows(xlsx.read(csvText, { type: "string" }), xlsx);
}

function embeddedSuperstoreRows(data) {
  return {
    rawRows: data.rows.map((values) => (
      Object.fromEntries(data.headers.map((header, index) => [header, values[index]]))
    )),
    headers: data.headers,
  };
}

export { KAGGLE_DATASET_URL, workbookToRows, readFileAsRows, readCsvTextAsRows, embeddedSuperstoreRows };
