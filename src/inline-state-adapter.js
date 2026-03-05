export function createInlineStateAdapter() {
  const originalMarkdownByField = new Map();
  const draftByField = new Map();
  const draftMarkdownByField = new Map();
  const scopeMetaByKey = new Map();
  const fieldElements = new Map();

  return {
    originalMarkdownByField,
    draftByField,
    draftMarkdownByField,
    scopeMetaByKey,
    fieldElements,
    setScopeMeta(scopeKey, meta) {
      scopeMetaByKey.set(scopeKey, meta);
    },
    getScopeMeta(scopeKey) {
      return scopeMetaByKey.get(scopeKey);
    },
    setFieldElement(fieldId, element) {
      fieldElements.set(fieldId, element);
    },
    getFieldElement(fieldId) {
      return fieldElements.get(fieldId);
    },
    getFieldElementEntries() {
      return fieldElements.entries();
    },
    setOriginalMarkdown(fieldId, markdown) {
      originalMarkdownByField.set(fieldId, markdown);
    },
    getOriginalMarkdown(fieldId) {
      return originalMarkdownByField.get(fieldId);
    },
    hasDraft(scopeKey) {
      return draftMarkdownByField.has(scopeKey) || draftByField.has(scopeKey);
    },
    setDraft(scopeKey, draft) {
      draftByField.set(scopeKey, draft);
    },
    setDraftMarkdown(scopeKey, markdown) {
      draftMarkdownByField.set(scopeKey, markdown);
    },
    deleteDraft(scopeKey) {
      draftByField.delete(scopeKey);
      draftMarkdownByField.delete(scopeKey);
    },
    clearDrafts() {
      draftByField.clear();
      draftMarkdownByField.clear();
    },
    getDraftMarkdownSize() {
      return draftMarkdownByField.size;
    },
    getDraftMarkdownEntries() {
      return Array.from(draftMarkdownByField.entries());
    },
    forEachDraft(callback) {
      draftByField.forEach((value, key) => callback(value, key));
    },
  };
}
