/*
Data lifetime:
- Raw text: selection text only while copying or creating output.
- Disk: output file only when user downloads.
- Network: none.
*/
export function createTextExportService({ win = window, navigatorRef = navigator, decoderFactory }) {
  const fallbackExecCommandCopy = async (text) => {
    const ta = win.document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    win.document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);

    let ok = false;
    try {
      ok = win.document.execCommand("copy");
    } catch (error) {
      ok = false;
    } finally {
      ta.value = "";
      ta.remove();
    }
    return ok;
  };

  const isClipboardContextAllowed = () => {
    const { protocol, hostname } = win.location;
    return (
      protocol === "https:" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  };

  const tryClipboardWrite = async (text) => {
    if (!isClipboardContextAllowed() || !navigatorRef.clipboard?.writeText) {
      return { ok: false, reason: "unavailable" };
    }
    try {
      await navigatorRef.clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.name || "error" };
    }
  };

  const copySelection = async ({ selectionText }) => {
    const trimmed = selectionText || "";
    if (!trimmed) {
      return { ok: false, reason: "empty", method: "none" };
    }
    const result = await tryClipboardWrite(trimmed);
    if (result.ok) {
      return { ok: true, method: "clipboard" };
    }
    const ok = await fallbackExecCommandCopy(trimmed);
    if (ok) {
      return { ok: true, method: "fallback", reason: result.reason };
    }
    return { ok: false, reason: result.reason || "error", method: "fallback" };
  };

  const createPlaintextStream = async ({ payload, accessPhrase, onProgress }) => {
    const decodeChunk = await decoderFactory({ payload, accessPhrase });
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
          resultBytes = await decodeChunk(entry, index);
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
  };

  const buildBlob = async ({ payload, accessPhrase, onProgress }) => {
    const stream = await createPlaintextStream({ payload, accessPhrase, onProgress });
    const response = new Response(stream);
    return response.blob();
  };

  const exportFile = async ({ payload, accessPhrase, outputName }) => {
    const blob = await buildBlob({ payload, accessPhrase });
    const link = win.document.createElement("a");
    link.href = win.URL.createObjectURL(blob);
    link.download = outputName;
    link.click();
    win.URL.revokeObjectURL(link.href);
  };

  const exportBundle = ({ files, version }) => {
    const bundle = {
      version,
      generatedAt: new Date().toISOString(),
      files,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const link = win.document.createElement("a");
    link.href = win.URL.createObjectURL(blob);
    link.download = "export.json";
    link.click();
    win.URL.revokeObjectURL(link.href);
  };

  return {
    copySelection,
    exportFile,
    exportBundle,
  };
}
