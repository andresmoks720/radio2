import { createChunkService } from "./chunkService.js";
import { descrambleToString, scrambleBytes, scrubChunk } from "./memoryGuard.js";

/*
Data lifetime:
- Raw text: chunk text exists only during render passes.
- Disk: none.
- Network: none.
*/
export function createRenderer({
  ui,
  elements,
  sessionState,
  status,
  payloadCodec,
  config,
  onActivity,
  deps = {},
}) {
  const { MARKDOWN_CHUNK_TARGET, AUTO_LOAD_ROOT_MARGIN, AUTO_LOAD_THRESHOLD_PX, SHOW_PERF_METRICS, LIBRARIES } =
    config;
  const chunkTextDecoder = new TextDecoder();
  let librariesLoaded = false;
  let chunkLock = false;
  let autoLoadObserver = null;
  let autoLoadScheduled = false;
  let autoLoadFallbackBound = false;

  const win = deps.win || window;
  const loadScript =
    deps.loadScript ||
    ((src) =>
      new Promise((resolve, reject) => {
        const script = win.document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        win.document.head.appendChild(script);
      }));
  const loadStylesheet =
    deps.loadStylesheet ||
    ((href) =>
      new Promise((resolve, reject) => {
        const link = win.document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        win.document.head.appendChild(link);
      }));

  const escapeHtml = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const renderMarkdownFallback = (markdown) => {
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
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      htmlLines.push(`<p>${withInline}</p>`);
    }
    return htmlLines.join("\n");
  };

  const sanitizeHtml = (html) => {
    if (win.DOMPurify) {
      return win.DOMPurify.sanitize(html);
    }
    return escapeHtml(html);
  };

  const ensureLibrariesLoaded = async () => {
    if (librariesLoaded) {
      return;
    }
    await Promise.all([
      loadScript(LIBRARIES.marked),
      loadScript(LIBRARIES.dompurify),
      loadScript(LIBRARIES.highlight),
      loadStylesheet(LIBRARIES.highlightCss),
    ]);
    if (win.marked && win.hljs) {
      win.marked.setOptions({
        highlight(code, language) {
          if (language && win.hljs.getLanguage(language)) {
            return win.hljs.highlight(code, { language }).value;
          }
          return win.hljs.highlightAuto(code).value;
        },
      });
    }
    librariesLoaded = true;
  };

  const resetChunkRenderState = () => {
    sessionState.resetChunkState();
  };

  const appendMarkdownChunk = async (markdown) => {
    const html = win.marked ? win.marked.parse(markdown) : renderMarkdownFallback(markdown);
    const sanitized = sanitizeHtml(html);
    const fragment = win.document.createElement("div");
    fragment.innerHTML = sanitized;
    fragment.querySelectorAll("pre code").forEach((block) => {
      if (win.hljs) {
        win.hljs.highlightElement(block);
      }
    });
    elements.outputEl.append(...fragment.childNodes);
  };

  const decodeChunk = async (chunkEntry, index) => {
    const chunkDecoder = sessionState.chunkDecoder;
    if (!chunkDecoder) {
      throw new Error("Decoding module unavailable.");
    }
    const decodedBytes = await chunkDecoder(chunkEntry, index);
    return scrambleBytes(decodedBytes);
  };

  const renderChunk = async (scrambledChunk) => {
    const markdown = descrambleToString(scrambledChunk, chunkTextDecoder);
    try {
      await appendMarkdownChunk(markdown);
    } finally {
      return markdown;
    }
  };

  const finalizeChunkRender = (scrambledChunk, markdown) => {
    scrubChunk(scrambledChunk);
    if (markdown) {
      markdown = "";
    }
  };

  const updateChunkUi = (activePayload) => {
    elements.loadMoreBtn.hidden = sessionState.chunkCursor >= activePayload.chunks.length;
    if (!elements.loadMoreBtn.hidden) {
      status.setGlobalStatus("loadMoreHint");
    }
    updateAutoLoadObserver();
  };

  const acquireChunkLock = () => {
    if (chunkLock) {
      return false;
    }
    chunkLock = true;
    return true;
  };

  const releaseChunkLock = () => {
    chunkLock = false;
  };

  const renderNextChunk = async () => {
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

    if (onActivity) {
      onActivity();
    }
    const chunkEntry = activePayload.chunks[sessionState.chunkCursor];
    sessionState.advanceChunkCursor();

    const start = SHOW_PERF_METRICS ? performance.now() : 0;
    let scrambled = null;
    let markdown = "";
    try {
      scrambled = await decodeChunk(chunkEntry, sessionState.chunkCursor - 1);
      markdown = await renderChunk(scrambled);
    } catch (error) {
      status.setGlobalStatus("chunkRenderFailed", { detail: error.message });
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
  };

  const autoLoadNextChunkIfNeeded = () => {
    const activePayload = sessionState.activePayload;
    if (!activePayload || !sessionState.chunkDecoder || chunkLock || sessionState.chunkCursor >= activePayload.chunks.length) {
      return;
    }
    const scrollPosition = win.scrollY + win.innerHeight;
    const maxScroll = win.document.documentElement.scrollHeight - AUTO_LOAD_THRESHOLD_PX;
    if (scrollPosition >= maxScroll) {
      renderNextChunk();
    }
  };

  const scheduleAutoLoad = () => {
    if (autoLoadScheduled) {
      return;
    }
    autoLoadScheduled = true;
    win.requestAnimationFrame(() => {
      autoLoadScheduled = false;
      autoLoadNextChunkIfNeeded();
    });
  };

  const updateAutoLoadObserver = () => {
    if (!("IntersectionObserver" in win)) {
      if (!autoLoadFallbackBound) {
        win.addEventListener("scroll", scheduleAutoLoad, { passive: true });
        win.addEventListener("resize", scheduleAutoLoad);
        autoLoadFallbackBound = true;
      }
      scheduleAutoLoad();
      return;
    }
    if (!autoLoadObserver) {
      autoLoadObserver = new win.IntersectionObserver(
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
  };

  const renderMarkdown = async (payload, accessPhrase) => {
    status.clearCopyStatus();
    ui.clearElement(elements.outputEl);
    ui.clearSearchResults();
    status.clearSearchStatus();
    elements.loadMoreBtn.hidden = true;
    if (onActivity) {
      onActivity();
    }

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
      const chunkService = await createChunkService({
        payload,
        accessPhrase,
        version: config.FORMAT_VERSION,
        payloadCodec,
      });
      sessionState.setChunkDecoder(chunkService.decodeChunk);
      await renderNextChunk();
    } catch (error) {
      status.setGlobalStatus("renderFailed", { detail: error.message });
      resetChunkRenderState();
    }
  };

  const renderChunkAtIndex = async (index, accessPhrase) => {
    if (!sessionState.activePayload) {
      status.setGlobalStatus("searchLoadRequired");
      return;
    }
    status.setGlobalStatus("searchResultLoading");
    try {
      await ensureLibrariesLoaded();
      const chunkService = await createChunkService({
        payload: sessionState.activePayload,
        accessPhrase,
        version: config.FORMAT_VERSION,
        payloadCodec,
      });
      sessionState.setChunkDecoder(chunkService.decodeChunk);
      sessionState.setChunkCursor(Math.max(0, Math.min(index, sessionState.activePayload.chunks.length - 1)));
      ui.clearElement(elements.outputEl);
      await renderNextChunk();
      status.setGlobalStatus("searchResultLoaded");
    } catch (error) {
      status.setGlobalStatus("searchFailed", { detail: error.message });
    }
  };

  return {
    MARKDOWN_CHUNK_TARGET,
    renderMarkdown,
    renderNextChunk,
    renderChunkAtIndex,
    resetChunkRenderState,
    updateAutoLoadObserver,
  };
}
