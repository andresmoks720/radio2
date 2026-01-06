(() => {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const derivationRounds = 100000;
  const algorithmLabels = {
    derivation: "PBKDF2",
    cipher: "AES-GCM",
    digest: "SHA-256",
  };

  function parseBase64(value) {
    const bin = atob(value);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  function toBase64(bytes) {
    const chunkSize = 0x8000;
    const chunks = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
    }
    return btoa(chunks.join(""));
  }

  async function deriveAccessKey(accessPhrase, seed, usages) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(accessPhrase),
      algorithmLabels.derivation,
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: algorithmLabels.derivation,
        salt: seed,
        iterations: derivationRounds,
        hash: algorithmLabels.digest,
      },
      keyMaterial,
      { name: algorithmLabels.cipher, length: 256 },
      false,
      usages
    );
  }

  async function encodePayload(markdown, accessPhrase, version = 1) {
    const seed = crypto.getRandomValues(new Uint8Array(16));
    const offset = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAccessKey(accessPhrase, seed, ["encrypt"]);
    const payloadBuffer = await crypto.subtle.encrypt(
      { name: algorithmLabels.cipher, iv: offset },
      key,
      textEncoder.encode(markdown)
    );

    const payload = {
      version,
      seed: toBase64(seed),
      offset: toBase64(offset),
      payload: toBase64(new Uint8Array(payloadBuffer)),
    };

    seed.fill(0);
    offset.fill(0);
    return payload;
  }

  async function decodePayload(payload, accessPhrase, version = 1) {
    if (payload.version !== version) {
      throw new Error(`Unsupported format version: ${payload.version}`);
    }
    const seed = parseBase64(payload.seed);
    const offset = parseBase64(payload.offset);
    const payloadBytes = parseBase64(payload.payload);

    const key = await deriveAccessKey(accessPhrase, seed, ["decrypt"]);
    const resultBuffer = await crypto.subtle.decrypt(
      { name: algorithmLabels.cipher, iv: offset },
      key,
      payloadBytes
    );

    const resultBytes = new Uint8Array(resultBuffer);
    const parsed = textDecoder.decode(resultBytes);
    seed.fill(0);
    offset.fill(0);
    payloadBytes.fill(0);
    resultBytes.fill(0);
    return parsed;
  }

  window.payloadCodec = {
    encodePayload,
    decodePayload,
  };
})();
