import { buildAuthHeaders } from "./data.js";
import { normalizeRepoPath } from "./helpers.js";
import { assertPayloadFormat } from "./payload.js";
import { createRepoClient } from "./repoClient.js";

/*
Data lifetime:
- Raw text: file content only while loading/rendering.
- Disk: none.
- Network: GitHub list and file fetch when user requests.
*/
export function createRepoLoader({
  ui,
  elements,
  store,
  sessionState,
  status,
  fileList,
  renderer,
  dataExtension,
  formatVersion,
  getAuthToken,
  requireAccessPhrase,
  ensureOnline,
  onRateLimit,
  onPayloadLoaded,
  repoClientFactory = createRepoClient,
}) {
  const loadRepoFiles = async () => {
    const owner = elements.repoOwnerInput.value.trim();
    const repo = elements.repoNameInput.value.trim();
    const branch = elements.repoBranchInput.value.trim() || "main";
    const repoPath = normalizeRepoPath(elements.repoPathInput.value);
    const displayPath = repoPath ? `${repoPath}/` : "repo root";
    const authHeaders = buildAuthHeaders(getAuthToken());

    if (!owner || !repo) {
      status.setGlobalStatus("repoInfoRequired");
      return;
    }

    if (!ensureOnline("repoListOffline")) {
      fileList.refreshFileList();
      return;
    }

    ui.setRepoLoading(true);
    status.setGlobalStatus("repoListLoading", { path: displayPath });
    try {
      const client = repoClientFactory({ owner, repo, branch, authHeaders, onRateLimit });
      const result = await client.listEntries({ path: repoPath, dataExtension });
      if (result.ok) {
        store.setRepoEntries(result.data);
        fileList.refreshFileList();
        status.setGlobalStatus("repoListLoaded", { count: result.data.length, path: displayPath });
      } else {
        store.setRepoEntries([]);
        fileList.refreshFileList();
        status.setGlobalStatus("repoListFailed", { detail: result.error });
      }
    } catch (error) {
      store.setRepoEntries([]);
      fileList.refreshFileList();
      status.setGlobalStatus("repoListFailed", { detail: error?.message || "" });
    } finally {
      ui.setRepoLoading(false);
    }
  };

  const loadPayload = async ({ payload, path, size, fileMeta, accessPhrase, successId }) => {
    sessionState.setCurrentFilePath(path);
    await renderer.renderMarkdown(payload, accessPhrase);
    status.setGlobalStatus(successId);
    ui.setOutputState("success");
    const entries = store.pushHistory(path, size);
    ui.renderHistory(entries);
    if (fileMeta) {
      ui.updatePreview(fileMeta);
    }
    if (fileMeta?.source === "repo" || fileMeta?.source === "bundle") {
      fileList.refreshFileList();
    }
    if (onPayloadLoaded) {
      onPayloadLoaded(path);
    }
  };

  const handleRepoFileLoad = async (file) => {
    if (!file.isParsed) {
      status.setGlobalStatus("fileParsedOnly");
      return;
    }
    const owner = elements.repoOwnerInput.value.trim();
    const repo = elements.repoNameInput.value.trim();
    const branch = elements.repoBranchInput.value.trim() || "main";
    const accessPhrase = requireAccessPhrase({
      onMissing: () => status.setGlobalStatus("accessRequired"),
    });
    if (!accessPhrase) {
      return;
    }
    const token = getAuthToken();
    const authHeaders = buildAuthHeaders(token);

    if (file.source !== "bundle" && (!owner || !repo)) {
      status.setGlobalStatus("repoInfoRequired");
      return;
    }
    if (file.source !== "bundle" && !ensureOnline("fileLoadOffline")) {
      return;
    }

    status.setGlobalStatus("fileLoadStarting");
    ui.setOutputState("");
    try {
      let payloadSize = file.size || 0;
      let payload = null;
      fileList.setSelectedFile(file.path);
      if (file.source === "bundle") {
        payload = store.getPayload(file.path, "bundle");
        if (!payload) {
          throw new Error(status.getMessage("fileMissingBundleData", { path: file.path }));
        }
        assertPayloadFormat(payload, formatVersion);
        payloadSize = JSON.stringify(payload).length;
      } else {
        const client = repoClientFactory({ owner, repo, branch, authHeaders, onRateLimit });
        const response = await client.fetchRawFile({ path: file.path, token });
        if (!response.ok) {
          throw new Error(response.error);
        }
        payload = await response.data.json();
        assertPayloadFormat(payload, formatVersion);
        store.rememberPayload(file.path, payload, "repo");
        payloadSize = JSON.stringify(payload).length;
      }
      await loadPayload({
        payload,
        path: file.path,
        size: payloadSize,
        fileMeta: file,
        accessPhrase,
        successId: "fileLoadSuccess",
      });
    } catch (error) {
      status.setGlobalStatus("fileLoadFailed", { detail: error?.message || "" });
      ui.setOutputState("error");
    }
  };

  const handleFileLoad = async () => {
    const file = elements.fileInput.files[0];
    const accessPhrase = requireAccessPhrase({
      onMissing: () => status.setGlobalStatus("accessRequiredOpen"),
    });

    if (!file) {
      status.setGlobalStatus("fileMissingLocal");
      return;
    }

    if (!accessPhrase) {
      return;
    }

    status.setGlobalStatus("fileLocalLoadStarting");
    ui.setOutputState("");

    try {
      const contents = await file.text();
      const payload = JSON.parse(contents);
      assertPayloadFormat(payload, formatVersion);
      store.rememberPayload(file.name, payload, "repo");
      await loadPayload({
        payload,
        path: file.name,
        size: file.size,
        fileMeta: { name: file.name, path: file.name, isParsed: true, size: file.size },
        accessPhrase,
        successId: "fileLocalLoadSuccess",
      });
    } catch (error) {
      status.setGlobalStatus("fileLoadFailed", { detail: error?.message || "" });
      ui.setOutputState("error");
    }
  };

  return {
    loadRepoFiles,
    handleRepoFileLoad,
    handleFileLoad,
  };
}
