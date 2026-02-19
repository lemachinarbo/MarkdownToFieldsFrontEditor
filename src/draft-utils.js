export function normalizeComparableMarkdown(markdown) {
  return String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+$/g, "")
    .trimEnd();
}

export function scopedKeyFromFieldId(fieldId) {
  if (!fieldId || typeof fieldId !== "string") return "";
  const parts = fieldId.split(":");
  if (parts.length < 4) return "";
  const scope = parts[1] || "";
  if (scope === "section") {
    const name = parts[3] || parts[2] || "";
    return name ? `section:${name}` : "";
  }
  if (scope === "subsection") {
    const section = parts[2] || "";
    const name = parts[3] || "";
    return section && name ? `subsection:${section}:${name}` : "";
  }
  if (scope === "field") {
    if (parts.length >= 5) {
      const section = parts[2] || "";
      const subsection = parts[3] || "";
      const name = parts[4] || "";
      return section && subsection && name
        ? `subsection:${section}:${subsection}:${name}`
        : "";
    }
    const section = parts[2] || "";
    const name = parts[3] || "";
    if (section && name) return `field:${section}:${name}`;
    if (name) return `field:${name}`;
  }
  return "";
}

export function parseFieldId(fieldId) {
  if (!fieldId || typeof fieldId !== "string") return null;
  const parts = fieldId.split(":");
  if (parts.length < 4) return null;

  const pageId = parts[0] || "0";
  const scope = parts[1] || "field";
  const section = parts[2] || "";
  let subsection = "";
  let name = "";

  if (scope === "section") {
    name = parts[3] || parts[2] || "";
  } else if (scope === "subsection") {
    name = parts[3] || "";
  } else if (scope === "field") {
    if (parts.length >= 5) {
      subsection = parts[3] || "";
      name = parts[4] || "";
    } else {
      name = parts[3] || "";
    }
  } else {
    name = parts[3] || "";
  }

  if (!name) return null;
  return { fieldId, pageId, scope, section, subsection, name };
}

function changedKeyCoversTarget(changedKey, targetKey) {
  if (!changedKey || !targetKey) return false;
  if (changedKey === targetKey) return true;
  if (changedKey.startsWith("section:")) {
    const section = changedKey.slice(8);
    if (!section) return false;
    return (
      targetKey.startsWith(`section:${section}`) ||
      targetKey.startsWith(`subsection:${section}:`) ||
      targetKey.startsWith(`field:${section}:`)
    );
  }
  if (changedKey.startsWith("subsection:")) {
    return targetKey.startsWith(`${changedKey}:`) || targetKey === changedKey;
  }
  return false;
}

export function clearDraftsCoveredByChangedKeys({
  changedKeys,
  draftMarkdownByScopedKey,
  primaryDraftsByFieldId,
  clearDirtyByFieldId,
}) {
  const keys = Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [];
  if (!keys.length) return { scopedCleared: 0, fieldCleared: 0 };

  const shouldClear = (targetKey) =>
    keys.some((changedKey) => changedKeyCoversTarget(changedKey, targetKey));

  let scopedCleared = 0;
  for (const [scopeKey] of Array.from(draftMarkdownByScopedKey.entries())) {
    if (!shouldClear(scopeKey)) continue;
    draftMarkdownByScopedKey.delete(scopeKey);
    scopedCleared += 1;
  }

  let fieldCleared = 0;
  for (const [fieldId] of Array.from(primaryDraftsByFieldId.entries())) {
    const scopeKey = scopedKeyFromFieldId(fieldId);
    if (!scopeKey || !shouldClear(scopeKey)) continue;
    primaryDraftsByFieldId.delete(fieldId);
    if (typeof clearDirtyByFieldId === "function") {
      clearDirtyByFieldId(fieldId);
    }
    fieldCleared += 1;
  }

  return { scopedCleared, fieldCleared };
}
