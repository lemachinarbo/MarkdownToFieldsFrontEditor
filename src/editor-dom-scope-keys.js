function parseMarkerNameForDomScope(markerName, fallbackSection = "") {
  const raw = String(markerName || "").trim();
  if (!raw) {
    return {
      section: String(fallbackSection || ""),
      subsection: "",
      scopeKey: String(fallbackSection || "")
        ? `section:${String(fallbackSection || "")}`
        : "",
    };
  }
  if (raw.startsWith("section:")) {
    const section = raw.slice("section:".length).trim();
    return {
      section,
      subsection: "",
      scopeKey: section ? `section:${section}` : "",
    };
  }
  if (raw.startsWith("sub:")) {
    const subsection = raw.slice("sub:".length).trim();
    const section = String(fallbackSection || "");
    return {
      section,
      subsection,
      scopeKey:
        section && subsection ? `subsection:${section}:${subsection}` : "",
    };
  }
  if (raw.startsWith("subsection:")) {
    const subsection = raw.slice("subsection:".length).trim();
    const section = String(fallbackSection || "");
    return {
      section,
      subsection,
      scopeKey:
        section && subsection ? `subsection:${section}:${subsection}` : "",
    };
  }
  return {
    section: String(fallbackSection || ""),
    subsection: "",
    scopeKey: String(fallbackSection || "")
      ? `section:${String(fallbackSection || "")}`
      : "",
  };
}

function annotateEditorDomScopeKeys(editor) {
  const root = editor?.view?.dom;
  if (!(root instanceof Element)) return;
  let currentSection = "";
  let currentSubsection = "";
  const applyScopeAttrs = (element, scopeKey, section, subsection) => {
    if (!(element instanceof Element)) return;
    if (!scopeKey) return;
    element.setAttribute("data-mfe-scope-key", scopeKey);
    if (section) element.setAttribute("data-section", section);
    if (subsection) {
      element.setAttribute("data-subsection", subsection);
    } else {
      element.removeAttribute("data-subsection");
    }
    const descendants = element.querySelectorAll("*");
    descendants.forEach((descendant) => {
      if (!(descendant instanceof Element)) return;
      descendant.setAttribute("data-mfe-scope-key", scopeKey);
      if (section) descendant.setAttribute("data-section", section);
      if (subsection) {
        descendant.setAttribute("data-subsection", subsection);
      } else {
        descendant.removeAttribute("data-subsection");
      }
    });
  };
  const children = Array.from(root.children || []);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const markerName = String(child.getAttribute("data-mfe-marker") || "").trim();
    if (markerName) {
      const parsed = parseMarkerNameForDomScope(markerName, currentSection);
      if (markerName.startsWith("section:")) {
        currentSection = parsed.section;
        currentSubsection = "";
      } else if (
        markerName.startsWith("sub:") ||
        markerName.startsWith("subsection:")
      ) {
        if (parsed.section) currentSection = parsed.section;
        currentSubsection = parsed.subsection;
      }
      const markerScopeKey = parsed.scopeKey;
      if (markerScopeKey) {
        child.setAttribute("data-mfe-scope-key", markerScopeKey);
        if (currentSection) child.setAttribute("data-section", currentSection);
        if (currentSubsection) {
          child.setAttribute("data-subsection", currentSubsection);
        } else {
          child.removeAttribute("data-subsection");
        }
      }
      continue;
    }
    const scopeKey =
      currentSection && currentSubsection
        ? `subsection:${currentSection}:${currentSubsection}`
        : currentSection
          ? `section:${currentSection}`
          : "";
    applyScopeAttrs(child, scopeKey, currentSection, currentSubsection);
  }
}

export { annotateEditorDomScopeKeys };
