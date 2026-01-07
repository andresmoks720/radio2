import { buildAuthHeaders, fetchGitHubWithRetry, getGitHubError } from "./data.js";
import { ensurePayloadExtension, splitMarkdownIntoChunks } from "./helpers.js";

/*
Data lifetime:
- Raw text: input text while building payload.
- Disk: optional user download, no storage.
- Network: GitHub upload when requested.
*/
export function createParseController({
  ui,
  elements,
  status,
  getAuthToken,
  getAccessPhrase,
  dataExtension,
  formatVersion,
  chunkTarget,
  payloadCodec,
  onRateLimit,
}) {
  const encodeContent = async (markdown, accessPhrase) => {
    if (!payloadCodec.encodePayloadChunks) {
      throw new Error("Encoding module unavailable.");
    }
    const chunks = splitMarkdownIntoChunks(markdown, chunkTarget);
    return payloadCodec.encodePayloadChunks(chunks, accessPhrase, formatVersion);
  };

  const collectParseSource = async () => {
    let markdown = elements.parseContentInput.value.trim();
    if (elements.parseFileInput.files.length > 0) {
      markdown = await elements.parseFileInput.files[0].text();
    }
    if (!markdown) {
      status.setGlobalStatus("accessRequiredParse");
      return "";
    }
    return markdown;
  };

  const buildPayloadFromInput = async (markdown, accessPhrase) => {
    const payload = await encodeContent(markdown, accessPhrase);
    elements.parseContentInput.value = "";
    elements.parseFileInput.value = "";
    markdown = "";
    return payload;
  };

  const parseAndUpload = async () => {
    const owner = elements.repoOwnerInput.value.trim();
    const repo = elements.repoNameInput.value.trim();
    const branch = elements.repoBranchInput.value.trim() || "main";
    const targetPath = ensurePayloadExtension(elements.parseTitleInput.value.trim(), dataExtension);
    const accessPhrase = getAccessPhrase();
    const token = getAuthToken();
    const commitMessage = elements.parseMessageInput.value.trim();
    const authHeaders = buildAuthHeaders(token);

    if (!owner || !repo || !targetPath) {
      status.setGlobalStatus("repoUploadMissingInfo");
      return;
    }
    if (!accessPhrase) {
      status.setGlobalStatus("accessRequiredParse");
      return;
    }
    if (!token) {
      status.setGlobalStatus("repoUploadNeedsToken");
      return;
    }

    status.setGlobalStatus("parseUploadStart");
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
      status.setGlobalStatus("parseUploadSuccess");
      elements.parseTitleInput.value = "";
      elements.parseMessageInput.value = "";
    } catch (error) {
      status.setGlobalStatus("parseUploadFailed", { detail: error.message });
    }
  };

  const triggerDownload = (blob, filename) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const parseAndSave = async () => {
    const targetPath = ensurePayloadExtension(elements.parseTitleInput.value.trim() || "local.md.data", dataExtension);
    const accessPhrase = getAccessPhrase();

    if (!accessPhrase) {
      status.setGlobalStatus("accessRequiredParse");
      return;
    }

    status.setGlobalStatus("parseLocalStart");
    try {
      const markdown = await collectParseSource();
      if (!markdown) {
        return;
      }
      const payload = await buildPayloadFromInput(markdown, accessPhrase);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      triggerDownload(blob, targetPath);
      status.setGlobalStatus("parseLocalReady");
    } catch (error) {
      status.setGlobalStatus("parseLocalFailed", { detail: error.message });
    }
  };

  return {
    parseAndUpload,
    parseAndSave,
  };
}
