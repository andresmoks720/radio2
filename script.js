const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const accessPhraseInput = document.getElementById("access-phrase");
const sampleSelect = document.getElementById("sample-select");
const loadSampleBtn = document.getElementById("load-sample");
const fileInput = document.getElementById("file-input");
const loadFileBtn = document.getElementById("load-file");
const repoOwnerInput = document.getElementById("repo-owner");
const repoNameInput = document.getElementById("repo-name");
const repoBranchInput = document.getElementById("repo-branch");
const loadRepoBtn = document.getElementById("load-repo");
const repoFileList = document.getElementById("repo-file-list");
const repoTokenInput = document.getElementById("repo-token");
const repoPathInput = document.getElementById("repo-path");
const inactivityTimeoutInput = document.getElementById("inactivity-timeout");
const repoSpinner = document.getElementById("repo-spinner");
const themeToggle = document.getElementById("theme-toggle");
const copyOutputBtn = document.getElementById("copy-output");
const copyStatus = document.getElementById("copy-status");
const loadMoreBtn = document.getElementById("load-more");
const searchInput = document.getElementById("search-input");
const fileFilterInput = document.getElementById("file-filter");
const categoryFilter = document.getElementById("category-filter");
const exportTextBtn = document.getElementById("export-text");
const exportBundleBtn = document.getElementById("export-bundle");
const importBundleInput = document.getElementById("import-bundle");
const perfIndicator = document.getElementById("perf-indicator");
const historyList = document.getElementById("history-list");
const toast = document.getElementById("toast");
const previewMeta = document.getElementById("preview-meta");
const searchResultsList = document.getElementById("search-results");
const searchSummary = document.getElementById("search-summary");
const parseTitleInput = document.getElementById("parse-title");
const parseContentInput = document.getElementById("parse-content");
const parseUploadBtn = document.getElementById("parse-upload");
const parseFileInput = document.getElementById("parse-file");
const parseMessageInput = document.getElementById("parse-message");
const parseSaveBtn = document.getElementById("parse-save");

const MANIFEST_URL = "docs/manifest.json";
const FORMAT_VERSION = 2;
const DEFAULT_INACTIVITY_MINUTES = 60;
const DATA_EXTENSION = ".md.data";
const MARKDOWN_CHUNK_TARGET = 2000;
const AUTO_LOAD_ROOT_MARGIN = "240px";
const LIBRARIES = {
  marked: "vendor/marked.min.js",
  dompurify: "vendor/purify.min.js",
  highlight: "vendor/highlight.min.js",
  highlightCss: "vendor/github-dark.css",
};

const parsedCache = new Map();
const historyStore = new Map();
const payloadCodec = window.payloadCodec || {};

let hasDeparsedContent = false;
let inactivityTimer = null;
let inactivityLimitMs = DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
let currentFilePath = "";
const chunkTextDecoder = new TextDecoder();
let allRepoEntries = [];
let bundleEntries = [];
let librariesLoaded = false;
let activePayload = null;
let chunkDecoder = null;
let chunkCursor = 0;
let searchRunId = 0;
let isChunkLoading = false;
let autoLoadObserver = null;
const broadcast = "BroadcastChannel" in window ? new BroadcastChannel("app-channel") : null;

document.documentElement.dataset.theme = "dark";

function setStatus(message, isError = false, isSuccess = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.classList.toggle("success", isSuccess);
}

function setOutputState(state) {
  outputEl.classList.remove("success", "error");
  if (state) {
    outputEl.classList.add(state);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2000);
}

function setRepoLoading(isLoading) {
  repoSpinner.classList.toggle("active", isLoading);
  loadRepoBtn.disabled = isLoading;
}

function getAuthToken() {
  const inputToken = repoTokenInput.value.trim();
  if (inputToken) {
    return inputToken;
  }
  return "";
}

function buildAuthHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchWithRetry(url, options = {}, retries = 2) {
  const response = await fetch(url, options);
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0" && retries > 0) {
    const reset = Number(response.headers.get("x-ratelimit-reset") || 0) * 1000;
    const wait = Math.max(reset - Date.now(), 1000);
    setStatus(`GitHub rate limit reached. Retrying in ${Math.ceil(wait / 1000)}s...`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return fetchWithRetry(url, options, retries - 1);
  }
  return response;
}

async function getGitHubError(response) {
  let detail = "";
  try {
    const data = await response.json();
    detail = data.message || "";
  } catch (error) {
    detail = "";
  }
  return `GitHub error (${response.status}) ${detail}`.trim();
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

function splitMarkdownIntoChunks(markdown, targetSize = MARKDOWN_CHUNK_TARGET) {
  const lines = markdown.split("\n");
  const chunks = [];
  let buffer = "";
  let insideFence = false;

  const pushBuffer = () => {
    if (buffer.trim()) {
      chunks.push(buffer.replace(/\n{3,}/g, "\n\n"));
    }
    buffer = "";
  };

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      insideFence = !insideFence;
    }
    const suffix = index === lines.length - 1 ? "" : "\n";
    buffer += line + suffix;
    if (!insideFence && buffer.length >= targetSize) {
      pushBuffer();
    }
  });

  pushBuffer();
  return chunks;
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
  activePayload = null;
  chunkDecoder = null;
  chunkCursor = 0;
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
  outputEl.append(...fragment.childNodes);
}

async function renderNextChunk() {
  if (!activePayload || !chunkDecoder || chunkCursor >= activePayload.chunks.length || isChunkLoading) {
    loadMoreBtn.hidden = true;
    updateAutoLoadObserver();
    return;
  }

  resetInactivityTimer();
  const chunkEntry = activePayload.chunks[chunkCursor];
  chunkCursor += 1;
  isChunkLoading = true;

  const start = performance.now();
  let scrambled = null;
  let markdown = "";
  try {
    const decodedBytes = await chunkDecoder(chunkEntry, chunkCursor - 1);
    scrambled = scrambleBytes(decodedBytes);
    markdown = descrambleToString(scrambled);
    await appendMarkdownChunk(markdown);
  } catch (error) {
    setStatus(`Failed to render chunk: ${error.message}`, true);
  } finally {
    scrubChunk(scrambled);
    markdown = "";
    isChunkLoading = false;
  }

  const duration = Math.round(performance.now() - start);
  perfIndicator.textContent = `Render: ${duration}ms`;
  loadMoreBtn.hidden = chunkCursor >= activePayload.chunks.length;
  if (!loadMoreBtn.hidden) {
    setStatus("More content will load near the end of the page.");
  }
  updateAutoLoadObserver();
}

function updateAutoLoadObserver() {
  if (!("IntersectionObserver" in window)) {
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
  if (loadMoreBtn.hidden) {
    autoLoadObserver.unobserve(loadMoreBtn);
  } else {
    autoLoadObserver.observe(loadMoreBtn);
  }
}

async function renderMarkdown(payload, accessPhrase) {
  copyStatus.textContent = "";
  outputEl.innerHTML = "";
  clearSearchResults();
  loadMoreBtn.hidden = true;
  resetInactivityTimer();

  if (!payload?.chunks?.length) {
    hasDeparsedContent = false;
    return;
  }

  hasDeparsedContent = true;
  resetChunkRenderState();

  try {
    await ensureLibrariesLoaded();
    activePayload = payload;
    chunkDecoder = await createChunkDecoder(payload, accessPhrase);
    await renderNextChunk();
  } catch (error) {
    setStatus(`Render failed: ${error.message}`, true);
    resetChunkRenderState();
  }
}

async function encodeContent(markdown, accessPhrase) {
  if (!payloadCodec.encodePayloadChunks) {
    throw new Error("Encoding module unavailable.");
  }
  const chunks = splitMarkdownIntoChunks(markdown);
  return payloadCodec.encodePayloadChunks(chunks, accessPhrase, FORMAT_VERSION);
}

function isParsedPayloadFile(name) {
  return name.endsWith(DATA_EXTENSION);
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

function clearRepoFileList() {
  repoFileList.innerHTML = "";
}

function updatePreview(file) {
  if (!file) {
    previewMeta.textContent = "Select a file to preview.";
    return;
  }
  const status = file.isParsed ? "Parsed (.md.data)" : "Unsupported";
  const size = file.size ? `${file.size} bytes` : "Unknown size";
  previewMeta.textContent = `${file.name} · ${status} · ${size}`;
}

function createFileItem(file) {
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
  loadButton.addEventListener("click", () => handleRepoFileLoad(file));
  actions.appendChild(loadButton);

  item.appendChild(meta);
  item.appendChild(statusIcon);
  item.appendChild(actions);
  item.addEventListener("click", () => updatePreview(file));

  return item;
}

function renderFileGroups(entries) {
  clearRepoFileList();
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.textContent = "No parsed markdown files (.md.data) found.";
    repoFileList.appendChild(empty);
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
      repoFileList.appendChild(header);
      grouped[category].forEach((file) => {
        repoFileList.appendChild(createFileItem(file));
      });
    });
}

function filterEntries(entries, query) {
  if (!query) {
    return entries;
  }
  const lower = query.toLowerCase();
  return entries.filter((entry) => {
    if (entry.name.toLowerCase().includes(lower)) {
      return true;
    }
    return false;
  });
}

function filterByCategory(entries) {
  const category = categoryFilter.value;
  if (!category) {
    return entries;
  }
  return entries.filter((entry) => entry.category === category);
}

function updateCategoryOptions(entries) {
  const categories = Array.from(new Set(entries.map((entry) => entry.category))).sort();
  categoryFilter.innerHTML = "<option value=\"\">All categories</option>";
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });
}

function getFilteredEntries(entries) {
  const query = fileFilterInput.value.trim();
  return filterByCategory(filterEntries(entries, query));
}

function normalizeRepoPath(path) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "docs";
  }
  return trimmed.replace(/^\/+|\/+$/g, "");
}

function ensurePayloadExtension(path) {
  if (!path) {
    return "";
  }
  return path.endsWith(DATA_EXTENSION) ? path : `${path}${DATA_EXTENSION}`;
}

function getRepoCategory(entryPath, rootPath) {
  const normalizedRoot = rootPath ? rootPath.replace(/\/+$/g, "") : "";
  const prefix = normalizedRoot ? `${normalizedRoot}/` : "";
  const relative = entryPath.startsWith(prefix) ? entryPath.slice(prefix.length) : entryPath;
  return relative.split("/").slice(0, -1).join("/");
}

async function fetchRepoEntries(owner, repo, branch, path, rootPath = path) {
  const pathSegment = path ? `/${path}` : "";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${pathSegment}?ref=${branch}`;
  const response = await fetchWithRetry(apiUrl, {
    headers: buildAuthHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await getGitHubError(response));
  }
  const entries = await response.json();
  if (!Array.isArray(entries)) {
    throw new Error("Unexpected GitHub response format.");
  }
  const files = [];
  for (const entry of entries) {
    if (entry.type === "dir") {
      const nested = await fetchRepoEntries(owner, repo, branch, entry.path, rootPath);
      files.push(...nested);
    } else if (entry.type === "file" && isParsedPayloadFile(entry.name)) {
      const category = getRepoCategory(entry.path, rootPath);
      files.push({
        name: entry.name,
        path: entry.path,
        isParsed: isParsedPayloadFile(entry.name),
        category: category || "Root",
        source: "repo",
        size: entry.size,
      });
    }
  }
  return files;
}

function rawGitHubUrl(owner, repo, branch, path) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

async function fetchRawFile(owner, repo, branch, path, token) {
  if (token) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      const response = await fetchWithRetry(apiUrl, {
        headers: {
          ...buildAuthHeaders(),
          Accept: "application/vnd.github.raw",
        },
        cache: "no-store",
      });
    if (response.ok) {
      return response;
    }
    if (response.status === 401 || response.status === 403) {
      const fallback = await fetchWithRetry(apiUrl, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.raw",
        },
        cache: "no-store",
      });
      if (!fallback.ok) {
        throw new Error(await getGitHubError(fallback));
      }
      return fallback;
    }
    throw new Error(await getGitHubError(response));
  }
  const response = await fetchWithRetry(rawGitHubUrl(owner, repo, branch, path), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await getGitHubError(response));
  }
  return response;
}

async function loadRepoFiles() {
  const owner = repoOwnerInput.value.trim();
  const repo = repoNameInput.value.trim();
  const branch = repoBranchInput.value.trim() || "main";
  const repoPath = normalizeRepoPath(repoPathInput.value);
  const displayPath = repoPath ? `${repoPath}/` : "repo root";

  if (!owner || !repo) {
    setStatus("Enter a GitHub owner and repository name.", true);
    return;
  }

  if (!navigator.onLine) {
    setStatus("Offline mode: unable to fetch GitHub repo list.", true);
    renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
    return;
  }

  setRepoLoading(true);
  setStatus(`Loading ${displayPath} listing from GitHub...`);
  try {
    allRepoEntries = await fetchRepoEntries(owner, repo, branch, repoPath);
    const combined = [...allRepoEntries, ...bundleEntries];
    updateCategoryOptions(combined);
    renderFileGroups(getFilteredEntries(combined));
    setStatus(
      `Loaded ${allRepoEntries.length} parsed payload files (.md.data) from ${displayPath}.`,
      false,
      true
    );
  } catch (error) {
    renderFileGroups([]);
    setStatus(`Failed to load repo files: ${error.message}`, true);
  } finally {
    setRepoLoading(false);
  }
}

function updateHistory(path, size) {
  const entries = historyStore.get(path) || [];
  entries.unshift({ timestamp: new Date().toISOString(), size });
  historyStore.set(path, entries.slice(0, 5));
  renderHistory(entries);
}

function renderHistory(entries) {
  historyList.innerHTML = "";
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.timestamp} · ${entry.size} bytes`;
    historyList.appendChild(item);
  });
}

function getAccessPhrase() {
  return accessPhraseInput.value.trim();
}

async function handleRepoFileLoad(file) {
  if (!file.isParsed) {
    setStatus("Only parsed markdown payloads (.md.data) are supported.", true);
    return;
  }
  const owner = repoOwnerInput.value.trim();
  const repo = repoNameInput.value.trim();
  const branch = repoBranchInput.value.trim() || "main";
  const accessPhrase = accessPhraseInput.value.trim();
  const token = getAuthToken();

  if (file.source !== "bundle" && (!owner || !repo)) {
    setStatus("Enter a GitHub owner and repository name.", true);
    return;
  }
  if (file.source !== "bundle" && !navigator.onLine) {
    setStatus("Offline mode: unable to fetch file from GitHub.", true);
    return;
  }

  if (file.isParsed && !accessPhrase) {
    setStatus("Enter a session code before de-parsing files.", true);
    return;
  }

  setStatus("Loading payload...");
  setOutputState("");
  try {
    let payloadSize = file.size || 0;
    let payload = null;
    if (file.source === "bundle") {
      payload = parsedCache.get(file.path);
      if (!payload) {
        throw new Error(`Missing export data for ${file.path}.`);
      }
      assertPayloadFormat(payload);
      payloadSize = JSON.stringify(payload).length;
    } else {
      const response = await fetchRawFile(owner, repo, branch, file.path, token);
      payload = await response.json();
      assertPayloadFormat(payload);
      parsedCache.set(file.path, payload);
      payloadSize = JSON.stringify(payload).length;
    }
    currentFilePath = file.path;
    await renderMarkdown(payload, accessPhrase);
    setStatus("File loaded successfully.", false, true);
    setOutputState("success");
    updateHistory(file.path, payloadSize);
    renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
    updatePreview(file);
    if (broadcast) {
      broadcast.postMessage({ type: "content", file: file.path });
    }
  } catch (error) {
    setStatus(`Failed to load file: ${error.message}`, true);
    setOutputState("error");
  }
}

async function loadSamples() {
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unable to fetch sample manifest.");
    }
    const manifest = await response.json();
    sampleSelect.innerHTML = "<option value=\"\">Select a sample</option>";
    manifest.samples.forEach((sample) => {
      const option = document.createElement("option");
      option.value = sample.path;
      option.textContent = sample.label;
      sampleSelect.appendChild(option);
    });
  } catch (error) {
    sampleSelect.innerHTML = "<option value=\"\">No samples available</option>";
    setStatus(error.message, true);
  }
}

async function handleSampleLoad() {
  const path = sampleSelect.value;
  const accessPhrase = accessPhraseInput.value.trim();

  if (!path) {
    setStatus("Please choose a sample file.", true);
    return;
  }

  if (!accessPhrase) {
    setStatus("Enter a session code before de-parsing.", true);
    return;
  }

  setStatus("De-parsing sample...");
  setOutputState("");

  try {
    const response = await fetch(path, { cache: "no-store" });
    const payload = await response.json();
    assertPayloadFormat(payload);
    parsedCache.set(path, payload);
    currentFilePath = path;
    await renderMarkdown(payload, accessPhrase);
    setStatus("Sample processed successfully.", false, true);
    setOutputState("success");
    updateHistory(path, JSON.stringify(payload).length);
    updatePreview({ name: path.split("/").pop(), path, isParsed: true, size: JSON.stringify(payload).length });
    if (broadcast) {
      broadcast.postMessage({ type: "content", file: path });
    }
  } catch (error) {
    setStatus(`Failed to process sample: ${error.message}`, true);
    setOutputState("error");
  }
}

async function handleFileLoad() {
  const file = fileInput.files[0];
  const accessPhrase = accessPhraseInput.value.trim();

  if (!file) {
    setStatus("Choose a local parsed payload file first.", true);
    return;
  }

  if (!accessPhrase) {
    setStatus("Enter a session code before de-parsing.", true);
    return;
  }

  setStatus("De-parsing local file...");
  setOutputState("");

  try {
    const contents = await file.text();
    const payload = JSON.parse(contents);
    assertPayloadFormat(payload);
    parsedCache.set(file.name, payload);
    currentFilePath = file.name;
    await renderMarkdown(payload, accessPhrase);
    setStatus("Local file processed successfully.", false, true);
    setOutputState("success");
    updateHistory(file.name, file.size);
    updatePreview({ name: file.name, path: file.name, isParsed: true, size: file.size });
    if (broadcast) {
      broadcast.postMessage({ type: "content", file: file.name });
    }
  } catch (error) {
    setStatus(`Failed to process file: ${error.message}`, true);
    setOutputState("error");
  }
}

function clearDeparsedContent(reason) {
  outputEl.innerHTML = "";
  currentFilePath = "";
  hasDeparsedContent = false;
  parsedCache.clear();
  historyStore.clear();
  resetChunkRenderState();
  setOutputState("");
  copyStatus.textContent = "";
  loadMoreBtn.hidden = true;
  historyList.innerHTML = "";
  updatePreview(null);
  searchResultsList.innerHTML = "";
  searchSummary.textContent = "";
  if (reason) {
    setStatus(reason);
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
    if (hasDeparsedContent) {
  clearDeparsedContent("Processed content cleared after inactivity.");
    }
  }, inactivityLimitMs);
}

function updateInactivityTimeout() {
  const minutes = Number.parseFloat(inactivityTimeoutInput.value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    inactivityLimitMs = DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
    inactivityTimeoutInput.value = String(DEFAULT_INACTIVITY_MINUTES);
  } else {
    inactivityLimitMs = Math.round(minutes * 60 * 1000);
  }
  resetInactivityTimer();
}

function clearSearchResults() {
  searchResultsList.innerHTML = "";
  searchSummary.textContent = "";
}

function buildSearchPreview(text, matchIndex, queryLength) {
  const radius = 48;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + queryLength + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${prefix}${snippet}${suffix}`;
}

function renderSearchResults(results, query) {
  clearSearchResults();
  if (!query) {
    return;
  }
  if (!results.length) {
    const item = document.createElement("li");
    item.textContent = "No matches found.";
    searchResultsList.appendChild(item);
    return;
  }

  results.forEach((result) => {
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
    openButton.addEventListener("click", () => renderChunkAtIndex(result.chunkIndex));
    actions.appendChild(openButton);

    item.appendChild(meta);
    item.appendChild(actions);
    searchResultsList.appendChild(item);
  });
}

async function renderChunkAtIndex(index) {
  if (!activePayload) {
    setStatus("Load a parsed file before opening a result.", true);
    return;
  }
  const accessPhrase = getAccessPhrase();
  if (!accessPhrase) {
    setStatus("Enter a session code before opening a result.", true);
    return;
  }
  setStatus("Loading search result chunk...");
  try {
    await ensureLibrariesLoaded();
    chunkDecoder = await createChunkDecoder(activePayload, accessPhrase);
    chunkCursor = Math.max(0, Math.min(index, activePayload.chunks.length - 1));
    outputEl.innerHTML = "";
    await renderNextChunk();
    setStatus("Search result loaded.", false, true);
  } catch (error) {
    setStatus(`Failed to load search result: ${error.message}`, true);
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const isLight = root.dataset.theme === "light";
  root.dataset.theme = isLight ? "dark" : "light";
  themeToggle.textContent = isLight ? "Switch to light" : "Switch to dark";
  themeToggle.setAttribute("aria-pressed", String(!isLight));
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
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
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

async function copyDeparsedContent() {
  if (!activePayload) {
    copyStatus.textContent = "Nothing to copy yet.";
    return;
  }
  const accessPhrase = getAccessPhrase();
  if (!accessPhrase) {
    copyStatus.textContent = "Enter a session code before copying.";
    return;
  }
  copyStatus.textContent = "Copying content...";
  const writeWithAsyncClipboard = async () => {
    const blob = await buildPlaintextBlob(activePayload, accessPhrase);
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
  };
  try {
    if (!navigator.clipboard?.write) {
      throw new Error("ClipboardWriteUnavailable");
    }
    if (!isClipboardContextAllowed()) {
      throw new Error("ClipboardContextBlocked");
    }
    await writeWithAsyncClipboard();
    copyStatus.textContent = "Copied to clipboard.";
    showToast("Copied to clipboard");
  } catch (error) {
    const name = error?.name || error?.message || "Error";
    let text = "";
    try {
      text = await buildPlaintextText(activePayload, accessPhrase);
      const ok = await fallbackExecCommandCopy(text);
      if (ok) {
        copyStatus.textContent = `Copied (fallback after ${name}).`;
        showToast("Copied to clipboard");
      } else {
        copyStatus.textContent = `Copy blocked (${name}). Try: use the Copy button, keep the tab focused, allow clipboard in site settings, avoid embedded frames or guest mode.`;
      }
    } catch (fallbackError) {
      copyStatus.textContent = `Copy blocked (${name}). Try: use the Copy button, keep the tab focused, allow clipboard in site settings, avoid embedded frames or guest mode.`;
    } finally {
      text = "";
    }
  }
}

async function exportText() {
  if (!activePayload) {
    setStatus("Nothing to export yet.", true);
    return;
  }
  const accessPhrase = getAccessPhrase();
  if (!accessPhrase) {
    setStatus("Enter a session code before exporting.", true);
    return;
  }
  try {
    setStatus("Preparing export...");
    const blob = await buildPlaintextBlob(activePayload, accessPhrase);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${currentFilePath || "processed-content"}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("Export ready.", false, true);
  } catch (error) {
    setStatus(`Export failed: ${error.message}`, true);
  }
}

function exportBundle() {
  const files = [];
  parsedCache.forEach((payload, path) => {
    files.push({ path, payload });
  });
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
  const file = importBundleInput.files[0];
  if (!file) {
    return;
  }
  try {
    const contents = await file.text();
    const bundle = JSON.parse(contents);
    if (!Array.isArray(bundle.files)) {
      throw new Error("Invalid export format.");
    }
    bundleEntries = bundle.files.map((entry) => ({
      name: entry.path.split("/").pop(),
      path: entry.path,
      isParsed: true,
      category: "Imported Bundle",
      source: "bundle",
      size: JSON.stringify(entry.payload).length,
    }));
    bundle.files.forEach((entry) => {
      assertPayloadFormat(entry.payload);
      parsedCache.set(entry.path, entry.payload);
    });
    const combined = [...allRepoEntries, ...bundleEntries];
    updateCategoryOptions(combined);
    renderFileGroups(getFilteredEntries(combined));
    setStatus("Bundle imported.", false, true);
  } catch (error) {
    setStatus(`Failed to import export file: ${error.message}`, true);
  }
}

async function parseAndUpload() {
  const owner = repoOwnerInput.value.trim();
  const repo = repoNameInput.value.trim();
  const branch = repoBranchInput.value.trim() || "main";
  const targetPath = ensurePayloadExtension(parseTitleInput.value.trim());
  const accessPhrase = accessPhraseInput.value.trim();
  const token = getAuthToken();
  const commitMessage = parseMessageInput.value.trim();

  if (!owner || !repo || !targetPath) {
    setStatus("Provide owner, repo, and target path.", true);
    return;
  }
  if (!accessPhrase) {
    setStatus("Provide a session code and markdown content.", true);
    return;
  }
  if (!token) {
    setStatus("GitHub token required to upload payload files.", true);
    return;
  }

  setStatus("Parsing and uploading to GitHub...");
  try {
    let markdown = parseContentInput.value.trim();
    if (parseFileInput.files.length > 0) {
      markdown = await parseFileInput.files[0].text();
    }
    if (!markdown) {
      setStatus("Provide a session code and markdown content.", true);
      return;
    }
    const payload = await encodeContent(markdown, accessPhrase);
    parseContentInput.value = "";
    parseFileInput.value = "";
    markdown = "";
    const body = {
      message: commitMessage || `Add payload ${targetPath}`,
      content: btoa(JSON.stringify(payload)),
      branch,
    };
    const response = await fetchWithRetry(
      `https://api.github.com/repos/${owner}/${repo}/contents/${targetPath}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          ...buildAuthHeaders(),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
    if (!response.ok) {
      throw new Error(await getGitHubError(response));
    }
    setStatus("Uploaded file.", false, true);
    parseTitleInput.value = "";
    parseMessageInput.value = "";
  } catch (error) {
    setStatus(`Upload failed: ${error.message}`, true);
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
  const targetPath = ensurePayloadExtension(parseTitleInput.value.trim() || "local.md.data");
  const accessPhrase = getAccessPhrase();

  if (!accessPhrase) {
    setStatus("Provide a session code and markdown content.", true);
    return;
  }

  setStatus("Parsing for local save...");
  try {
    let markdown = parseContentInput.value.trim();
    if (parseFileInput.files.length > 0) {
      markdown = await parseFileInput.files[0].text();
    }
    if (!markdown) {
      setStatus("Provide a session code and markdown content.", true);
      return;
    }
    const payload = await encodeContent(markdown, accessPhrase);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    triggerDownload(blob, targetPath);
    parseContentInput.value = "";
    parseFileInput.value = "";
    setStatus("Local file ready.", false, true);
  } catch (error) {
    setStatus(`Local save failed: ${error.message}`, true);
  }
}

async function handleSearch() {
  const query = searchInput.value.trim();
  const runId = ++searchRunId;
  clearSearchResults();
  if (!query) {
    searchSummary.textContent = "";
    return;
  }
  if (!activePayload) {
    searchSummary.textContent = "Load a file to search.";
    return;
  }
  const accessPhrase = getAccessPhrase();
  if (!accessPhrase) {
    searchSummary.textContent = "Enter a session code to search.";
    return;
  }
  searchSummary.textContent = "Scanning...";
  const results = [];
  const loweredQuery = query.toLowerCase();

  try {
    await payloadCodec.decodePayloadChunks(
      activePayload,
      accessPhrase,
      FORMAT_VERSION,
      async (bytes, index, total) => {
        if (runId !== searchRunId) {
          return;
        }
        let text = chunkTextDecoder.decode(bytes);
        let lower = text.toLowerCase();
        let offset = 0;
        let matchCount = 0;
        let firstMatch = -1;
        const offsets = [];
        while (true) {
          const next = lower.indexOf(loweredQuery, offset);
          if (next === -1) {
            break;
          }
          if (firstMatch === -1) {
            firstMatch = next;
          }
          if (offsets.length < 5) {
            offsets.push(next);
          }
          matchCount += 1;
          offset = next + loweredQuery.length;
        }
        if (matchCount > 0) {
          results.push({
            chunkIndex: index,
            matchCount,
            offsets,
            preview: buildSearchPreview(text, firstMatch, loweredQuery.length),
          });
        }
        searchSummary.textContent = `Scanning ${index + 1} of ${total}...`;
        text = "";
        lower = "";
      }
    );
    if (runId !== searchRunId) {
      return;
    }
    searchSummary.textContent = `Found ${results.length} matching chunk${results.length === 1 ? "" : "s"}.`;
    renderSearchResults(results, query);
  } catch (error) {
    if (runId !== searchRunId) {
      return;
    }
    searchSummary.textContent = "";
    setStatus(`Search failed: ${error.message}`, true);
  }
}

function registerShortcuts(event) {
  if (event.target.matches("input, textarea")) {
    return;
  }
  if (event.key === "f") {
    fileFilterInput.focus();
    event.preventDefault();
  }
  if (event.key === "s") {
    searchInput.focus();
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

loadSampleBtn.addEventListener("click", handleSampleLoad);
loadFileBtn.addEventListener("click", handleFileLoad);
loadRepoBtn.addEventListener("click", loadRepoFiles);
themeToggle.addEventListener("click", toggleTheme);
copyOutputBtn.addEventListener("click", copyDeparsedContent);
loadMoreBtn.addEventListener("click", renderNextChunk);
searchInput.addEventListener("input", handleSearch);
categoryFilter.addEventListener("change", () => {
  renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
});
fileFilterInput.addEventListener("input", () => {
  renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
});
inactivityTimeoutInput.addEventListener("input", updateInactivityTimeout);
exportTextBtn.addEventListener("click", exportText);
exportBundleBtn.addEventListener("click", exportBundle);
importBundleInput.addEventListener("change", importBundle);
parseUploadBtn.addEventListener("click", parseAndUpload);
parseSaveBtn.addEventListener("click", parseAndSave);
outputEl.addEventListener("contextmenu", (event) => event.preventDefault());

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
  if (hasDeparsedContent) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (broadcast) {
  broadcast.onmessage = (event) => {
    if (event.data?.type === "content" && hasDeparsedContent && event.data.file !== currentFilePath) {
      clearDeparsedContent("Another tab processed content. Cleared for safety.");
    }
  };
}

updateInactivityTimeout();
loadSamples();
