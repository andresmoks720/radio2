export function createUi() {
  const elements = {
    statusEl: document.getElementById("status"),
    outputEl: document.getElementById("output"),
    accessPhraseInput: document.getElementById("access-phrase"),
    fileInput: document.getElementById("file-input"),
    loadFileBtn: document.getElementById("load-file"),
    repoOwnerInput: document.getElementById("repo-owner"),
    repoNameInput: document.getElementById("repo-name"),
    repoBranchInput: document.getElementById("repo-branch"),
    loadRepoBtn: document.getElementById("load-repo"),
    repoFileList: document.getElementById("repo-file-list"),
    repoTokenInput: document.getElementById("repo-token"),
    repoPathInput: document.getElementById("repo-path"),
    inactivityTimeoutInput: document.getElementById("inactivity-timeout"),
    repoSpinner: document.getElementById("repo-spinner"),
    themeToggle: document.getElementById("theme-toggle"),
    copyOutputBtn: document.getElementById("copy-output"),
    copyStatus: document.getElementById("copy-status"),
    loadMoreBtn: document.getElementById("load-more"),
    searchInput: document.getElementById("search-input"),
    fileFilterInput: document.getElementById("file-filter"),
    categoryFilter: document.getElementById("category-filter"),
    exportTextBtn: document.getElementById("export-text"),
    exportBundleBtn: document.getElementById("export-bundle"),
    importBundleInput: document.getElementById("import-bundle"),
    perfIndicator: document.getElementById("perf-indicator"),
    historyList: document.getElementById("history-list"),
    toast: document.getElementById("toast"),
    previewMeta: document.getElementById("preview-meta"),
    searchResultsList: document.getElementById("search-results"),
    searchSummary: document.getElementById("search-summary"),
    parseTitleInput: document.getElementById("parse-title"),
    parseContentInput: document.getElementById("parse-content"),
    parseUploadBtn: document.getElementById("parse-upload"),
    parseFileInput: document.getElementById("parse-file"),
    parseMessageInput: document.getElementById("parse-message"),
    parseSaveBtn: document.getElementById("parse-save"),
  };

  function setStatus(message, isError = false, isSuccess = false) {
    elements.statusEl.textContent = message;
    elements.statusEl.classList.toggle("error", isError);
    elements.statusEl.classList.toggle("success", isSuccess);
  }

  function setOutputState(state) {
    elements.outputEl.classList.remove("success", "error");
    if (state) {
      elements.outputEl.classList.add(state);
    }
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    window.setTimeout(() => elements.toast.classList.remove("show"), 2000);
  }

  function setRepoLoading(isLoading) {
    elements.repoSpinner.classList.toggle("active", isLoading);
    elements.loadRepoBtn.disabled = isLoading;
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function appendChildren(element, nodes) {
    element.append(...nodes);
  }

  function clearRepoFileList() {
    clearElement(elements.repoFileList);
  }

  function updatePreview(file) {
    if (!file) {
      elements.previewMeta.textContent = "Select a file to preview.";
      return;
    }
    const status = file.isParsed ? "Parsed (.md.data)" : "Unsupported";
    const size = file.size ? `${file.size} bytes` : "Unknown size";
    elements.previewMeta.textContent = `${file.name} · ${status} · ${size}`;
  }

  function createFileItem(file, handlers) {
    const item = document.createElement("li");
    item.className = "file-item";

    const meta = document.createElement("div");
    meta.className = "file-meta";
    const title = document.createElement("strong");
    title.textContent = file.name;
    const subtitle = document.createElement("span");
    subtitle.textContent = file.path;
    meta.appendChild(title);
    meta.appendChild(subtitle);

    const statusIcon = document.createElement("span");
    statusIcon.className = "icon";
    statusIcon.textContent = "•";

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => handlers.onLoadFile(file));
    actions.appendChild(loadButton);

    item.appendChild(meta);
    item.appendChild(statusIcon);
    item.appendChild(actions);
    item.addEventListener("click", () => handlers.onPreview(file));

    return item;
  }

  function renderFileGroups(entries, handlers) {
    clearRepoFileList();
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.textContent = "No parsed markdown files (.md.data) found.";
      appendChildren(elements.repoFileList, [empty]);
      return;
    }

    const grouped = entries.reduce((acc, entry) => {
      const key = entry.category || "Root";
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(entry);
      return acc;
    }, {});

    Object.keys(grouped)
      .sort()
      .forEach((category) => {
        const header = document.createElement("li");
        header.className = "folder-header";
        header.textContent = category;
        const nodes = [header, ...grouped[category].map((file) => createFileItem(file, handlers))];
        appendChildren(elements.repoFileList, nodes);
      });
  }

  function updateCategoryOptions(entries) {
    const categories = Array.from(new Set(entries.map((entry) => entry.category))).sort();
    clearElement(elements.categoryFilter);
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "All categories";
    appendChildren(elements.categoryFilter, [defaultOption]);
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      appendChildren(elements.categoryFilter, [option]);
    });
  }

  function renderHistory(entries) {
    clearElement(elements.historyList);
    const nodes = entries.map((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.timestamp} · ${entry.size} bytes`;
      return item;
    });
    appendChildren(elements.historyList, nodes);
  }

  function clearSearchResults() {
    clearElement(elements.searchResultsList);
    elements.searchSummary.textContent = "";
  }

  function renderSearchResults(results, query, handlers) {
    clearSearchResults();
    if (!query) {
      return;
    }
    if (!results.length) {
      const item = document.createElement("li");
      item.textContent = "No matches found.";
      appendChildren(elements.searchResultsList, [item]);
      return;
    }

    const nodes = results.map((result) => {
      const item = document.createElement("li");
      item.className = "file-item";
      const meta = document.createElement("div");
      meta.className = "file-meta";
      const title = document.createElement("strong");
      title.textContent = `Chunk ${result.chunkIndex + 1} · ${result.matchCount} match${
        result.matchCount === 1 ? "" : "es"
      }`;
      const subtitle = document.createElement("span");
      subtitle.textContent = result.preview;
      meta.appendChild(title);
      meta.appendChild(subtitle);

      const actions = document.createElement("div");
      actions.className = "file-actions";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.textContent = "Open";
      openButton.addEventListener("click", () => handlers.onOpenResult(result.chunkIndex));
      actions.appendChild(openButton);

      item.appendChild(meta);
      item.appendChild(actions);
      return item;
    });
    appendChildren(elements.searchResultsList, nodes);
  }

  return {
    elements,
    setStatus,
    setOutputState,
    showToast,
    setRepoLoading,
    clearElement,
    appendChildren,
    updatePreview,
    renderFileGroups,
    updateCategoryOptions,
    renderHistory,
    clearSearchResults,
    renderSearchResults,
  };
}
