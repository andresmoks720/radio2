const assert = require("node:assert/strict");
const test = require("node:test");

if (!globalThis.atob) {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
}
if (!globalThis.btoa) {
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

if (!globalThis.crypto?.subtle) {
  globalThis.crypto = require("node:crypto").webcrypto;
}

if (!globalThis.window) {
  globalThis.window = globalThis;
}

require("../lib/codec.js");

const {
  encodePayload,
  decodePayload,
  encodePayloadChunks,
  decodePayloadChunks,
  createChunkDecoder,
} = globalThis.payloadCodec;

const textDecoder = new TextDecoder();

test("roundtrip encode/decode for single payload", async () => {
  const content = "Sample content for a roundtrip check.";
  const accessPhrase = "test-passphrase";
  const payload = await encodePayload(content, accessPhrase, 1);
  const result = await decodePayload(payload, accessPhrase, 1);
  assert.equal(result, content);
});

test("roundtrip encode/decode for chunked payload", async () => {
  const accessPhrase = "test-passphrase";
  const chunks = ["a", " short ", "chunked", " payload", " sample"];
  const payload = await encodePayloadChunks(chunks, accessPhrase, 2);
  const parts = [];

  await decodePayloadChunks(payload, accessPhrase, 2, async (bytes) => {
    parts.push(textDecoder.decode(bytes));
  });

  assert.equal(parts.join(""), chunks.join(""));
});

test("chunk decoder handles small chunks", async () => {
  const accessPhrase = "test-passphrase";
  const chunks = ["x", "y", "z"];
  const payload = await encodePayloadChunks(chunks, accessPhrase, 2);
  const decodeChunk = await createChunkDecoder(payload, accessPhrase, 2);

  for (const [index, entry] of payload.chunks.entries()) {
    const bytes = await decodeChunk(entry, index);
    assert.equal(textDecoder.decode(bytes), chunks[index]);
    bytes.fill(0);
  }
});
