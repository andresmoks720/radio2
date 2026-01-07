/*
Data lifetime:
- Raw text: status message strings only.
- Disk: none.
- Network: none.
*/
export const STATUS_MESSAGES = {
  accessRequired: { text: "Enter a session code to continue.", tone: "error" },
  accessRequiredSearch: { text: "Enter a session code to search.", tone: "error" },
  accessRequiredOpen: { text: "Enter a session code before opening.", tone: "error" },
  accessRequiredExport: { text: "Enter a session code before exporting.", tone: "error" },
  accessRequiredParse: { text: "Provide a session code and markdown content.", tone: "error" },
  accessRequiredResult: { text: "Enter a session code before opening a result.", tone: "error" },
  repoInfoRequired: { text: "Enter a GitHub owner and repository name.", tone: "error" },
  repoListOffline: { text: "Offline mode: unable to fetch GitHub repo list.", tone: "error" },
  repoListLoading: { text: ({ path }) => `Loading ${path} listing from GitHub...`, tone: "info" },
  repoListLoaded: {
    text: ({ count, path }) => `Loaded ${count} parsed payload files (.md.data) from ${path}.`,
    tone: "success",
  },
  repoListFailed: { text: ({ detail }) => `Repo list failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  rateLimitWait: {
    text: ({ seconds }) => `GitHub rate limit reached. Retrying in ${seconds}s...`,
    tone: "info",
  },
  fileLoadStarting: { text: "Loading file...", tone: "info" },
  fileLoadFailed: { text: ({ detail }) => `File load failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  fileLoadSuccess: { text: "File loaded successfully.", tone: "success" },
  fileLocalLoadStarting: { text: "Loading local file...", tone: "info" },
  fileLocalLoadSuccess: { text: "Local file processed successfully.", tone: "success" },
  fileMissingLocal: { text: "Choose a local parsed payload file first.", tone: "error" },
  fileParsedOnly: { text: "Only parsed markdown payloads (.md.data) are supported.", tone: "error" },
  fileMissingBundleData: { text: ({ path }) => `Missing export data for ${path}.`, tone: "error" },
  fileLoadOffline: { text: "Offline mode: unable to fetch file from GitHub.", tone: "error" },
  loadMoreHint: { text: "More content will load near the end of the page.", tone: "info" },
  renderFailed: { text: ({ detail }) => `Render failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  chunkRenderFailed: { text: ({ detail }) => `Failed to render chunk.${detail ? ` ${detail}` : ""}`, tone: "error" },
  searchLoadRequired: { text: "Load a file to search.", tone: "error" },
  searchScanning: { text: "Scanning...", tone: "info" },
  searchFailed: { text: ({ detail }) => `Search failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  searchResultLoading: { text: "Loading search result chunk...", tone: "info" },
  searchResultLoaded: { text: "Search result loaded.", tone: "success" },
  exportNothing: { text: "Nothing to export yet.", tone: "error" },
  exportPreparing: { text: "Preparing export...", tone: "info" },
  exportReady: { text: "Export ready.", tone: "success" },
  exportFailed: { text: ({ detail }) => `Export failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  bundleImportSuccess: { text: "Bundle imported.", tone: "success" },
  bundleImportFailed: { text: ({ detail }) => `Bundle import failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  parseUploadStart: { text: "Parsing and uploading to GitHub...", tone: "info" },
  parseUploadSuccess: { text: "Uploaded file.", tone: "success" },
  parseUploadFailed: { text: ({ detail }) => `Upload failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  parseLocalStart: { text: "Parsing for local save...", tone: "info" },
  parseLocalReady: { text: "Local file ready.", tone: "success" },
  parseLocalFailed: { text: ({ detail }) => `Local save failed.${detail ? ` ${detail}` : ""}`, tone: "error" },
  repoUploadMissingInfo: { text: "Provide owner, repo, and target path.", tone: "error" },
  repoUploadNeedsToken: { text: "GitHub token required to upload payload files.", tone: "error" },
  clearedIdle: { text: "Processed content cleared after inactivity.", tone: "info" },
  clearedRemote: { text: "Another tab processed content. Cleared for safety.", tone: "info" },
  searchProgress: { text: ({ current, total }) => `Scanning ${current} of ${total}...` },
  searchResults: {
    text: ({ count }) => `Found ${count} matching chunk${count === 1 ? "" : "s"}.`,
  },
  copySelectionRequired: { text: "Select text in the preview to copy." },
  copyInProgress: { text: "Copying selection..." },
  copySuccess: { text: "Copied to clipboard." },
  copyFallbackSuccess: {
    text: ({ detail }) => `Copied (fallback mode).${detail} Keep the tab focused and use https or localhost.`,
  },
  copyBlocked: { text: ({ detail, hint }) => `Copy blocked (${detail}). ${hint}` },
  copyBlockedGeneric: {
    text: ({ detail }) =>
      `Copy blocked (${detail}). Try: use the Copy button, keep the tab focused, allow clipboard access in site settings, avoid embedded frames or guest mode.`,
  },
};

export function createStatusAdapter({ ui, elements }) {
  const getMessage = (id, data) => {
    const entry = STATUS_MESSAGES[id];
    if (!entry) {
      return "";
    }
    const text = typeof entry.text === "function" ? entry.text(data || {}) : entry.text;
    return text || "";
  };

  const setGlobalStatus = (id, data) => {
    const entry = STATUS_MESSAGES[id];
    if (!entry) {
      return;
    }
    const message = getMessage(id, data);
    const isError = entry.tone === "error";
    const isSuccess = entry.tone === "success";
    ui.setStatus(message, isError, isSuccess);
  };

  const setSearchStatus = (id, data) => {
    elements.searchSummary.textContent = getMessage(id, data);
  };

  const clearSearchStatus = () => {
    elements.searchSummary.textContent = "";
  };

  const setCopyStatus = (id, data) => {
    elements.copyStatus.textContent = getMessage(id, data);
  };

  const clearCopyStatus = () => {
    elements.copyStatus.textContent = "";
  };

  return {
    getMessage,
    setGlobalStatus,
    setSearchStatus,
    clearSearchStatus,
    setCopyStatus,
    clearCopyStatus,
  };
}
