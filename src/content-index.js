function getSectionEntry(sectionName) {
  const cfg = window.MarkdownFrontEditorConfig || {};
  const sections = Array.isArray(cfg.sectionsIndex) ? cfg.sectionsIndex : [];
  return sections.find((s) => s.name === sectionName) || null;
}

function getSubsectionEntry(sectionName, subName) {
  const section = getSectionEntry(sectionName);
  if (!section) return null;
  const subs = Array.isArray(section.subsections) ? section.subsections : [];
  return subs.find((s) => s.name === subName) || null;
}

function getFieldsIndex() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  return Array.isArray(cfg.fieldsIndex) ? cfg.fieldsIndex : [];
}

function findSectionNameForSubsection(subName) {
  const sections = window.MarkdownFrontEditorConfig?.sectionsIndex || [];
  for (const section of sections) {
    const subs = Array.isArray(section.subsections) ? section.subsections : [];
    for (const sub of subs) {
      if (sub?.name === subName) return section.name || "";
    }
  }
  return "";
}

function collectFieldTargets(root = document) {
  const fields = Array.from(root.querySelectorAll(".fe-editable"));
  return fields.map((el) => {
    const scope = el.getAttribute("data-mfe-scope") || "field";
    const name = el.getAttribute("data-mfe-name") || "";
    const section = el.getAttribute("data-mfe-section") || "";
    const subsection = el.getAttribute("data-mfe-subsection") || "";
    const fieldType = el.getAttribute("data-field-type") || "tag";
    const primaryId = subsection
      ? `subsection:${section}:${subsection}:${name}`
      : `${scope}:${section ? `${section}:` : ""}${name}`;
    return {
      id: primaryId,
      scope,
      name,
      section,
      subsection,
      fieldType,
      element: el,
      markdownB64: el.getAttribute("data-markdown-b64") || "",
    };
  });
}

export function buildContentIndex({ root = document } = {}) {
  const fields = collectFieldTargets(root);
  const targets = [...fields];
  const byId = new Map();
  targets.forEach((target) => {
    if (target?.id) {
      byId.set(target.id, target);
      if (target.scope === "field" && target.section && target.name) {
        byId.set(`field:${target.section}:${target.name}`, target);
      }
      if (
        target.scope === "field" &&
        target.section &&
        target.subsection &&
        target.name
      ) {
        byId.set(
          `subsection:${target.section}:${target.subsection}:${target.name}`,
          target,
        );
      }
    }
  });
  return { targets, byId };
}

// intentionally no debug exports

export {
  getSectionEntry,
  getSubsectionEntry,
  getFieldsIndex,
  findSectionNameForSubsection,
};
