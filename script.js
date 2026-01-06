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
const inactivityTimeoutInput = document.getElementById("inactivity-timeout");
const repoSpinner = document.getElementById("repo-spinner");
const accessToggle = document.getElementById("toggle-access");
const themeToggle = document.getElementById("theme-toggle");
const copyOutputBtn = document.getElementById("copy-output");
const copyStatus = document.getElementById("copy-status");
const loadMoreBtn = document.getElementById("load-more");
const accessStrength = document.getElementById("access-strength");
const accessFeedback = document.getElementById("access-feedback");
const searchInput = document.getElementById("search-input");
const categoryFilter = document.getElementById("category-filter");
const exportTextBtn = document.getElementById("export-text");
const exportBundleBtn = document.getElementById("export-bundle");
const importBundleInput = document.getElementById("import-bundle");
const perfIndicator = document.getElementById("perf-indicator");
const historyList = document.getElementById("history-list");
const toast = document.getElementById("toast");
const previewMeta = document.getElementById("preview-meta");
const parseTitleInput = document.getElementById("parse-title");
const parseContentInput = document.getElementById("parse-content");
const parseUploadBtn = document.getElementById("parse-upload");
const parseFileInput = document.getElementById("parse-file");
const parseMessageInput = document.getElementById("parse-message");

const MANIFEST_URL = "docs/manifest.json";
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 100000;
const DEFAULT_INACTIVITY_MINUTES = 30;
const TOKEN_BATCH_SIZE = 80;
const LIBRARIES = {
  marked: "vendor/marked.min.js",
  dompurify: "vendor/purify.min.js",
  highlight: "vendor/highlight.min.js",
  highlightCss: "vendor/github-dark.css",
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const deparsedCache = new Map();
const parsedCache = new Map();
const accessPhraseStore = new Map();
const historyStore = new Map();

let hasDeparsedContent = false;
let inactivityTimer = null;
let inactivityLimitMs = DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
let currentMarkdown = "";
let currentFilePath = "";
let pendingTokens = [];
let allRepoEntries = [];
let bundleEntries = [];
let librariesLoaded = false;
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
    const payload = await response.json();
    detail = payload.message || "";
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
  outputEl.innerHTML = htmlLines.join("\n");
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

function renderTokensBatch() {
  const batch = pendingTokens.splice(0, TOKEN_BATCH_SIZE);
  if (!batch.length) {
    loadMoreBtn.hidden = true;
    return;
  }
  const html = window.marked
    ? window.marked.parser(batch)
    : escapeHtml(batch.map((token) => token.raw || "").join(""));
  const sanitized = sanitizeHtml(html);
  const fragment = document.createElement("div");
  fragment.innerHTML = sanitized;
  fragment.querySelectorAll("pre code").forEach((block) => {
    if (window.hljs) {
      window.hljs.highlightElement(block);
    }
  });
  outputEl.append(...fragment.childNodes);
  loadMoreBtn.hidden = pendingTokens.length === 0;
}

async function renderMarkdown(markdown) {
  copyStatus.textContent = "";
  outputEl.innerHTML = "";
  currentMarkdown = markdown;
  hasDeparsedContent = Boolean(markdown.trim());
  resetInactivityTimer();

  const start = performance.now();
  try {
    await ensureLibrariesLoaded();
    pendingTokens = window.marked ? window.marked.lexer(markdown) : [];
    renderTokensBatch();
    if (pendingTokens.length > 0) {
      setStatus("Large file detected. Use “Load more” to continue rendering.");
    }
  } catch (error) {
    renderMarkdownFallback(markdown);
    loadMoreBtn.hidden = true;
  }
  const duration = Math.round(performance.now() - start);
  perfIndicator.textContent = `Render: ${duration}ms`;
}

function parseBase64(value) {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function toBase64(bytes) {
  const chunkSize = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(""));
}

async function deriveAccessKey(accessPhrase, seed, usages) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(accessPhrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: seed,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

async function parseMarkdown(markdown, accessPhrase) {
  const seed = crypto.getRandomValues(new Uint8Array(16));
  const offset = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAccessKey(accessPhrase, seed, ["encrypt"]);
  const payloadBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: offset },
    key,
    textEncoder.encode(markdown)
  );

  const payload = {
    version: FORMAT_VERSION,
    seed: toBase64(seed),
    offset: toBase64(offset),
    payload: toBase64(new Uint8Array(payloadBuffer)),
  };

  seed.fill(0);
  offset.fill(0);
  return payload;
}

async function deparsePayload(payload, accessPhrase) {
  if (payload.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported format version: ${payload.version}`);
  }
  const seed = parseBase64(payload.seed);
  const offset = parseBase64(payload.offset);
  const payloadBytes = parseBase64(payload.payload);

  const key = await deriveAccessKey(accessPhrase, seed, ["decrypt"]);
  const resultBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: offset },
    key,
    payloadBytes
  );

  const resultBytes = new Uint8Array(resultBuffer);
  const parsed = textDecoder.decode(resultBytes);
  seed.fill(0);
  offset.fill(0);
  payloadBytes.fill(0);
  resultBytes.fill(0);
  return parsed;
}

function isParsedFile(name) {
  return name.endsWith(".md.enc") || name.endsWith(".json");
}

function isMarkdownFile(name) {
  return isParsedFile(name);
}

function clearRepoFileList() {
  repoFileList.innerHTML = "";
}

function updatePreview(file) {
  if (!file) {
    previewMeta.textContent = "Select a file to preview.";
    return;
  }
  const status = file.parsed ? "Parsed" : "Plain";
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
    empty.textContent = "No markdown files found.";
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
    const cached = deparsedCache.get(entry.path);
    if (cached && cached.toLowerCase().includes(lower)) {
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
  const query = searchInput.value.trim();
  return filterByCategory(filterEntries(entries, query));
}

async function fetchRepoEntries(owner, repo, branch, path = "docs") {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
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
      const nested = await fetchRepoEntries(owner, repo, branch, entry.path);
      files.push(...nested);
    } else if (entry.type === "file" && isMarkdownFile(entry.name)) {
      const category = entry.path.replace("docs/", "").split("/").slice(0, -1).join("/");
      files.push({
        name: entry.name,
        path: entry.path,
        parsed: isParsedFile(entry.name),
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

  if (!owner || !repo) {
    setStatus("Enter a GitHub owner and repository name.", true);
    return;
  }

  if (!navigator.onLine) {
    setStatus("Offline mode: unable to fetch GitHub repo list.", true);
    renderFileGroups(filterEntries([...allRepoEntries, ...bundleEntries], searchInput.value.trim()));
    return;
  }

  setRepoLoading(true);
  setStatus("Loading docs/ listing from GitHub...");
  try {
    allRepoEntries = await fetchRepoEntries(owner, repo, branch);
    const combined = [...allRepoEntries, ...bundleEntries];
    updateCategoryOptions(combined);
    renderFileGroups(getFilteredEntries(combined));
    setStatus(`Loaded ${allRepoEntries.length} markdown files from docs/.`, false, true);
  } catch (error) {
    renderFileGroups([]);
    setStatus(`Failed to load repo files: ${error.message}`, true);
  } finally {
    setRepoLoading(false);
  }
}

function updateHistory(path, markdown) {
  const entries = historyStore.get(path) || [];
  entries.unshift({ timestamp: new Date().toISOString(), size: markdown.length });
  historyStore.set(path, entries.slice(0, 5));
  renderHistory(entries);
}

function renderHistory(entries) {
  historyList.innerHTML = "";
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.timestamp} · ${entry.size} chars`;
    historyList.appendChild(item);
  });
}

function getAccessPhraseForFile(path, provided) {
  if (provided) {
    accessPhraseStore.set(path, provided);
    return provided;
  }
  return accessPhraseStore.get(path) || "";
}

async function handleRepoFileLoad(file) {
  if (!file.parsed) {
    setStatus("Plain markdown is not supported. Use parsed payloads only.", true);
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

  if (file.parsed && !getAccessPhraseForFile(file.path, accessPhrase)) {
    setStatus("Enter an access phrase before de-parsing files.", true);
    return;
  }

  if (deparsedCache.has(file.path)) {
    currentFilePath = file.path;
    await renderMarkdown(deparsedCache.get(file.path));
    setStatus("Loaded cached de-parsed content.", false, true);
    setOutputState("success");
    updateHistory(file.path, deparsedCache.get(file.path));
    renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
    return;
  }

  setStatus("Loading file from GitHub...");
  setOutputState("");
  try {
    let markdown = "";
    if (file.source === "bundle") {
      const payload = parsedCache.get(file.path);
      if (!payload) {
        throw new Error(`Missing bundle payload for ${file.path}.`);
      }
      markdown = await deparsePayload(payload, getAccessPhraseForFile(file.path, accessPhrase));
    } else {
      const response = await fetchRawFile(owner, repo, branch, file.path, token);
      if (file.parsed) {
        const payload = await response.json();
        parsedCache.set(file.path, payload);
        markdown = await deparsePayload(payload, getAccessPhraseForFile(file.path, accessPhrase));
      } else {
        markdown = await response.text();
      }
    }
    deparsedCache.set(file.path, markdown);
    currentFilePath = file.path;
    await renderMarkdown(markdown);
    setStatus("File loaded successfully.", false, true);
    setOutputState("success");
    updateHistory(file.path, markdown);
    renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
    updatePreview(file);
    if (broadcast) {
      broadcast.postMessage({ type: "content-updated", file: file.path });
    }
    markdown = "";
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
    setStatus("Enter an access phrase before de-parsing.", true);
    return;
  }

  setStatus("De-parsing sample...");
  setOutputState("");

  try {
    const response = await fetch(path, { cache: "no-store" });
    const payload = await response.json();
    parsedCache.set(path, payload);
    let markdown = await deparsePayload(payload, getAccessPhraseForFile(path, accessPhrase));
    deparsedCache.set(path, markdown);
    currentFilePath = path;
    await renderMarkdown(markdown);
    setStatus("Sample de-parsed successfully.", false, true);
    setOutputState("success");
    updateHistory(path, markdown);
    updatePreview({ name: path.split("/").pop(), path, parsed: true, size: JSON.stringify(payload).length });
    if (broadcast) {
      broadcast.postMessage({ type: "content-updated", file: path });
    }
    markdown = "";
  } catch (error) {
    setStatus(`Failed to de-parse sample: ${error.message}`, true);
    setOutputState("error");
  }
}

async function handleFileLoad() {
  const file = fileInput.files[0];
  const accessPhrase = accessPhraseInput.value.trim();

  if (!file) {
    setStatus("Choose a local parsed file first.", true);
    return;
  }

  if (!accessPhrase) {
    setStatus("Enter an access phrase before de-parsing.", true);
    return;
  }

  setStatus("De-parsing local file...");
  setOutputState("");

  try {
    const contents = await file.text();
    const payload = JSON.parse(contents);
    parsedCache.set(file.name, payload);
    let markdown = await deparsePayload(payload, getAccessPhraseForFile(file.name, accessPhrase));
    deparsedCache.set(file.name, markdown);
    currentFilePath = file.name;
    await renderMarkdown(markdown);
    setStatus("Local file de-parsed successfully.", false, true);
    setOutputState("success");
    updateHistory(file.name, markdown);
    updatePreview({ name: file.name, path: file.name, parsed: true, size: file.size });
    if (broadcast) {
      broadcast.postMessage({ type: "content-updated", file: file.name });
    }
    markdown = "";
  } catch (error) {
    setStatus(`Failed to de-parse file: ${error.message}`, true);
    setOutputState("error");
  }
}

function clearDeparsedContent(reason) {
  outputEl.innerHTML = "";
  currentMarkdown = "";
  currentFilePath = "";
  hasDeparsedContent = false;
  deparsedCache.clear();
  parsedCache.clear();
  accessPhraseStore.clear();
  setOutputState("");
  copyStatus.textContent = "";
  loadMoreBtn.hidden = true;
  historyList.innerHTML = "";
  updatePreview(null);
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
      clearDeparsedContent("De-parsed content cleared after inactivity.");
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

function evaluateAccessStrength(accessPhrase) {
  let score = 0;
  if (accessPhrase.length >= 8) score += 1;
  if (/[A-Z]/.test(accessPhrase) && /[a-z]/.test(accessPhrase)) score += 1;
  if (/\d/.test(accessPhrase)) score += 1;
  if (/[^A-Za-z0-9]/.test(accessPhrase)) score += 1;
  return score;
}

function updateAccessStrength() {
  const accessPhrase = accessPhraseInput.value;
  const score = evaluateAccessStrength(accessPhrase);
  accessStrength.value = score;
  const feedback = ["Enter an access phrase", "Weak", "Fair", "Good", "Strong"];
  accessFeedback.textContent = feedback[score] || "Strong";
}

function toggleAccessVisibility() {
  const isHidden = accessPhraseInput.type === "password";
  accessPhraseInput.type = isHidden ? "text" : "password";
  accessToggle.textContent = isHidden ? "Hide" : "Show";
  accessToggle.setAttribute("aria-pressed", String(isHidden));
}

function toggleTheme() {
  const root = document.documentElement;
  const isLight = root.dataset.theme === "light";
  root.dataset.theme = isLight ? "dark" : "light";
  themeToggle.textContent = isLight ? "Switch to light" : "Switch to dark";
  themeToggle.setAttribute("aria-pressed", String(!isLight));
}

async function copyDeparsedContent() {
  if (!currentMarkdown.trim()) {
    copyStatus.textContent = "Nothing to copy yet.";
    return;
  }
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    copyStatus.textContent = "De-parsed content copied.";
    showToast("Copied to clipboard");
  } catch (error) {
    copyStatus.textContent = "Copy failed. Try selecting text manually.";
  }
}

function exportText() {
  if (!currentMarkdown.trim()) {
    setStatus("Nothing to export yet.", true);
    return;
  }
  const blob = new Blob([currentMarkdown], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${currentFilePath || "deparsed"}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
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
  link.download = "parsed-bundle.json";
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
      throw new Error("Invalid bundle format.");
    }
    bundleEntries = bundle.files.map((entry) => ({
      name: entry.path.split("/").pop(),
      path: entry.path,
      parsed: true,
      category: "Imported Bundle",
      source: "bundle",
      size: JSON.stringify(entry.payload).length,
    }));
    bundle.files.forEach((entry) => {
      parsedCache.set(entry.path, entry.payload);
    });
    const combined = [...allRepoEntries, ...bundleEntries];
    updateCategoryOptions(combined);
    renderFileGroups(getFilteredEntries(combined));
    setStatus("Bundle imported.", false, true);
  } catch (error) {
    setStatus(`Failed to import bundle: ${error.message}`, true);
  }
}

async function parseAndUpload() {
  const owner = repoOwnerInput.value.trim();
  const repo = repoNameInput.value.trim();
  const branch = repoBranchInput.value.trim() || "main";
  const targetPath = parseTitleInput.value.trim();
  const accessPhrase = accessPhraseInput.value.trim();
  const token = getAuthToken();
  const commitMessage = parseMessageInput.value.trim();

  if (!owner || !repo || !targetPath) {
    setStatus("Provide owner, repo, and target path.", true);
    return;
  }
  if (!targetPath.endsWith(".md.enc")) {
    setStatus("Upload path must end with .md.enc", true);
    return;
  }
  if (!accessPhrase) {
    setStatus("Provide an access phrase and markdown content.", true);
    return;
  }
  if (!token) {
    setStatus("GitHub token required to upload parsed files.", true);
    return;
  }

  setStatus("Parsing and uploading to GitHub...");
  try {
    let markdown = parseContentInput.value.trim();
    if (parseFileInput.files.length > 0) {
      markdown = await parseFileInput.files[0].text();
    }
    if (!markdown) {
      setStatus("Provide an access phrase and markdown content.", true);
      return;
    }
    const payload = await parseMarkdown(markdown, accessPhrase);
    const body = {
      message: commitMessage || `Add parsed file ${targetPath}`,
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
    setStatus("Parsed file uploaded.", false, true);
    parseContentInput.value = "";
    parseTitleInput.value = "";
    parseMessageInput.value = "";
    parseFileInput.value = "";
  } catch (error) {
    setStatus(`Upload failed: ${error.message}`, true);
  }
}

function handleSearch() {
  const combined = [...allRepoEntries, ...bundleEntries];
  renderFileGroups(getFilteredEntries(combined));
}

function registerShortcuts(event) {
  if (event.target.matches("input, textarea")) {
    return;
  }
  if (event.key === "f") {
    searchInput.focus();
    event.preventDefault();
  }
  if (event.key === "p") {
    toggleAccessVisibility();
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
    renderTokensBatch();
    event.preventDefault();
  }
}

loadSampleBtn.addEventListener("click", handleSampleLoad);
loadFileBtn.addEventListener("click", handleFileLoad);
loadRepoBtn.addEventListener("click", loadRepoFiles);
accessToggle.addEventListener("click", toggleAccessVisibility);
themeToggle.addEventListener("click", toggleTheme);
copyOutputBtn.addEventListener("click", copyDeparsedContent);
loadMoreBtn.addEventListener("click", renderTokensBatch);
accessPhraseInput.addEventListener("input", updateAccessStrength);
searchInput.addEventListener("input", handleSearch);
categoryFilter.addEventListener("change", handleSearch);
inactivityTimeoutInput.addEventListener("input", updateInactivityTimeout);
exportTextBtn.addEventListener("click", exportText);
exportBundleBtn.addEventListener("click", exportBundle);
importBundleInput.addEventListener("change", importBundle);
parseUploadBtn.addEventListener("click", parseAndUpload);
outputEl.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("keydown", registerShortcuts);

["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

window.addEventListener("beforeunload", (event) => {
  if (hasDeparsedContent) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (broadcast) {
  broadcast.onmessage = (event) => {
    if (event.data?.type === "content-updated" && hasDeparsedContent && event.data.file !== currentFilePath) {
      clearDeparsedContent("Another tab de-parsed content. Cleared for safety.");
    }
  };
}

updateAccessStrength();
updateInactivityTimeout();
loadSamples();
