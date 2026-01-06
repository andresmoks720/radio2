export function buildAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchWithRetry(url, options = {}, retries = 2, onRateLimit) {
  const response = await fetch(url, options);
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0" && retries > 0) {
    const reset = Number(response.headers.get("x-ratelimit-reset") || 0) * 1000;
    const wait = Math.max(reset - Date.now(), 1000);
    if (onRateLimit) {
      onRateLimit(wait);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    return fetchWithRetry(url, options, retries - 1, onRateLimit);
  }
  return response;
}

export async function fetchGitHubWithRetry(url, options = {}, { retries = 2, onRateLimit } = {}) {
  return fetchWithRetry(url, options, retries, onRateLimit);
}

export async function getGitHubError(response) {
  let detail = "";
  try {
    const data = await response.json();
    detail = data.message || "";
  } catch (error) {
    detail = "";
  }
  return `GitHub error (${response.status}) ${detail}`.trim();
}

export function rawGitHubUrl(owner, repo, branch, path) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

export async function fetchRepoEntries({
  owner,
  repo,
  branch,
  path,
  rootPath = path,
  authHeaders,
  dataExtension,
  onRateLimit,
}) {
  const pathSegment = path ? `/${path}` : "";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${pathSegment}?ref=${branch}`;
  const response = await fetchGitHubWithRetry(
    apiUrl,
    {
      headers: authHeaders,
      cache: "no-store",
    },
    { retries: 2, onRateLimit }
  );
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
      const nested = await fetchRepoEntries({
        owner,
        repo,
        branch,
        path: entry.path,
        rootPath,
        authHeaders,
        dataExtension,
        onRateLimit,
      });
      files.push(...nested);
    } else if (entry.type === "file" && entry.name.endsWith(dataExtension)) {
      const normalizedRoot = rootPath ? rootPath.replace(/\/+$/g, "") : "";
      const prefix = normalizedRoot ? `${normalizedRoot}/` : "";
      const relative = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path;
      const category = relative.split("/").slice(0, -1).join("/");
      files.push({
        name: entry.name,
        path: entry.path,
        isParsed: true,
        category: category || "Root",
        source: "repo",
        size: entry.size,
      });
    }
  }
  return files;
}

export async function fetchRawFile({ owner, repo, branch, path, token, authHeaders, onRateLimit }) {
  if (token) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const response = await fetchGitHubWithRetry(
      apiUrl,
      {
        headers: {
          ...authHeaders,
          Accept: "application/vnd.github.raw",
        },
        cache: "no-store",
      },
      { retries: 2, onRateLimit }
    );
    if (response.ok) {
      return response;
    }
    if (response.status === 401 || response.status === 403) {
      const fallback = await fetchGitHubWithRetry(
        apiUrl,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.raw",
          },
          cache: "no-store",
        },
        { retries: 2, onRateLimit }
      );
      if (!fallback.ok) {
        throw new Error(await getGitHubError(fallback));
      }
      return fallback;
    }
    throw new Error(await getGitHubError(response));
  }
  const response = await fetchGitHubWithRetry(
    rawGitHubUrl(owner, repo, branch, path),
    { cache: "no-store" },
    { retries: 2, onRateLimit }
  );
  if (!response.ok) {
    throw new Error(await getGitHubError(response));
  }
  return response;
}
