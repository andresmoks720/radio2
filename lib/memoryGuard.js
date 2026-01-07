/*
Data lifetime:
- Raw text: only during short-lived conversions in callers.
- Disk: none.
- Network: none.
*/
export function scrambleBytes(bytes) {
  const mask = crypto.getRandomValues(new Uint8Array(bytes.length));
  const scrambled = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    scrambled[i] = bytes[i] ^ mask[i];
  }
  bytes.fill(0);
  return { scrambled, mask };
}

export function descrambleToString(chunk, textDecoder) {
  const bytes = new Uint8Array(chunk.scrambled.length);
  for (let i = 0; i < chunk.scrambled.length; i += 1) {
    bytes[i] = chunk.scrambled[i] ^ chunk.mask[i];
  }
  const text = textDecoder.decode(bytes);
  bytes.fill(0);
  return text;
}

export function scrubChunk(chunk) {
  if (!chunk) {
    return;
  }
  chunk.scrambled?.fill(0);
  chunk.mask?.fill(0);
  chunk.scrambled = null;
  chunk.mask = null;
}
