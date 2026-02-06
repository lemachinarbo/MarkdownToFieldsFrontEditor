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

function parseMarkerComment(node) {
  const raw = (node?.nodeValue || "").trim();
  const sectionStart = raw.match(/^mfe:section:start\s+(.+)$/);
  if (sectionStart) {
    return { type: "section", name: sectionStart[1].trim(), edge: "start" };
  }
  const sectionEnd = raw.match(/^mfe:section:end\s+(.+)$/);
  if (sectionEnd) {
    return { type: "section", name: sectionEnd[1].trim(), edge: "end" };
  }
  const subStart = raw.match(/^mfe:subsection:start\s+(.+)::(.+)$/);
  if (subStart) {
    return {
      type: "subsection",
      section: subStart[1].trim(),
      name: subStart[2].trim(),
      edge: "start",
    };
  }
  const subEnd = raw.match(/^mfe:subsection:end\s+(.+)::(.+)$/);
  if (subEnd) {
    return {
      type: "subsection",
      section: subEnd[1].trim(),
      name: subEnd[2].trim(),
      edge: "end",
    };
  }
  return null;
}

function rangeToRect(range) {
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 && r.height > 0,
  );
  if (!rects.length) return null;
  return rects.reduce(
    (acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

function nextNode(node) {
  if (node.firstChild) return node.firstChild;
  while (node) {
    if (node.nextSibling) return node.nextSibling;
    node = node.parentNode;
  }
  return null;
}

function collectElementRectsBetween(start, end) {
  const rects = [];
  let node = start;
  while (node && node !== end) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        rects.push(rect);
      }
    }
    node = nextNode(node);
  }
  if (!rects.length) return null;
  return rects.reduce(
    (acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

function collectMarkerTargets(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const sectionMap = new Map();
  const subsectionMap = new Map();
  const targets = [];

  while (walker.nextNode()) {
    const info = parseMarkerComment(walker.currentNode);
    if (!info) continue;
    if (info.type === "section") {
      const key = info.name;
      if (!sectionMap.has(key)) {
        sectionMap.set(key, {});
      }
      sectionMap.get(key)[info.edge] = walker.currentNode;
    }
    if (info.type === "subsection") {
      const key = `${info.section}::${info.name}`;
      if (!subsectionMap.has(key)) {
        subsectionMap.set(key, { section: info.section, name: info.name });
      }
      subsectionMap.get(key)[info.edge] = walker.currentNode;
    }
  }

  sectionMap.forEach((value, name) => {
    if (!value.start || !value.end) return;
    const range = document.createRange();
    range.setStartAfter(value.start);
    range.setEndBefore(value.end);
    const rect =
      collectElementRectsBetween(value.start, value.end) || rangeToRect(range);
    if (rect) {
      const entry = getSectionEntry(name);
      targets.push({
        id: `section:${name}`,
        scope: "section",
        name,
        rect,
        markdownB64: entry?.markdownB64 || "",
      });
    }
  });

  subsectionMap.forEach((value) => {
    if (!value.start || !value.end) return;
    const range = document.createRange();
    range.setStartAfter(value.start);
    range.setEndBefore(value.end);
    const rect =
      collectElementRectsBetween(value.start, value.end) || rangeToRect(range);
    if (rect) {
      const entry = getSubsectionEntry(value.section, value.name);
      targets.push({
        id: `subsection:${value.section}:${value.name}`,
        scope: "subsection",
        name: value.name,
        section: value.section,
        rect,
        markdownB64: entry?.markdownB64 || "",
      });
    }
  });

  return targets;
}

function collectFieldTargets(root = document) {
  const fields = Array.from(root.querySelectorAll(".fe-editable"));
  return fields.map((el) => {
    const scope = el.getAttribute("data-md-scope") || "field";
    const name = el.getAttribute("data-md-name") || "";
    const section = el.getAttribute("data-md-section") || "";
    const fieldType = el.getAttribute("data-field-type") || "tag";
    return {
      id: `${scope}:${section ? `${section}:` : ""}${name}`,
      scope,
      name,
      section,
      fieldType,
      element: el,
      markdownB64: el.getAttribute("data-markdown-b64") || "",
    };
  });
}

export function buildContentIndex({ root = document } = {}) {
  const fields = collectFieldTargets(root);
  const markers = collectMarkerTargets(root.body || document.body);
  const targets = [...fields, ...markers];
  const byId = new Map();
  targets.forEach((target) => {
    if (target?.id) {
      byId.set(target.id, target);
    }
  });
  return { targets, byId };
}

// intentionally no debug exports

export { getSectionEntry, getSubsectionEntry };
