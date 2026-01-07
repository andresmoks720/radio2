import { assertPayloadFormat } from "./payload.js";

/*
Data lifetime:
- Raw text: none; operates on byte chunks only.
- Disk: none.
- Network: none.
*/
export async function createChunkService({ payload, accessPhrase, version, payloadCodec }) {
  if (!payloadCodec?.createChunkDecoder) {
    throw new Error("Decoding module unavailable.");
  }
  assertPayloadFormat(payload, version);
  const decodeChunk = await payloadCodec.createChunkDecoder(payload, accessPhrase, version);

  const decodeAll = async ({ onChunk, onProgress, shouldAbort } = {}) => {
    if (!payloadCodec?.decodePayloadChunks) {
      throw new Error("Decoding module unavailable.");
    }
    await payloadCodec.decodePayloadChunks(payload, accessPhrase, version, async (bytes, index, total) => {
      if (shouldAbort && shouldAbort()) {
        return;
      }
      await onChunk(bytes, index, total);
      if (onProgress) {
        onProgress(index + 1, total);
      }
    });
  };

  return {
    decodeChunk,
    decodeAll,
  };
}
