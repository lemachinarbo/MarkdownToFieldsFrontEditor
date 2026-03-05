export function normalizeScopeKind(scopeKind = "field") {
  const raw = String(scopeKind || "")
    .trim()
    .toLowerCase();
  if (raw === "doc") return "document";
  if (raw === "document") return "document";
  if (raw === "section") return "section";
  if (raw === "subsection" || raw === "sub") return "subsection";
  return "field";
}

export function buildScopeKeyFromMeta(scopeMeta = {}) {
  const scopeKind = normalizeScopeKind(scopeMeta?.scopeKind || "field");
  const section = String(scopeMeta?.section || "").trim();
  const subsection = String(scopeMeta?.subsection || "").trim();
  const name = String(scopeMeta?.name || "").trim();

  if (scopeKind === "document") return "document";
  if (scopeKind === "section") {
    const resolvedName = name || section;
    return resolvedName ? `section:${resolvedName}` : "";
  }
  if (scopeKind === "subsection") {
    const resolvedName = name || subsection;
    if (!section || !resolvedName) return "";
    return `subsection:${section}:${resolvedName}`;
  }

  if (!name) return "";
  if (section && subsection) return `field:${section}:${subsection}:${name}`;
  if (section) return `field:${section}:${name}`;
  return `field:${name}`;
}

export function parseOriginScopeMeta(originKey) {
  const raw = String(originKey || "").trim();
  if (!raw) return null;
  const rawParts = raw
    .split(":")
    .map((part) => String(part || "").trim())
    .filter((part, index) => index === 0 || part.length > 0);
  const parts = (
    /^\d+$/.test(rawParts[0] || "") ? rawParts.slice(1) : rawParts
  ).filter(Boolean);
  if (!parts.length) return null;
  const scopeToken = parts[0].toLowerCase();
  if (scopeToken === "document") {
    return {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
  }
  if (scopeToken === "section" && parts.length >= 2) {
    return {
      scopeKind: "section",
      section: parts[1],
      subsection: "",
      name: parts[1],
    };
  }
  if (
    (scopeToken === "subsection" || scopeToken === "sub") &&
    parts.length >= 3
  ) {
    return {
      scopeKind: "subsection",
      section: parts[1],
      subsection: parts[2],
      name: parts[2],
    };
  }
  if (scopeToken === "field" && parts.length >= 3) {
    if (parts.length >= 4) {
      return {
        scopeKind: "field",
        section: parts[1],
        subsection: parts[2],
        name: parts[3],
      };
    }
    return {
      scopeKind: "field",
      section: parts[1],
      subsection: "",
      name: parts[2],
    };
  }
  return null;
}

export function readScopeSliceFromMarkdown(markdown, scopeMeta, options = {}) {
  const scopeKind = normalizeScopeKind(scopeMeta?.scopeKind || "field");
  if (scopeKind === "document") {
    return String(markdown || "");
  }
  const resolveMarkdownForScopeFromCanonical =
    options.resolveMarkdownForScopeFromCanonical;
  return resolveMarkdownForScopeFromCanonical({
    markdown: String(markdown || ""),
    scope: scopeKind,
    section: scopeMeta?.section || "",
    subsection: scopeMeta?.subsection || "",
    name: scopeMeta?.name || "",
  });
}
