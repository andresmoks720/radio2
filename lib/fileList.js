/*
Data lifetime:
- Raw text: none (file list metadata only).
- Disk: none.
- Network: none.
*/
export function createFileListController({
  ui,
  elements,
  store,
  filterEntries,
  filterByCategory,
  onLoadFile,
  onPreview,
}) {
  const state = {
    query: elements.fileFilterInput.value.trim(),
    category: elements.categoryFilter.value,
    selectedFile: "",
  };

  const getFilteredEntries = () =>
    filterByCategory(filterEntries(store.getCombinedEntries(), state.query), state.category);

  const refreshFileList = () => {
    const combined = store.getCombinedEntries();
    ui.updateCategoryOptions(combined);
    ui.renderFileGroups(getFilteredEntries(), {
      onLoadFile,
      onPreview: (file) => {
        setSelectedFile(file.path);
        onPreview(file);
      },
      selectedPath: state.selectedFile,
    });
  };

  const setFilterQuery = (value) => {
    state.query = value.trim();
    refreshFileList();
  };

  const setCategory = (value) => {
    state.category = value;
    refreshFileList();
  };

  const setSelectedFile = (path) => {
    state.selectedFile = path || "";
    refreshFileList();
  };

  return {
    getFilteredEntries,
    refreshFileList,
    setFilterQuery,
    setCategory,
    setSelectedFile,
  };
}
