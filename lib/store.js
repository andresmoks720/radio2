/*
Data lifetime:
- Raw text: payload objects and metadata in memory only.
- Disk: none.
- Network: none.
*/
export function createStore() {
  let repoEntries = [];
  let bundleEntries = [];
  const historyStore = new Map();
  const livePayloads = new Map();
  const bundlePayloads = new Map();

  const setRepoEntries = (entries) => {
    repoEntries = Array.isArray(entries) ? entries : [];
  };

  const setBundleEntries = (entries) => {
    bundleEntries = Array.isArray(entries) ? entries : [];
  };

  const getRepoEntries = () => repoEntries;
  const getBundleEntries = () => bundleEntries;
  const getCombinedEntries = () => [...repoEntries, ...bundleEntries];

  const rememberPayload = (path, payload, source = "repo") => {
    const store = source === "bundle" ? bundlePayloads : livePayloads;
    store.set(path, payload);
  };

  const getPayload = (path, source = "repo") => {
    const store = source === "bundle" ? bundlePayloads : livePayloads;
    return store.get(path);
  };

  const getPayloadStores = () => ({ livePayloads, bundlePayloads });

  const clearPayloads = () => {
    livePayloads.clear();
    bundlePayloads.clear();
  };

  const pushHistory = (path, size) => {
    const entries = historyStore.get(path) || [];
    entries.unshift({ timestamp: new Date().toISOString(), size });
    historyStore.set(path, entries.slice(0, 5));
    return historyStore.get(path) || [];
  };

  const clearHistory = () => {
    historyStore.clear();
  };

  const getHistory = (path) => historyStore.get(path) || [];

  return {
    setRepoEntries,
    setBundleEntries,
    getRepoEntries,
    getBundleEntries,
    getCombinedEntries,
    rememberPayload,
    getPayload,
    getPayloadStores,
    clearPayloads,
    pushHistory,
    clearHistory,
    getHistory,
  };
}
