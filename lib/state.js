export function createSessionState() {
  let phase = "idle";
  let activePayload = null;
  let chunkDecoder = null;
  let chunkCursor = 0;
  let currentFilePath = "";
  let hasDeparsedContent = false;

  return {
    get phase() {
      return phase;
    },
    get activePayload() {
      return activePayload;
    },
    get chunkDecoder() {
      return chunkDecoder;
    },
    get chunkCursor() {
      return chunkCursor;
    },
    get currentFilePath() {
      return currentFilePath;
    },
    get hasDeparsedContent() {
      return hasDeparsedContent;
    },
    setActivePayload(payload) {
      activePayload = payload;
      phase = payload ? "ready" : "idle";
    },
    setChunkDecoder(decoder) {
      chunkDecoder = decoder;
    },
    setChunkCursor(value) {
      chunkCursor = value;
    },
    advanceChunkCursor() {
      chunkCursor += 1;
      return chunkCursor;
    },
    setCurrentFilePath(path) {
      currentFilePath = path || "";
    },
    setHasDeparsedContent(flag) {
      hasDeparsedContent = flag;
      if (!flag && phase !== "loading") {
        phase = "idle";
      }
    },
    markLoading() {
      phase = "loading";
    },
    resetChunkState() {
      activePayload = null;
      chunkDecoder = null;
      chunkCursor = 0;
      if (phase !== "loading") {
        phase = "idle";
      }
    },
    clearAll() {
      activePayload = null;
      chunkDecoder = null;
      chunkCursor = 0;
      currentFilePath = "";
      hasDeparsedContent = false;
      phase = "idle";
    },
  };
}
