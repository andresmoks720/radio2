import { createUi } from "./lib/ui.js";
import { createSessionState } from "./lib/state.js";
import {
  buildAuthHeaders,
  fetchGitHubWithRetry,
  fetchRawFile,
  fetchRepoEntries,
  getGitHubError,
} from "./lib/data.js";
import { searchPayload } from "./lib/search.js";
import {
  buildSearchPreview,
  ensurePayloadExtension,
  filterByCategory,
  filterEntries,
  normalizeRepoPath,
  splitMarkdownIntoChunks,
} from "./lib/helpers.js";

const ui = createUi();
const { elements } = ui;

const FORMAT_VERSION = 2;
const DEFAULT_INACTIVITY_MINUTES = 60;
const DATA_EXTENSION = ".md.data";
const MARKDOWN_CHUNK_TARGET = 2000;
const AUTO_LOAD_ROOT_MARGIN = "240px";
const AUTO_LOAD_THRESHOLD_PX = 240;
const SHOW_PERF_METRICS = false;
const LIBRARIES = {
  marked: "vendor/marked.min.js",
  dompurify: "vendor/purify.min.js",
  highlight: "vendor/highlight.min.js",
  highlightCss: "vendor/github-dark.css",
};
const STATUS_MESSAGES = {
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
};

const livePayloads = new Map();
const bundlePayloads = new Map();
const historyStore = new Map();
const payloadCodec = window.payloadCodec || {};
const sessionState = createSessionState();

let inactivityTimer = null;
let inactivityLimitMs = DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
const chunkTextDecoder = new TextDecoder();
let allRepoEntries = [];
let bundleEntries = [];
let librariesLoaded = false;
let searchRunId = 0;
let chunkLock = false;
let autoLoadObserver = null;
let autoLoadScheduled = false;
let autoLoadFallbackBound = false;
let pendingOutputSelection = "";
const broadcast = "BroadcastChannel" in window ? new BroadcastChannel("app-channel") : null;

document.documentElement.dataset.theme = "dark";

function getAuthToken() {
  const inputToken = elements.repoTokenInput.value.trim();
  if (inputToken) {
    return inputToken;
  }
  return "";
}

function getStatusMessage(id, data) {
  const entry = STATUS_MESSAGES[id];
  if (!entry) {
    return "";
  }
  const text = typeof entry.text === "function" ? entry.text(data || {}) : entry.text;
  return text || "";
}

function status(id, data) {
  const entry = STATUS_MESSAGES[id];
  if (!entry) {
    return;
  }
  const message = getStatusMessage(id, data);
  const isError = entry.tone === "error";
  const isSuccess = entry.tone === "success";
  ui.setStatus(message, isError, isSuccess);
}

function showLoadFailure(error) {
  status("fileLoadFailed", { detail: error?.message || "" });
  ui.setOutputState("error");
}

function ensureOnline(statusId) {
  if (navigator.onLine) {
    return true;
  }
  if (statusId) {
    status(statusId);
  }
  return false;
}

function onRateLimit(wait) {
  ui.setStatus(`GitHub rate limit reached. Retrying in ${Math.ceil(wait / 1000)}s...`);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdownFallback(markdown) {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split("\n");
  const htmlLines = [];
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      htmlLines.push(inCodeBlock ? "<pre><code>" : "</code></pre>");
      continue;
    }
    if (inCodeBlock) {
      htmlLines.push(line);
      continue;
    }
    if (/^#{1,4} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const content = line.replace(/^#{1,4} /, "");
      htmlLines.push(`<h${level}>${content}</h${level}>`);
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*] /.test(lines[index])) {
        items.push(`<li>${lines[index].replace(/^[-*] /, "")}</li>`);
        index += 1;
      }
      index -= 1;
      htmlLines.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (line.trim() === "") {
      htmlLines.push("");
      continue;
    }
    const withInline = line
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`(.*?)`/g, "<code>$1</code>")
      .replace(/\[(.*?)\]\((.*?)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener\">$1</a>");
    htmlLines.push(`<p>${withInline}</p>`);
  }
  return htmlLines.join("\n");
}

function sanitizeHtml(html) {
  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(html);
  }
  return escapeHtml(html);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = resolve;
    link.onerror = reject;
    document.head.appendChild(link);
  });
}

async function ensureLibrariesLoaded() {
  if (librariesLoaded) {
    return;
  }
  await Promise.all([
    loadScript(LIBRARIES.marked),
    loadScript(LIBRARIES.dompurify),
    loadScript(LIBRARIES.highlight),
    loadStylesheet(LIBRARIES.highlightCss),
  ]);
  if (window.marked && window.hljs) {
    window.marked.setOptions({
      highlight(code, language) {
        if (language && window.hljs.getLanguage(language)) {
          return window.hljs.highlight(code, { language }).value;
        }
        return window.hljs.highlightAuto(code).value;
      },
    });
  }
  librariesLoaded = true;
}

function getChunkTarget() {
  return MARKDOWN_CHUNK_TARGET;
}

function scrambleBytes(bytes) {
  const mask = crypto.getRandomValues(new Uint8Array(bytes.length));
  const scrambled = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    scrambled[i] = bytes[i] ^ mask[i];
  }
  bytes.fill(0);
  return { scrambled, mask };
}

function descrambleToString(chunk) {
  const bytes = new Uint8Array(chunk.scrambled.length);
  for (let i = 0; i < chunk.scrambled.length; i += 1) {
    bytes[i] = chunk.scrambled[i] ^ chunk.mask[i];
  }
  const text = chunkTextDecoder.decode(bytes);
  bytes.fill(0);
  return text;
}

function scrubChunk(chunk) {
  if (!chunk) {
    return;
  }
  chunk.scrambled?.fill(0);
  chunk.mask?.fill(0);
  chunk.scrambled = null;
  chunk.mask = null;
}

function resetChunkRenderState() {
  sessionState.resetChunkState();
}

async function createChunkDecoder(payload, accessPhrase) {
  if (!payloadCodec.createChunkDecoder) {
    throw new Error("Decoding module unavailable.");
  }
  return payloadCodec.createChunkDecoder(payload, accessPhrase, FORMAT_VERSION);
}

async function appendMarkdownChunk(markdown) {
  const html = window.marked ? window.marked.parse(markdown) : renderMarkdownFallback(markdown);
  const sanitized = sanitizeHtml(html);
  const fragment = document.createElement("div");
  fragment.innerHTML = sanitized;
  fragment.querySelectorAll("pre code").forEach((block) => {
    if (window.hljs) {
      window.hljs.highlightElement(block);
    }
  });
  elements.outputEl.append(...fragment.childNodes);
}

async function decodeChunk(chunkEntry, index) {
  const chunkDecoder = sessionState.chunkDecoder;
  if (!chunkDecoder) {
    throw new Error("Decoding module unavailable.");
  }
  const decodedBytes = await chunkDecoder(chunkEntry, index);
  return scrambleBytes(decodedBytes);
}

async function renderChunk(scrambledChunk) {
  const markdown = descrambleToString(scrambledChunk);
  try {
    await appendMarkdownChunk(markdown);
  } finally {
    return markdown;
  }
}

function finalizeChunkRender(scrambledChunk, markdown) {
  scrubChunk(scrambledChunk);
  if (markdown) {
    markdown = "";
  }
}

function updateChunkUi(activePayload) {
  elements.loadMoreBtn.hidden = sessionState.chunkCursor >= activePayload.chunks.length;
  if (!elements.loadMoreBtn.hidden) {
    status("loadMoreHint");
  }
  updateAutoLoadObserver();
}

function acquireChunkLock() {
  if (chunkLock) {
    return false;
  }
  chunkLock = true;
  return true;
}

function releaseChunkLock() {
  chunkLock = false;
}

async function renderNextChunk() {
  const activePayload = sessionState.activePayload;
  if (!activePayload || !sessionState.chunkDecoder || sessionState.chunkCursor >= activePayload.chunks.length) {
    if (activePayload) {
      elements.loadMoreBtn.hidden = true;
      updateAutoLoadObserver();
    }
    return;
  }

  if (!acquireChunkLock()) {
    return;
  }

  resetInactivityTimer();
  const chunkEntry = activePayload.chunks[sessionState.chunkCursor];
  sessionState.advanceChunkCursor();

  const start = SHOW_PERF_METRICS ? performance.now() : 0;
  let scrambled = null;
  let markdown = "";
  try {
    scrambled = await decodeChunk(chunkEntry, sessionState.chunkCursor - 1);
    markdown = await renderChunk(scrambled);
  } catch (error) {
    status("chunkRenderFailed", { detail: error.message });
  } finally {
    finalizeChunkRender(scrambled, markdown);
    releaseChunkLock();
  }

  if (SHOW_PERF_METRICS) {
    const duration = Math.round(performance.now() - start);
    elements.perfIndicator.textContent = `Render: ${duration}ms`;
  } else {
    elements.perfIndicator.textContent = "";
  }
  updateChunkUi(activePayload);
}

function autoLoadNextChunkIfNeeded() {
  const activePayload = sessionState.activePayload;
  if (!activePayload || !sessionState.chunkDecoder || chunkLock || sessionState.chunkCursor >= activePayload.chunks.length) {
    return;
  }
  const scrollPosition = window.scrollY + window.innerHeight;
  const maxScroll = document.documentElement.scrollHeight - AUTO_LOAD_THRESHOLD_PX;
  if (scrollPosition >= maxScroll) {
    renderNextChunk();
  }
}

function scheduleAutoLoad() {
  if (autoLoadScheduled) {
    return;
  }
  autoLoadScheduled = true;
  window.requestAnimationFrame(() => {
    autoLoadScheduled = false;
    autoLoadNextChunkIfNeeded();
  });
}

function updateAutoLoadObserver() {
  if (!("IntersectionObserver" in window)) {
    if (!autoLoadFallbackBound) {
      window.addEventListener("scroll", scheduleAutoLoad, { passive: true });
      window.addEventListener("resize", scheduleAutoLoad);
      autoLoadFallbackBound = true;
    }
    scheduleAutoLoad();
    return;
  }
  if (!autoLoadObserver) {
    autoLoadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            renderNextChunk();
          }
        });
      },
      { root: null, rootMargin: AUTO_LOAD_ROOT_MARGIN, threshold: 0.1 }
    );
  }
  if (elements.loadMoreBtn.hidden) {
    autoLoadObserver.unobserve(elements.loadMoreBtn);
  } else {
    autoLoadObserver.observe(elements.loadMoreBtn);
  }
}

async function renderMarkdown(payload, accessPhrase) {
  elements.copyStatus.textContent = "";
  ui.clearElement(elements.outputEl);
  ui.clearSearchResults();
  elements.loadMoreBtn.hidden = true;
  resetInactivityTimer();

  if (!payload?.chunks?.length) {
    sessionState.setHasDeparsedContent(false);
    return;
  }

  sessionState.setHasDeparsedContent(true);
  resetChunkRenderState();
  sessionState.markLoading();

  try {
    await ensureLibrariesLoaded();
    sessionState.setActivePayload(payload);
    sessionState.setChunkDecoder(await createChunkDecoder(payload, accessPhrase));
    await renderNextChunk();
  } catch (error) {
    status("renderFailed", { detail: error.message });
    resetChunkRenderState();
  }
}

async function encodeContent(markdown, accessPhrase) {
  if (!payloadCodec.encodePayloadChunks) {
    throw new Error("Encoding module unavailable.");
  }
  const chunks = splitMarkdownIntoChunks(markdown, getChunkTarget());
  return payloadCodec.encodePayloadChunks(chunks, accessPhrase, FORMAT_VERSION);
}

function assertPayloadFormat(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload.");
  }
  if (typeof payload.version !== "number") {
    throw new Error("Payload has invalid version.");
  }
  if (payload.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported format version: ${payload.version}`);
  }
  if (typeof payload.seed !== "string" || payload.seed.trim() === "") {
    throw new Error("Payload has invalid data.");
  }
  if (!Array.isArray(payload.chunks) || payload.chunks.length === 0) {
    throw new Error("Payload is missing chunk data.");
  }
  payload.chunks.forEach((chunk) => {
    if (
      !chunk ||
      typeof chunk.offset !== "string" ||
      chunk.offset.trim() === "" ||
      typeof chunk.payload !== "string" ||
      chunk.payload.trim() === ""
    ) {
      throw new Error("Payload has invalid chunk data.");
    }
  });
}

function getFilteredEntries(entries) {
  const query = elements.fileFilterInput.value.trim();
  const category = elements.categoryFilter.value;
  return filterByCategory(filterEntries(entries, query), category);
}

async function loadRepoFiles() {
  const owner = elements.repoOwnerInput.value.trim();
  const repo = elements.repoNameInput.value.trim();
  const branch = elements.repoBranchInput.value.trim() || "main";
  const repoPath = normalizeRepoPath(elements.repoPathInput.value);
  const displayPath = repoPath ? `${repoPath}/` : "repo root";
  const authHeaders = buildAuthHeaders(getAuthToken());

  if (!owner || !repo) {
    status("repoInfoRequired");
    return;
  }

  if (!ensureOnline("repoListOffline")) {
    ui.renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]), {
      onLoadFile: handleRepoFileLoad,
      onPreview: ui.updatePreview,
    });
    return;
  }

  ui.setRepoLoading(true);
  status("repoListLoading", { path: displayPath });
  try {
    allRepoEntries = await fetchRepoEntries({
      owner,
      repo,
      branch,
      path: repoPath,
      authHeaders,
      dataExtension: DATA_EXTENSION,
      onRateLimit,
    });
    const combined = [...allRepoEntries, ...bundleEntries];
    ui.updateCategoryOptions(combined);
    ui.renderFileGroups(getFilteredEntries(combined), {
      onLoadFile: handleRepoFileLoad,
      onPreview: ui.updatePreview,
    });
    status("repoListLoaded", { count: allRepoEntries.length, path: displayPath });
  } catch (error) {
    ui.renderFileGroups([], { onLoadFile: handleRepoFileLoad, onPreview: ui.updatePreview });
    status("repoListFailed", { detail: error.message });
  } finally {
    ui.setRepoLoading(false);
  }
}

function updateHistory(path, size) {
  const entries = historyStore.get(path) || [];
  entries.unshift({ timestamp: new Date().toISOString(), size });
  historyStore.set(path, entries.slice(0, 5));
  ui.renderHistory(entries);
}

function getAccessPhrase() {
  return elements.accessPhraseInput.value.trim();
}

function requireAccessPhrase({ onMissing }) {
  const accessPhrase = getAccessPhrase();
  if (!accessPhrase) {
    if (onMissing) {
      onMissing();
    }
    return null;
  }
  return accessPhrase;
}

async function loadPayload({ payload, path, size, fileMeta, accessPhrase, successMessage }) {
  sessionState.setCurrentFilePath(path);
  await renderMarkdown(payload, accessPhrase);
  ui.setStatus(successMessage, false, true);
  ui.setOutputState("success");
  updateHistory(path, size);
  if (fileMeta) {
    ui.updatePreview(fileMeta);
  }
  if (fileMeta?.source === "repo" || fileMeta?.source === "bundle") {
    ui.renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]), {
      onLoadFile: handleRepoFileLoad,
      onPreview: ui.updatePreview,
    });
  }
  if (broadcast) {
    broadcast.postMessage({ type: "content", file: path });
  }
}

async function handleRepoFileLoad(file) {
  if (!file.isParsed) {
    status("fileParsedOnly");
    return;
  }
  const owner = elements.repoOwnerInput.value.trim();
  const repo = elements.repoNameInput.value.trim();
  const branch = elements.repoBranchInput.value.trim() || "main";
  const accessPhrase = requireAccessPhrase({
    onMissing: () => status("accessRequired"),
  });
  if (!accessPhrase) {
    return;
  }
  const token = getAuthToken();
  const authHeaders = buildAuthHeaders(token);

  if (file.source !== "bundle" && (!owner || !repo)) {
    status("repoInfoRequired");
    return;
  }
  if (file.source !== "bundle" && !ensureOnline("fileLoadOffline")) {
    return;
  }

  status("fileLoadStarting");
  ui.setOutputState("");
  try {
    let payloadSize = file.size || 0;
    let payload = null;
  if (file.source === "bundle") {
      payload = bundlePayloads.get(file.path);
      if (!payload) {
        throw new Error(getStatusMessage("fileMissingBundleData", { path: file.path }));
      }
      assertPayloadFormat(payload);
      payloadSize = JSON.stringify(payload).length;
    } else {
      const response = await fetchRawFile({
        owner,
        repo,
        branch,
        path: file.path,
        token,
        authHeaders,
        onRateLimit,
      });
      payload = await response.json();
      assertPayloadFormat(payload);
      livePayloads.set(file.path, payload);
      payloadSize = JSON.stringify(payload).length;
    }
    await loadPayload({
      payload,
      path: file.path,
      size: payloadSize,
      fileMeta: file,
      accessPhrase,
      successMessage: getStatusMessage("fileLoadSuccess"),
    });
  } catch (error) {
    showLoadFailure(error);
  }
}

async function handleFileLoad() {
  const file = elements.fileInput.files[0];
  const accessPhrase = requireAccessPhrase({
    onMissing: () => status("accessRequiredOpen"),
  });

  if (!file) {
    status("fileMissingLocal");
    return;
  }

  if (!accessPhrase) {
    return;
  }

  status("fileLocalLoadStarting");
  ui.setOutputState("");

  try {
    const contents = await file.text();
    const payload = JSON.parse(contents);
    assertPayloadFormat(payload);
    livePayloads.set(file.name, payload);
    await loadPayload({
      payload,
      path: file.name,
      size: file.size,
      fileMeta: { name: file.name, path: file.name, isParsed: true, size: file.size },
      accessPhrase,
      successMessage: getStatusMessage("fileLocalLoadSuccess"),
    });
  } catch (error) {
    showLoadFailure(error);
  }
}

function clearSession({ reasonId = "", keepHistory = false } = {}) {
  ui.clearElement(elements.outputEl);
  livePayloads.clear();
  if (!keepHistory) {
    historyStore.clear();
    ui.clearElement(elements.historyList);
  }
  resetChunkRenderState();
  sessionState.clearAll();
  ui.setOutputState("");
  elements.copyStatus.textContent = "";
  elements.loadMoreBtn.hidden = true;
  ui.updatePreview(null);
  ui.clearSearchResults();
  if (reasonId) {
    status(reasonId);
  }
  if (broadcast) {
    broadcast.postMessage({ type: "cleared" });
  }
}

function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  inactivityTimer = setTimeout(() => {
    if (sessionState.hasDeparsedContent) {
      clearSession({ reasonId: "clearedIdle" });
    }
  }, inactivityLimitMs);
}

function updateInactivityTimeout() {
  const minutes = Number.parseFloat(elements.inactivityTimeoutInput.value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    inactivityLimitMs = DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
    elements.inactivityTimeoutInput.value = String(DEFAULT_INACTIVITY_MINUTES);
  } else {
    inactivityLimitMs = Math.round(minutes * 60 * 1000);
  }
  resetInactivityTimer();
}


async function renderChunkAtIndex(index) {
  if (!sessionState.activePayload) {
    status("searchLoadRequired");
    return;
  }
  const accessPhrase = requireAccessPhrase({
    onMissing: () => status("accessRequiredResult"),
  });
  if (!accessPhrase) {
    return;
  }
  status("searchResultLoading");
  try {
    await ensureLibrariesLoaded();
    sessionState.setChunkDecoder(await createChunkDecoder(sessionState.activePayload, accessPhrase));
    sessionState.setChunkCursor(Math.max(0, Math.min(index, sessionState.activePayload.chunks.length - 1)));
    ui.clearElement(elements.outputEl);
    await renderNextChunk();
    status("searchResultLoaded");
  } catch (error) {
    status("searchFailed", { detail: error.message });
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const isLight = root.dataset.theme === "light";
  root.dataset.theme = isLight ? "dark" : "light";
  elements.themeToggle.textContent = isLight ? "Switch to light" : "Switch to dark";
  elements.themeToggle.setAttribute("aria-pressed", String(!isLight));
}

async function createPlaintextStream(payload, accessPhrase, onProgress) {
  const decoder = await createChunkDecoder(payload, accessPhrase);
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= payload.chunks.length) {
        controller.close();
        return;
      }
      const entry = payload.chunks[index];
      let resultBytes = null;
      try {
        resultBytes = await decoder(entry, index);
        const outputBytes = resultBytes.slice();
        controller.enqueue(outputBytes);
        if (onProgress) {
          onProgress(index + 1, payload.chunks.length);
        }
      } catch (error) {
        controller.error(error);
        return;
      } finally {
        if (resultBytes) {
          resultBytes.fill(0);
        }
        resultBytes = null;
      }
      index += 1;
    },
  });
}

async function buildPlaintextBlob(payload, accessPhrase, onProgress) {
  const stream = await createPlaintextStream(payload, accessPhrase, onProgress);
  const response = new Response(stream);
  return response.blob();
}

async function buildPlaintextText(payload, accessPhrase, onProgress) {
  const stream = await createPlaintextStream(payload, accessPhrase, onProgress);
  const response = new Response(stream);
  return response.text();
}

async function fallbackExecCommandCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  } finally {
    ta.value = "";
    ta.remove();
  }
  return ok;
}

function isClipboardContextAllowed() {
  const { protocol, hostname } = window.location;
  return (
    protocol === "https:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

async function tryClipboardWrite(text) {
  if (!isClipboardContextAllowed() || !navigator.clipboard?.writeText) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.name || "error" };
  }
}

function getSelectedOutputText(selection = window.getSelection()) {
  if (!selection || selection.isCollapsed) {
    return "";
  }
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !elements.outputEl.contains(range.commonAncestorContainer)) {
    return "";
  }
  return selection.toString();
}

function captureOutputSelection() {
  pendingOutputSelection = getSelectedOutputText();
}

async function copyDeparsedContent() {
  const selectedText = getSelectedOutputText() || pendingOutputSelection;
  pendingOutputSelection = "";
  if (!selectedText) {
    elements.copyStatus.textContent = "Select text in the preview to copy.";
    return;
  }
  elements.copyStatus.textContent = "Copying selection...";
  try {
    const result = await tryClipboardWrite(selectedText);
    if (result.ok) {
      elements.copyStatus.textContent = "Copied to clipboard.";
      ui.showToast("Copied to clipboard");
      return;
    }
    const ok = await fallbackExecCommandCopy(selectedText);
    if (ok) {
      const detail =
        result.reason && result.reason !== "unavailable"
          ? ` Clipboard API blocked (${result.reason}).`
          : "";
      elements.copyStatus.textContent = `Copied (fallback mode).${detail} Keep the tab focused and use https or localhost.`;
      ui.showToast("Copied to clipboard");
    } else {
      const hint =
        result.reason === "unavailable"
          ? "Try https or localhost, and make sure the browser allows clipboard access."
          : "Try: use the Copy button, keep the tab focused, allow clipboard access in site settings, avoid embedded frames or guest mode.";
      elements.copyStatus.textContent = `Copy blocked (${result.reason}). ${hint}`;
    }
  } catch (error) {
    const name = error?.name || "error";
    elements.copyStatus.textContent = `Copy blocked (${name}). Try: use the Copy button, keep the tab focused, allow clipboard access in site settings, avoid embedded frames or guest mode.`;
  }
}

async function exportText() {
  if (!sessionState.activePayload) {
    status("exportNothing");
    return;
  }
  const accessPhrase = requireAccessPhrase({
    onMissing: () => status("accessRequiredExport"),
  });
  if (!accessPhrase) {
    return;
  }
  try {
    status("exportPreparing");
    const blob = await buildPlaintextBlob(sessionState.activePayload, accessPhrase);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${sessionState.currentFilePath || "processed-content"}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    status("exportReady");
  } catch (error) {
    status("exportFailed", { detail: error.message });
  }
}

function exportBundle() {
  const files = [];
  const seen = new Set();
  const addPayloads = (store) => {
    store.forEach((payload, path) => {
      if (seen.has(path)) {
        return;
      }
      seen.add(path);
      files.push({ path, payload });
    });
  };
  addPayloads(bundlePayloads);
  addPayloads(livePayloads);
  const bundle = {
    version: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    files,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "export.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importBundle() {
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
    bundleEntries = bundle.files.map((entry) => {
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
    bundle.files.forEach((entry) => {
      assertPayloadFormat(entry.payload);
      bundlePayloads.set(entry.path, entry.payload);
    });
    const combined = [...allRepoEntries, ...bundleEntries];
    ui.updateCategoryOptions(combined);
    ui.renderFileGroups(getFilteredEntries(combined), {
      onLoadFile: handleRepoFileLoad,
      onPreview: ui.updatePreview,
    });
    status("bundleImportSuccess");
  } catch (error) {
    status("bundleImportFailed", { detail: error.message });
  }
}

async function parseAndUpload() {
  const owner = elements.repoOwnerInput.value.trim();
  const repo = elements.repoNameInput.value.trim();
  const branch = elements.repoBranchInput.value.trim() || "main";
  const targetPath = ensurePayloadExtension(elements.parseTitleInput.value.trim(), DATA_EXTENSION);
  const accessPhrase = getAccessPhrase();
  const token = getAuthToken();
  const commitMessage = elements.parseMessageInput.value.trim();
  const authHeaders = buildAuthHeaders(token);

  if (!owner || !repo || !targetPath) {
    status("repoUploadMissingInfo");
    return;
  }
  if (!accessPhrase) {
    status("accessRequiredParse");
    return;
  }
  if (!token) {
    status("repoUploadNeedsToken");
    return;
  }

  status("parseUploadStart");
  try {
    const markdown = await collectParseSource();
    if (!markdown) {
      return;
    }
    const payload = await buildPayloadFromInput(markdown, accessPhrase);
    const body = {
      message: commitMessage || `Add payload ${targetPath}`,
      content: btoa(JSON.stringify(payload)),
      branch,
    };
    const response = await fetchGitHubWithRetry(
      `https://api.github.com/repos/${owner}/${repo}/contents/${targetPath}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          ...authHeaders,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
      { retries: 2, onRateLimit }
    );
    if (!response.ok) {
      throw new Error(await getGitHubError(response));
    }
    status("parseUploadSuccess");
    elements.parseTitleInput.value = "";
    elements.parseMessageInput.value = "";
  } catch (error) {
    status("parseUploadFailed", { detail: error.message });
  }
}

function triggerDownload(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function parseAndSave() {
  const targetPath = ensurePayloadExtension(
    elements.parseTitleInput.value.trim() || "local.md.data",
    DATA_EXTENSION
  );
  const accessPhrase = getAccessPhrase();

  if (!accessPhrase) {
    status("accessRequiredParse");
    return;
  }

  status("parseLocalStart");
  try {
    const markdown = await collectParseSource();
    if (!markdown) {
      return;
    }
    const payload = await buildPayloadFromInput(markdown, accessPhrase);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    triggerDownload(blob, targetPath);
    status("parseLocalReady");
  } catch (error) {
    status("parseLocalFailed", { detail: error.message });
  }
}

async function collectParseSource() {
  let markdown = elements.parseContentInput.value.trim();
  if (elements.parseFileInput.files.length > 0) {
    markdown = await elements.parseFileInput.files[0].text();
  }
  if (!markdown) {
    status("accessRequiredParse");
    return "";
  }
  return markdown;
}

async function buildPayloadFromInput(markdown, accessPhrase) {
  const payload = await encodeContent(markdown, accessPhrase);
  elements.parseContentInput.value = "";
  elements.parseFileInput.value = "";
  markdown = "";
  return payload;
}

async function handleSearch() {
  const query = elements.searchInput.value.trim();
  const runId = ++searchRunId;
  ui.clearSearchResults();
  if (!query) {
    elements.searchSummary.textContent = "";
    return;
  }
  if (!sessionState.activePayload) {
    elements.searchSummary.textContent = getStatusMessage("searchLoadRequired");
    return;
  }
  const accessPhrase = requireAccessPhrase({
    onMissing: () => {
      elements.searchSummary.textContent = getStatusMessage("accessRequiredSearch");
    },
  });
  if (!accessPhrase) {
    return;
  }
  elements.searchSummary.textContent = getStatusMessage("searchScanning");

  try {
    const results = await searchPayload({
      payload: sessionState.activePayload,
      query,
      accessPhrase,
      version: FORMAT_VERSION,
      decodePayloadChunks: payloadCodec.decodePayloadChunks,
      textDecoder: chunkTextDecoder,
      buildPreview: buildSearchPreview,
      onProgress: (current, total) => {
        if (runId !== searchRunId) {
          return;
        }
        elements.searchSummary.textContent = `Scanning ${current} of ${total}...`;
      },
      shouldAbort: () => runId !== searchRunId,
    });
    if (runId !== searchRunId) {
      return;
    }
    elements.searchSummary.textContent = `Found ${results.length} matching chunk${
      results.length === 1 ? "" : "s"
    }.`;
    ui.renderSearchResults(results, query, { onOpenResult: renderChunkAtIndex });
  } catch (error) {
    if (runId !== searchRunId) {
      return;
    }
    elements.searchSummary.textContent = "";
    status("searchFailed", { detail: error.message });
  }
}

function registerShortcuts(event) {
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
    copyDeparsedContent();
    event.preventDefault();
  }
  if (event.key === "l") {
    loadRepoFiles();
    event.preventDefault();
  }
  if (event.key === "m") {
    renderNextChunk();
    event.preventDefault();
  }
}

elements.loadFileBtn.addEventListener("click", handleFileLoad);
elements.loadRepoBtn.addEventListener("click", loadRepoFiles);
elements.themeToggle.addEventListener("click", toggleTheme);
elements.copyOutputBtn.addEventListener("pointerdown", captureOutputSelection);
elements.copyOutputBtn.addEventListener("click", copyDeparsedContent);
elements.loadMoreBtn.addEventListener("click", renderNextChunk);
elements.searchInput.addEventListener("input", handleSearch);
elements.categoryFilter.addEventListener("change", () => {
  ui.renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]), {
    onLoadFile: handleRepoFileLoad,
    onPreview: ui.updatePreview,
  });
});
elements.fileFilterInput.addEventListener("input", () => {
  ui.renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]), {
    onLoadFile: handleRepoFileLoad,
    onPreview: ui.updatePreview,
  });
});
elements.inactivityTimeoutInput.addEventListener("input", updateInactivityTimeout);
elements.exportTextBtn.addEventListener("click", exportText);
elements.exportBundleBtn.addEventListener("click", exportBundle);
elements.importBundleInput.addEventListener("change", importBundle);
elements.parseUploadBtn.addEventListener("click", parseAndUpload);
elements.parseSaveBtn.addEventListener("click", parseAndSave);
elements.outputEl.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("keydown", registerShortcuts);

["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

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

updateInactivityTimeout();
