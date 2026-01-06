export function splitMarkdownIntoChunks(markdown, targetSize) {
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

export function buildSearchPreview(text, matchIndex, queryLength) {
  const radius = 48;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + queryLength + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${prefix}${snippet}${suffix}`;
}

export function filterEntries(entries, query) {
  if (!query) {
    return entries;
  }
  const lower = query.toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase().includes(lower));
}

export function filterByCategory(entries, category) {
  if (!category) {
    return entries;
  }
  return entries.filter((entry) => entry.category === category);
}

export function normalizeRepoPath(path) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "docs";
  }
  return trimmed.replace(/^\/+|\/+$/g, "");
}

export function ensurePayloadExtension(path, dataExtension) {
  if (!path) {
    return "";
  }
  return path.endsWith(dataExtension) ? path : `${path}${dataExtension}`;
}
