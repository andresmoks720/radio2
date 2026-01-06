const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const passwordInput = document.getElementById("password");
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
const repoSpinner = document.getElementById("repo-spinner");
const passphraseToggle = document.getElementById("toggle-passphrase");
const themeToggle = document.getElementById("theme-toggle");
const copyOutputBtn = document.getElementById("copy-output");
const copyStatus = document.getElementById("copy-status");
const loadMoreBtn = document.getElementById("load-more");
const passphraseStrength = document.getElementById("passphrase-strength");
const passphraseFeedback = document.getElementById("passphrase-feedback");
const searchInput = document.getElementById("search-input");
const categoryFilter = document.getElementById("category-filter");
const exportTextBtn = document.getElementById("export-text");
const exportBundleBtn = document.getElementById("export-bundle");
const importBundleInput = document.getElementById("import-bundle");
const perfIndicator = document.getElementById("perf-indicator");
const historyList = document.getElementById("history-list");
const toast = document.getElementById("toast");
const previewMeta = document.getElementById("preview-meta");
const encryptTitleInput = document.getElementById("encrypt-title");
const encryptContentInput = document.getElementById("encrypt-content");
const encryptUploadBtn = document.getElementById("encrypt-upload");
const encryptFileInput = document.getElementById("encrypt-file");
const encryptMessageInput = document.getElementById("encrypt-message");

const MANIFEST_URL = "docs/manifest.json";
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 100000;
const INACTIVITY_LIMIT = 5 * 60 * 1000;
const TOKEN_BATCH_SIZE = 80;
const LIBRARIES = {
  marked: "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
  dompurify: "https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js",
  highlight: "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js",
  highlightCss:
    "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css",
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const decryptedCache = new Map();
const encryptedCache = new Map();
const passphraseStore = new Map();
const historyStore = new Map();

let hasDecryptedContent = false;
let inactivityTimer = null;
let currentMarkdown = "";
let currentFilePath = "";
let pendingTokens = [];
let allRepoEntries = [];
let bundleEntries = [];
let librariesLoaded = false;
const broadcast = "BroadcastChannel" in window ? new BroadcastChannel("encrypted-md") : null;

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
  const match = window.location.hash.match(/token=([^&]+)/);
  if (match) {
    const token = decodeURIComponent(match[1]);
    repoTokenInput.value = token;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return token;
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
  hasDecryptedContent = Boolean(markdown.trim());
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

async function deriveKey(password, salt, usages) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

async function encryptMarkdown(markdown, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(markdown)
  );

  const payload = {
    version: FORMAT_VERSION,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
  };

  salt.fill(0);
  iv.fill(0);
  return payload;
}

async function decryptPayload(payload, password) {
  if (payload.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported format version: ${payload.version}`);
  }
  const salt = parseBase64(payload.salt);
  const iv = parseBase64(payload.iv);
  const ciphertext = parseBase64(payload.ciphertext);

  const key = await deriveKey(password, salt, ["decrypt"]);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  const plaintextBytes = new Uint8Array(plaintextBuffer);
  const plaintext = textDecoder.decode(plaintextBytes);
  salt.fill(0);
  iv.fill(0);
  ciphertext.fill(0);
  plaintextBytes.fill(0);
  return plaintext;
}

function isMarkdownFile(name) {
  return name.endsWith(".md") || name.endsWith(".md.enc");
}

function isEncryptedFile(name) {
  return name.endsWith(".md.enc");
}

function clearRepoFileList() {
  repoFileList.innerHTML = "";
}

function updatePreview(file) {
  if (!file) {
    previewMeta.textContent = "Select a file to preview.";
    return;
  }
  const status = file.encrypted ? "Encrypted" : "Plain";
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
  if (decryptedCache.has(file.path)) {
    statusIcon.textContent = "✅";
  } else if (file.encrypted) {
    statusIcon.textContent = "🔒";
  } else {
    statusIcon.textContent = "📄";
  }

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
    const cached = decryptedCache.get(entry.path);
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
  const response = await fetchWithRetry(apiUrl, { headers: buildAuthHeaders() });
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
        encrypted: isEncryptedFile(entry.name),
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
      });
      if (!fallback.ok) {
        throw new Error(await getGitHubError(fallback));
      }
      return fallback;
    }
    throw new Error(await getGitHubError(response));
  }
  const response = await fetchWithRetry(rawGitHubUrl(owner, repo, branch, path));
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

function getPassphraseForFile(path, provided) {
  if (provided) {
    passphraseStore.set(path, provided);
    return provided;
  }
  return passphraseStore.get(path) || "";
}

async function handleRepoFileLoad(file) {
  const owner = repoOwnerInput.value.trim();
  const repo = repoNameInput.value.trim();
  const branch = repoBranchInput.value.trim() || "main";
  const password = passwordInput.value.trim();
  const token = getAuthToken();

  if (file.source !== "bundle" && (!owner || !repo)) {
    setStatus("Enter a GitHub owner and repository name.", true);
    return;
  }
  if (file.source !== "bundle" && !navigator.onLine) {
    setStatus("Offline mode: unable to fetch file from GitHub.", true);
    return;
  }

  if (file.encrypted && !getPassphraseForFile(file.path, password)) {
    setStatus("Enter a passphrase before decrypting encrypted files.", true);
    return;
  }

  if (decryptedCache.has(file.path)) {
    currentFilePath = file.path;
    await renderMarkdown(decryptedCache.get(file.path));
    setStatus("Loaded cached decrypted content.", false, true);
    setOutputState("success");
    updateHistory(file.path, decryptedCache.get(file.path));
    renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
    return;
  }

  setStatus("Loading file from GitHub...");
  setOutputState("");
  try {
    let markdown = "";
    if (file.source === "bundle") {
      const payload = encryptedCache.get(file.path);
      if (!payload) {
        throw new Error(`Missing bundle payload for ${file.path}.`);
      }
      markdown = await decryptPayload(payload, getPassphraseForFile(file.path, password));
    } else {
      const response = await fetchRawFile(owner, repo, branch, file.path, token);
      if (file.encrypted) {
        const payload = await response.json();
        encryptedCache.set(file.path, payload);
        markdown = await decryptPayload(payload, getPassphraseForFile(file.path, password));
      } else {
        markdown = await response.text();
      }
    }
    decryptedCache.set(file.path, markdown);
    currentFilePath = file.path;
    await renderMarkdown(markdown);
    setStatus("File loaded successfully.", false, true);
    setOutputState("success");
    updateHistory(file.path, markdown);
    renderFileGroups(getFilteredEntries([...allRepoEntries, ...bundleEntries]));
    updatePreview(file);
    if (broadcast) {
      broadcast.postMessage({ type: "decrypted", file: file.path });
    }
    markdown = "";
  } catch (error) {
    setStatus(`Failed to load file: ${error.message}`, true);
    setOutputState("error");
  }
}

async function loadSamples() {
  try {
    const response = await fetch(MANIFEST_URL);
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
  const password = passwordInput.value.trim();

  if (!path) {
    setStatus("Please choose a sample file.", true);
    return;
  }

  if (!password) {
    setStatus("Enter a passphrase before decrypting.", true);
    return;
  }

  setStatus("Decrypting sample...");
  setOutputState("");

  try {
    const response = await fetch(path);
    const payload = await response.json();
    encryptedCache.set(path, payload);
    let markdown = await decryptPayload(payload, getPassphraseForFile(path, password));
    decryptedCache.set(path, markdown);
    currentFilePath = path;
    await renderMarkdown(markdown);
    setStatus("Sample decrypted successfully.", false, true);
    setOutputState("success");
    updateHistory(path, markdown);
    updatePreview({ name: path.split("/").pop(), path, encrypted: true, size: JSON.stringify(payload).length });
    if (broadcast) {
      broadcast.postMessage({ type: "decrypted", file: path });
    }
    markdown = "";
  } catch (error) {
    setStatus(`Failed to decrypt sample: ${error.message}`, true);
    setOutputState("error");
  }
}

async function handleFileLoad() {
  const file = fileInput.files[0];
  const password = passwordInput.value.trim();

  if (!file) {
    setStatus("Choose a local encrypted file first.", true);
    return;
  }

  if (!password) {
    setStatus("Enter a passphrase before decrypting.", true);
    return;
  }

  setStatus("Decrypting local file...");
  setOutputState("");

  try {
    const contents = await file.text();
    const payload = JSON.parse(contents);
    encryptedCache.set(file.name, payload);
    let markdown = await decryptPayload(payload, getPassphraseForFile(file.name, password));
    decryptedCache.set(file.name, markdown);
    currentFilePath = file.name;
    await renderMarkdown(markdown);
    setStatus("Local file decrypted successfully.", false, true);
    setOutputState("success");
    updateHistory(file.name, markdown);
    updatePreview({ name: file.name, path: file.name, encrypted: true, size: file.size });
    if (broadcast) {
      broadcast.postMessage({ type: "decrypted", file: file.name });
    }
    markdown = "";
  } catch (error) {
    setStatus(`Failed to decrypt file: ${error.message}`, true);
    setOutputState("error");
  }
}

function clearDecryptedContent(reason) {
  outputEl.innerHTML = "";
  currentMarkdown = "";
  currentFilePath = "";
  hasDecryptedContent = false;
  decryptedCache.clear();
  encryptedCache.clear();
  passphraseStore.clear();
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
    if (hasDecryptedContent) {
      clearDecryptedContent("Decrypted content cleared after inactivity.");
    }
  }, INACTIVITY_LIMIT);
}

function evaluatePassphraseStrength(passphrase) {
  let score = 0;
  if (passphrase.length >= 8) score += 1;
  if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) score += 1;
  if (/\d/.test(passphrase)) score += 1;
  if (/[^A-Za-z0-9]/.test(passphrase)) score += 1;
  return score;
}

function updatePassphraseStrength() {
  const passphrase = passwordInput.value;
  const score = evaluatePassphraseStrength(passphrase);
  passphraseStrength.value = score;
  const feedback = ["Enter a passphrase", "Weak", "Fair", "Good", "Strong"];
  passphraseFeedback.textContent = feedback[score] || "Strong";
}

function togglePassphraseVisibility() {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  passphraseToggle.textContent = isHidden ? "Hide" : "Show";
  passphraseToggle.setAttribute("aria-pressed", String(isHidden));
}

function toggleTheme() {
  const root = document.documentElement;
  const isLight = root.dataset.theme === "light";
  root.dataset.theme = isLight ? "dark" : "light";
  themeToggle.textContent = isLight ? "Switch to light" : "Switch to dark";
  themeToggle.setAttribute("aria-pressed", String(!isLight));
}

async function copyDecryptedContent() {
  if (!currentMarkdown.trim()) {
    copyStatus.textContent = "Nothing to copy yet.";
    return;
  }
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    copyStatus.textContent = "Decrypted content copied.";
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
  link.download = `${currentFilePath || "decrypted"}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportBundle() {
  const files = [];
  encryptedCache.forEach((payload, path) => {
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
  link.download = "encrypted-bundle.json";
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
      encrypted: true,
      category: "Imported Bundle",
      source: "bundle",
      size: JSON.stringify(entry.payload).length,
    }));
    bundle.files.forEach((entry) => {
      encryptedCache.set(entry.path, entry.payload);
    });
    const combined = [...allRepoEntries, ...bundleEntries];
    updateCategoryOptions(combined);
    renderFileGroups(getFilteredEntries(combined));
    setStatus("Bundle imported.", false, true);
  } catch (error) {
    setStatus(`Failed to import bundle: ${error.message}`, true);
  }
}

async function encryptAndUpload() {
  const owner = repoOwnerInput.value.trim();
  const repo = repoNameInput.value.trim();
  const branch = repoBranchInput.value.trim() || "main";
  const targetPath = encryptTitleInput.value.trim();
  const password = passwordInput.value.trim();
  const token = getAuthToken();
  const commitMessage = encryptMessageInput.value.trim();

  if (!owner || !repo || !targetPath) {
    setStatus("Provide owner, repo, and target path.", true);
    return;
  }
  if (!targetPath.endsWith(".md.enc")) {
    setStatus("Upload path must end with .md.enc", true);
    return;
  }
  if (!password) {
    setStatus("Provide passphrase and markdown content.", true);
    return;
  }
  if (!token) {
    setStatus("GitHub token required to upload encrypted files.", true);
    return;
  }

  setStatus("Encrypting and uploading to GitHub...");
  try {
    let markdown = encryptContentInput.value.trim();
    if (encryptFileInput.files.length > 0) {
      markdown = await encryptFileInput.files[0].text();
    }
    if (!markdown) {
      setStatus("Provide passphrase and markdown content.", true);
      return;
    }
    const payload = await encryptMarkdown(markdown, password);
    const body = {
      message: commitMessage || `Add encrypted file ${targetPath}`,
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
      }
    );
    if (!response.ok) {
      throw new Error(await getGitHubError(response));
    }
    setStatus("Encrypted file uploaded.", false, true);
    encryptContentInput.value = "";
    encryptTitleInput.value = "";
    encryptMessageInput.value = "";
    encryptFileInput.value = "";
  } catch (error) {
    setStatus(`Upload failed: ${error.message}`, true);
  }
}

function handleSearch() {
  const combined = [...allRepoEntries, ...bundleEntries];
  renderFileGroups(getFilteredEntries(combined));
}

function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js");
  }
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
    togglePassphraseVisibility();
    event.preventDefault();
  }
  if (event.key === "t") {
    toggleTheme();
    event.preventDefault();
  }
  if (event.key === "c") {
    copyDecryptedContent();
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
passphraseToggle.addEventListener("click", togglePassphraseVisibility);
themeToggle.addEventListener("click", toggleTheme);
copyOutputBtn.addEventListener("click", copyDecryptedContent);
loadMoreBtn.addEventListener("click", renderTokensBatch);
passwordInput.addEventListener("input", updatePassphraseStrength);
searchInput.addEventListener("input", handleSearch);
categoryFilter.addEventListener("change", handleSearch);
exportTextBtn.addEventListener("click", exportText);
exportBundleBtn.addEventListener("click", exportBundle);
importBundleInput.addEventListener("change", importBundle);
encryptUploadBtn.addEventListener("click", encryptAndUpload);
outputEl.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("keydown", registerShortcuts);

["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

window.addEventListener("beforeunload", (event) => {
  if (hasDecryptedContent) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (broadcast) {
  broadcast.onmessage = (event) => {
    if (event.data?.type === "decrypted" && hasDecryptedContent && event.data.file !== currentFilePath) {
      clearDecryptedContent("Another tab decrypted content. Cleared for safety.");
    }
  };
}

updatePassphraseStrength();
resetInactivityTimer();
setupServiceWorker();
loadSamples();
