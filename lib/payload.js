/*
Data lifetime:
- Raw text: none.
- Disk: none.
- Network: none.
*/
export function assertPayloadFormat(payload, version) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload.");
  }
  if (typeof payload.version !== "number") {
    throw new Error("Payload has invalid version.");
  }
  if (payload.version !== version) {
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
