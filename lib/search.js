export async function searchPayload({
  query,
  decodeAll,
  textDecoder,
  buildPreview,
  onProgress,
  shouldAbort,
}) {
  const results = [];
  const loweredQuery = query.toLowerCase();
  await decodeAll({
    onChunk: async (bytes, index, total) => {
      if (shouldAbort && shouldAbort()) {
        return;
      }
      let text = textDecoder.decode(bytes);
      let lower = text.toLowerCase();
      let offset = 0;
      let matchCount = 0;
      let firstMatch = -1;
      const offsets = [];
      while (true) {
        const next = lower.indexOf(loweredQuery, offset);
        if (next === -1) {
          break;
        }
        if (firstMatch === -1) {
          firstMatch = next;
        }
        if (offsets.length < 5) {
          offsets.push(next);
        }
        matchCount += 1;
        offset = next + loweredQuery.length;
      }
      if (matchCount > 0) {
        results.push({
          chunkIndex: index,
          matchCount,
          offsets,
          preview: buildPreview(text, firstMatch, loweredQuery.length),
        });
      }
      text = "";
      lower = "";
    },
    onProgress,
    shouldAbort,
  });
  return results;
}
