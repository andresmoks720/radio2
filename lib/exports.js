import { assertPayloadFormat } from "./payload.js";
import { createTextExportService } from "./textExportService.js";

/*
Data lifetime:
- Raw text: selection text exists only during copy or export.
- Disk: export files are user-initiated downloads.
- Network: none.
*/
export function createExportController({
  ui,
  elements,
  store,
  sessionState,
  status,
  requireAccessPhrase,
  formatVersion,
  fileList,
  decoderFactory,
  win,
  navigatorRef,
}) {
  let pendingOutputSelection = "";

  const exportService = createTextExportService({
    win,
    navigatorRef,
    decoderFactory,
  });

  const getSelectedOutputText = (selection = win.getSelection()) => {
    if (!selection || selection.isCollapsed) {
      return "";
    }
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !elements.outputEl.contains(range.commonAncestorContainer)) {
      return "";
    }
    return selection.toString();
  };

  const captureOutputSelection = () => {
    pendingOutputSelection = getSelectedOutputText();
  };

  const copyDeparsedContent = async () => {
    const selectedText = getSelectedOutputText() || pendingOutputSelection;
    pendingOutputSelection = "";
    if (!selectedText) {
      status.setCopyStatus("copySelectionRequired");
      return;
    }
    status.setCopyStatus("copyInProgress");
    try {
      const result = await exportService.copySelection({ selectionText: selectedText });
      if (result.ok && result.method === "clipboard") {
        status.setCopyStatus("copySuccess");
        ui.showToast(status.getMessage("copySuccess"));
        return;
      }
      if (result.ok && result.method === "fallback") {
        const detail =
          result.reason && result.reason !== "unavailable"
            ? ` Clipboard API blocked (${result.reason}).`
            : "";
        status.setCopyStatus("copyFallbackSuccess", { detail });
        ui.showToast(status.getMessage("copySuccess"));
        return;
      }
      const hint =
        result.reason === "unavailable"
          ? "Try https or localhost, and make sure the browser allows clipboard access."
          : "Try: use the Copy button, keep the tab focused, allow clipboard access in site settings, avoid embedded frames or guest mode.";
      status.setCopyStatus("copyBlocked", { detail: result.reason || "error", hint });
    } catch (error) {
      const name = error?.name || "error";
      status.setCopyStatus("copyBlockedGeneric", { detail: name });
    }
  };

  const exportText = async () => {
    if (!sessionState.activePayload) {
      status.setGlobalStatus("exportNothing");
      return;
    }
    const accessPhrase = requireAccessPhrase({
      onMissing: () => status.setGlobalStatus("accessRequiredExport"),
    });
    if (!accessPhrase) {
      return;
    }
    try {
      status.setGlobalStatus("exportPreparing");
      await exportService.exportFile({
        payload: sessionState.activePayload,
        accessPhrase,
        outputName: `${sessionState.currentFilePath || "processed-content"}.txt`,
      });
      status.setGlobalStatus("exportReady");
    } catch (error) {
      status.setGlobalStatus("exportFailed", { detail: error.message });
    }
  };

  const exportBundle = () => {
    const files = [];
    const seen = new Set();
    const { bundlePayloads, livePayloads } = store.getPayloadStores();
    const addPayloads = (payloadStore) => {
      payloadStore.forEach((payload, path) => {
        if (seen.has(path)) {
          return;
        }
        seen.add(path);
        files.push({ path, payload });
      });
    };
    addPayloads(bundlePayloads);
    addPayloads(livePayloads);
    exportService.exportBundle({ files, version: formatVersion });
  };

  const importBundle = async () => {
    const file = elements.importBundleInput.files[0];
    if (!file) {
      return;
    }
    try {
      const contents = await file.text();
      const bundle = JSON.parse(contents);
      if (!Array.isArray(bundle.files)) {
        throw new Error("Invalid export format.");
      }
      const entries = bundle.files.map((entry) => {
        const size = JSON.stringify(entry.payload).length;
        return {
          name: entry.path.split("/").pop(),
          path: entry.path,
          isParsed: true,
          category: "Imported Bundle",
          source: "bundle",
          size,
        };
      });
      store.setBundleEntries(entries);
      bundle.files.forEach((entry) => {
        assertPayloadFormat(entry.payload, formatVersion);
        store.rememberPayload(entry.path, entry.payload, "bundle");
      });
      fileList.refreshFileList();
      status.setGlobalStatus("bundleImportSuccess");
    } catch (error) {
      status.setGlobalStatus("bundleImportFailed", { detail: error.message });
    }
  };

  return {
    captureOutputSelection,
    copyDeparsedContent,
    exportText,
    exportBundle,
    importBundle,
  };
}
