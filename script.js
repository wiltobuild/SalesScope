"use strict";

const salesFileInput = document.querySelector("#sales-file");
const uploadError = document.querySelector("#upload-error");
const selectedFileName = document.querySelector("#selected-file-name");

salesFileInput.addEventListener("change", handleFileInputChange);

function handleFileInputChange(event) {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  handleFileSelection(file);
}

function handleFileSelection(file) {
  if (!isSupportedFileType(file)) {
    clearSelectedFile();
    showUploadError("Please choose a CSV, XLS, or XLSX file.");
    return;
  }

  if (file.size === 0) {
    clearSelectedFile();
    showUploadError("This file is empty.");
    return;
  }

  clearUploadError();
  showSelectedFile(file);
}

function isSupportedFileType(file) {
  // Extensions are normalized because file names may use uppercase letters.
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return [".csv", ".xls", ".xlsx"].includes(extension);
}

function showUploadError(message) {
  uploadError.textContent = message;
  uploadError.hidden = false;
}

function clearUploadError() {
  uploadError.textContent = "";
  uploadError.hidden = true;
}

function showSelectedFile(file) {
  selectedFileName.textContent = `Selected file: ${file.name}`;
}

function clearSelectedFile() {
  selectedFileName.textContent = "";
}
