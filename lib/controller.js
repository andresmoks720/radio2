import { createAccessGate } from "./access.js";
import { createChunkService } from "./chunkService.js";
import { createExportController } from "./exports.js";
import { createFileListController } from "./fileList.js";
import { buildSearchPreview, filterByCategory, filterEntries } from "./helpers.js";
import { createParseController } from "./parse.js";
import { createRenderer } from "./rendering.js";
import { createRepoLoader } from "./repoLoader.js";
import { searchPayload } from "./search.js";

/*
Data lifetime:
- Raw text: chunk text during render, search, copy, or export actions.
- Disk: only user-initiated downloads.
- Network: GitHub listing and file fetch only on user actions.
*/
export function createController({ ui, elements, store, sessionState, status, payloadCodec, config }) {
  const broadcast = "BroadcastChannel" in window ? new BroadcastChannel("app-channel") : null;
  const searchTextDecoder = new TextDecoder();
  let inactivityTimer = null;
  let inactivityLimitMs = config.DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
  let searchRunId = 0;

  const getAuthToken = () => {
    const inputToken = elements.repoTokenInput.value.trim();
    if (inputToken) {
      return inputToken;
    }
    return "";
  };

  const accessGate = createAccessGate({
    getValue: () => elements.accessPhraseInput.value,
  });

  const ensureOnline = (statusId) => {
    if (navigator.onLine) {
      return true;
    }
    if (statusId) {
      status.setGlobalStatus(statusId);
    }
    return false;
  };

  const onRateLimit = (wait) => {
    status.setGlobalStatus("rateLimitWait", { seconds: Math.ceil(wait / 1000) });
  };

  const resetInactivityTimer = () => {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(() => {
      if (sessionState.hasDeparsedContent) {
        clearSession({ reasonId: "clearedIdle" });
      }
    }, inactivityLimitMs);
  };

  const renderer = createRenderer({
    ui,
    elements,
    sessionState,
    status,
    payloadCodec,
    config,
    onActivity: resetInactivityTimer,
  });

  let repoLoader = null;

  const fileList = createFileListController({
    ui,
    elements,
    store,
    filterEntries,
    filterByCategory,
    onLoadFile: (file) => repoLoader?.handleRepoFileLoad(file),
    onPreview: ui.updatePreview,
  });

  const decoderFactory = async ({ payload, accessPhrase }) => {
    const chunkService = await createChunkService({
      payload,
      accessPhrase,
      version: config.FORMAT_VERSION,
      payloadCodec,
    });
    return chunkService.decodeChunk;
  };

  repoLoader = createRepoLoader({
    ui,
    elements,
    store,
    sessionState,
    status,
    fileList,
    renderer,
    dataExtension: config.DATA_EXTENSION,
    formatVersion: config.FORMAT_VERSION,
    getAuthToken,
    requireAccessPhrase: (opts) => {
      const result = accessGate.request(opts);
      return result.ok ? result.value : null;
    },
    ensureOnline,
    onRateLimit,
    onPayloadLoaded: (path) => {
      if (broadcast) {
        broadcast.postMessage({ type: "content", file: path });
      }
    },
  });

  const exportController = createExportController({
    ui,
    elements,
    store,
    sessionState,
    status,
    requireAccessPhrase: (opts) => {
      const result = accessGate.request(opts);
      return result.ok ? result.value : null;
    },
    formatVersion: config.FORMAT_VERSION,
    fileList,
    decoderFactory,
    win: window,
    navigatorRef: navigator,
  });

  const parseController = createParseController({
    ui,
    elements,
    status,
    getAuthToken,
    getAccessPhrase: accessGate.read,
    dataExtension: config.DATA_EXTENSION,
    formatVersion: config.FORMAT_VERSION,
    chunkTarget: config.MARKDOWN_CHUNK_TARGET,
    payloadCodec,
    onRateLimit,
  });

  const clearSession = ({ reasonId = "", keepHistory = false } = {}) => {
    ui.clearElement(elements.outputEl);
    store.clearPayloads();
    if (!keepHistory) {
      store.clearHistory();
      ui.clearElement(elements.historyList);
    }
    renderer.resetChunkRenderState();
    sessionState.clearAll();
    ui.setOutputState("");
    status.clearCopyStatus();
    elements.loadMoreBtn.hidden = true;
    ui.updatePreview(null);
    ui.clearSearchResults();
    status.clearSearchStatus();
    if (reasonId) {
      status.setGlobalStatus(reasonId);
    }
    if (broadcast) {
      broadcast.postMessage({ type: "cleared" });
    }
  };

  const updateInactivityTimeout = (value) => {
    const minutes = Number.parseFloat(value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      inactivityLimitMs = config.DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
      elements.inactivityTimeoutInput.value = String(config.DEFAULT_INACTIVITY_MINUTES);
    } else {
      inactivityLimitMs = Math.round(minutes * 60 * 1000);
    }
    resetInactivityTimer();
  };

  const renderChunkAtIndex = async (index) => {
    if (!sessionState.activePayload) {
      status.setGlobalStatus("searchLoadRequired");
      return;
    }
    const access = accessGate.request({
      onMissing: () => status.setGlobalStatus("accessRequiredResult"),
    });
    if (!access.ok) {
      return;
    }
    await renderer.renderChunkAtIndex(index, access.value);
  };

  const handleSearch = async () => {
    const query = elements.searchInput.value.trim();
    const runId = ++searchRunId;
    ui.clearSearchResults();
    if (!query) {
      status.clearSearchStatus();
      return;
    }
    if (!sessionState.activePayload) {
      status.setSearchStatus("searchLoadRequired");
      return;
    }
    const access = accessGate.request({
      onMissing: () => {
        status.setSearchStatus("accessRequiredSearch");
      },
    });
    if (!access.ok) {
      return;
    }
    status.setSearchStatus("searchScanning");

    try {
      const chunkService = await createChunkService({
        payload: sessionState.activePayload,
        accessPhrase: access.value,
        version: config.FORMAT_VERSION,
        payloadCodec,
      });
      const results = await searchPayload({
        query,
        decodeAll: chunkService.decodeAll,
        textDecoder: searchTextDecoder,
        buildPreview: buildSearchPreview,
        onProgress: (current, total) => {
          if (runId !== searchRunId) {
            return;
          }
          status.setSearchStatus("searchProgress", { current, total });
        },
        shouldAbort: () => runId !== searchRunId,
      });
      if (runId !== searchRunId) {
        return;
      }
      status.setSearchStatus("searchResults", { count: results.length });
      ui.renderSearchResults(results, query, { onOpenResult: renderChunkAtIndex });
    } catch (error) {
      if (runId !== searchRunId) {
        return;
      }
      status.clearSearchStatus();
      status.setGlobalStatus("searchFailed", { detail: error.message });
    }
  };

  const toggleTheme = () => {
    const root = document.documentElement;
    const isLight = root.dataset.theme === "light";
    root.dataset.theme = isLight ? "dark" : "light";
    elements.themeToggle.textContent = isLight ? "Switch to light" : "Switch to dark";
    elements.themeToggle.setAttribute("aria-pressed", String(!isLight));
  };

  const registerShortcuts = (event) => {
    if (event.target.matches("input, textarea")) {
      return;
    }
    if (event.key === "f") {
      elements.fileFilterInput.focus();
      event.preventDefault();
    }
    if (event.key === "s") {
      elements.searchInput.focus();
      event.preventDefault();
    }
    if (event.key === "t") {
      toggleTheme();
      event.preventDefault();
    }
    if (event.key === "c") {
      exportController.copyDeparsedContent();
      event.preventDefault();
    }
    if (event.key === "l") {
      repoLoader.loadRepoFiles();
      event.preventDefault();
    }
    if (event.key === "m") {
      renderer.renderNextChunk();
      event.preventDefault();
    }
  };

  const init = () => {
    document.documentElement.dataset.theme = "dark";
    updateInactivityTimeout(elements.inactivityTimeoutInput.value);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((error) => {
          console.warn("Service worker registration failed.", error);
        });
      });
    }

    window.addEventListener("beforeunload", (event) => {
      if (sessionState.hasDeparsedContent) {
        clearSession({ keepHistory: true });
        event.preventDefault();
        event.returnValue = "";
      }
    });

    if (broadcast) {
      broadcast.onmessage = (event) => {
        if (event.data?.type === "content" && sessionState.hasDeparsedContent) {
          if (event.data.file !== sessionState.currentFilePath) {
            clearSession({ reasonId: "clearedRemote" });
          }
        }
      };
    }
  };

  return {
    init,
    resetInactivityTimer,
    updateInactivityTimeout,
    toggleTheme,
    registerShortcuts,
    handleSearch,
    clearSession,
    renderNextChunk: renderer.renderNextChunk,
    loadRepoFiles: repoLoader.loadRepoFiles,
    handleFileLoad: repoLoader.handleFileLoad,
    handleRepoFileLoad: repoLoader.handleRepoFileLoad,
    exportText: exportController.exportText,
    exportBundle: exportController.exportBundle,
    importBundle: exportController.importBundle,
    captureOutputSelection: exportController.captureOutputSelection,
    copyDeparsedContent: exportController.copyDeparsedContent,
    parseAndUpload: parseController.parseAndUpload,
    parseAndSave: parseController.parseAndSave,
    refreshFileList: fileList.refreshFileList,
    setFilterQuery: fileList.setFilterQuery,
    setCategory: fileList.setCategory,
    setSelectedFile: fileList.setSelectedFile,
  };
}

export function bindUiHandlers(ui, controller) {
  const { elements } = ui;
  elements.loadFileBtn.addEventListener("click", controller.handleFileLoad);
  elements.loadRepoBtn.addEventListener("click", controller.loadRepoFiles);
  elements.themeToggle.addEventListener("click", controller.toggleTheme);
  elements.copyOutputBtn.addEventListener("pointerdown", controller.captureOutputSelection);
  elements.copyOutputBtn.addEventListener("click", controller.copyDeparsedContent);
  elements.loadMoreBtn.addEventListener("click", controller.renderNextChunk);
  elements.searchInput.addEventListener("input", controller.handleSearch);
  elements.categoryFilter.addEventListener("change", (event) => controller.setCategory(event.target.value));
  elements.fileFilterInput.addEventListener("input", (event) => controller.setFilterQuery(event.target.value));
  elements.inactivityTimeoutInput.addEventListener("input", (event) =>
    controller.updateInactivityTimeout(event.target.value)
  );
  elements.exportTextBtn.addEventListener("click", controller.exportText);
  elements.exportBundleBtn.addEventListener("click", controller.exportBundle);
  elements.importBundleInput.addEventListener("change", controller.importBundle);
  elements.parseUploadBtn.addEventListener("click", controller.parseAndUpload);
  elements.parseSaveBtn.addEventListener("click", controller.parseAndSave);
  elements.outputEl.addEventListener("contextmenu", (event) => event.preventDefault());

  document.addEventListener("keydown", controller.registerShortcuts);

  ["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, controller.resetInactivityTimer, { passive: true });
  });
}
