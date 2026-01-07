import { fetchGitHubWithRetry, getGitHubError, rawGitHubUrl } from "./data.js";

/*
Data lifetime:
- Raw text: none (metadata and response streams only).
- Disk: none.
- Network: GitHub API and raw file fetch on demand.
*/
export function createRepoClient({ owner, repo, branch, authHeaders, onRateLimit }) {
  const listEntries = async ({ path, dataExtension }) => {
    const files = [];
    const queue = [path || ""];
    const normalizedRoot = path ? path.replace(/\/+$/g, "") : "";
    const prefix = normalizedRoot ? `${normalizedRoot}/` : "";

    while (queue.length > 0) {
      const current = queue.shift();
      const pathSegment = current ? `/${current}` : "";
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
        return { ok: false, error: await getGitHubError(response) };
      }
      const entries = await response.json();
      if (!Array.isArray(entries)) {
        return { ok: false, error: "Unexpected GitHub response format." };
      }
      for (const entry of entries) {
        if (entry.type === "dir") {
          queue.push(entry.path);
        } else if (entry.type === "file" && entry.name.endsWith(dataExtension)) {
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
    }

    return { ok: true, data: files };
  };

  const fetchRawFile = async ({ path, token }) => {
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
        return { ok: true, data: response };
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
          return { ok: false, error: await getGitHubError(fallback) };
        }
        return { ok: true, data: fallback };
      }
      return { ok: false, error: await getGitHubError(response) };
    }

    const response = await fetchGitHubWithRetry(
      rawGitHubUrl(owner, repo, branch, path),
      { cache: "no-store" },
      { retries: 2, onRateLimit }
    );
    if (!response.ok) {
      return { ok: false, error: await getGitHubError(response) };
    }
    return { ok: true, data: response };
  };

  return {
    listEntries,
    fetchRawFile,
  };
}
