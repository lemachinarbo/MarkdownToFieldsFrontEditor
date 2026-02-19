export function scopedHtmlKeyFromMeta(scope, section, subsection, name) {
  const s = scope || "field";
  const sec = section || "";
  const sub = subsection || "";
  const n = name || "";
  if (s === "section") return n ? `section:${n}` : "";
  if (s === "subsection") return sec && n ? `subsection:${sec}:${n}` : "";
  if (s === "field") {
    if (sub && sec && n) return `subsection:${sec}:${sub}:${n}`;
    if (sec && n) return `field:${sec}:${n}`;
    if (n) return `field:${n}`;
    return "";
  }
  if (s === "block") return sec && n ? `block:${sec}:${n}` : "";
  return n ? `${s}:${n}` : "";
}

function isSectionKey(key) {
  return typeof key === "string" && key.startsWith("section:");
}

function isCoveredBySectionKey(changedSet, key, mounts) {
  if (!key || isSectionKey(key)) return false;
  const sectionMatch = key.match(/^(?:section|subsection|field):([^:]+)/);
  const section = sectionMatch?.[1] || "";
  if (!section) return false;
  const sectionKey = `section:${section}`;
  if (!changedSet.has(sectionKey)) return false;
  // Only prune descendants if we can actually apply the section fragment.
  return mounts?.has(sectionKey) || false;
}

function pruneChangedKeys(changedKeys, mounts) {
  const keys = Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [];
  const changedSet = new Set(keys);
  return keys.filter((key) => !isCoveredBySectionKey(changedSet, key, mounts));
}

function splitPath(value) {
  return (value || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function buildSemanticLookup({ sections = [], fields = [] } = {}) {
  const sectionNames = new Set();
  const subsectionKeys = new Set();
  const fieldSectionKeys = new Set();
  const fieldSubsectionKeys = new Set();
  const fieldTopLevelNames = new Set();

  (Array.isArray(sections) ? sections : []).forEach((section) => {
    const sec = (section?.name || "").trim();
    if (!sec) return;
    sectionNames.add(sec);
    const subs = Array.isArray(section?.subsections) ? section.subsections : [];
    subs.forEach((sub) => {
      const subName = (sub?.name || "").trim();
      if (!subName) return;
      subsectionKeys.add(`${sec}/${subName}`);
    });
  });

  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const name = (field?.name || "").trim();
    const sec = (field?.section || "").trim();
    const sub = (field?.subsection || "").trim();
    if (!name) return;
    if (!sec && !sub) {
      fieldTopLevelNames.add(name);
      return;
    }
    if (sec && sub) {
      fieldSubsectionKeys.add(`${sec}/${sub}/${name}`);
      return;
    }
    if (sec) {
      fieldSectionKeys.add(`${sec}/${name}`);
    }
  });

  return {
    sectionNames,
    subsectionKeys,
    fieldSectionKeys,
    fieldSubsectionKeys,
    fieldTopLevelNames,
  };
}

function resolveDataMfeKey(rawValue, lookup) {
  const raw = (rawValue || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const pathParts = splitPath(raw.replace(/:/g, "/"));

  if (lower.startsWith("section:")) {
    const parts = splitPath(raw.slice(8));
    if (!parts.length) return "";
    return `section:${parts[0]}`;
  }
  if (lower.startsWith("sub:") || lower.startsWith("subsection:")) {
    const path = lower.startsWith("sub:") ? raw.slice(4) : raw.slice(11);
    const parts = splitPath(path.replace(/:/g, "/"));
    if (parts.length < 2) return "";
    return `subsection:${parts[0]}:${parts[1]}`;
  }

  const { sectionNames, subsectionKeys, fieldSectionKeys, fieldSubsectionKeys, fieldTopLevelNames } =
    lookup || buildSemanticLookup();

  if (pathParts.length === 1) {
    const a = pathParts[0];
    if (sectionNames.has(a)) return `section:${a}`;
    if (fieldTopLevelNames.has(a)) return `field:${a}`;
    return "";
  }
  if (pathParts.length === 2) {
    const [a, b] = pathParts;
    const subKey = `${a}/${b}`;
    const fieldKey = `${a}/${b}`;
    if (subsectionKeys.has(subKey)) return `subsection:${a}:${b}`;
    if (fieldSectionKeys.has(fieldKey)) return `field:${a}:${b}`;
    return "";
  }
  if (pathParts.length >= 3) {
    const [a, b, c] = pathParts;
    const fieldSubKey = `${a}/${b}/${c}`;
    if (fieldSubsectionKeys.has(fieldSubKey)) return `subsection:${a}:${b}:${c}`;
    return "";
  }
  return "";
}

function inferContextFromAncestors(host, lookup) {
  let el = host?.parentElement || null;
  while (el) {
    const raw = (el.getAttribute?.("data-mfe") || "").trim();
    if (raw) {
      const key = resolveDataMfeKey(raw, lookup);
      if (key.startsWith("section:")) {
        return { section: key.slice("section:".length), subsection: "" };
      }
      if (key.startsWith("subsection:")) {
        const parts = key.split(":");
        if (parts.length >= 3) {
          return { section: parts[1] || "", subsection: parts[2] || "" };
        }
      }
      if (key.startsWith("field:")) {
        const parts = key.split(":");
        if (parts.length >= 3) {
          return { section: parts[1] || "", subsection: "" };
        }
      }
    }
    el = el.parentElement;
  }
  return null;
}

function resolveDataMfeKeyWithContext(rawValue, host, lookup) {
  const direct = resolveDataMfeKey(rawValue, lookup);
  if (direct) return direct;

  const raw = (rawValue || "").trim();
  if (!raw) return "";
  const parts = splitPath(raw.replace(/:/g, "/"));
  if (!parts.length) return "";

  const ctx = inferContextFromAncestors(host, lookup);
  if (!ctx?.section) return "";

  const {
    fieldSectionKeys,
    fieldSubsectionKeys,
  } = lookup || buildSemanticLookup();

  if (parts.length === 1) {
    const name = parts[0];
    if (ctx.subsection) {
      const subKey = `${ctx.section}/${ctx.subsection}/${name}`;
      if (fieldSubsectionKeys.has(subKey)) {
        return `subsection:${ctx.section}:${ctx.subsection}:${name}`;
      }
    }
    const secKey = `${ctx.section}/${name}`;
    if (fieldSectionKeys.has(secKey)) {
      return `field:${ctx.section}:${name}`;
    }
    return "";
  }

  if (parts.length === 2) {
    const [a, b] = parts;
    const subKey = `${ctx.section}/${a}/${b}`;
    if (fieldSubsectionKeys.has(subKey)) {
      return `subsection:${ctx.section}:${a}:${b}`;
    }
  }

  return "";
}

function collectReadOnlyHostMounts(root, mounts, semanticLookup) {
  root.querySelectorAll("[data-mfe]").forEach((host) => {
    if (host.closest('[data-mfe-window="true"]')) return;
    const key = resolveDataMfeKeyWithContext(
      host.getAttribute("data-mfe") || "",
      host,
      semanticLookup,
    );
    if (!key) return;

    // Allow explicit read-only mounts for field-shaped hosts (e.g. custom list render).
    if (
      key.startsWith("field:") ||
      (key.startsWith("subsection:") && key.split(":").length === 4)
    ) {
      if (host.querySelector(".fe-editable")) return;
      if (host.querySelector("[data-mfe]")) return;
      if (!mounts.has(key)) mounts.set(key, host);
      return;
    }

    if (key.startsWith("subsection:") && key.split(":").length === 3) {
      // If host contains editable field mounts, replacing subsection host can
      // swallow child field projections. Require explicit slot/root in that case.
      if (host.querySelector(".fe-editable")) return;
      if (!mounts.has(key)) {
        mounts.set(key, host);
      }
      return;
    }
    if (!key.startsWith("section:")) return;

    // Avoid replacing structural/mixed hosts that contain nested editable scopes.
    if (host.querySelector("[data-mfe]") || host.querySelector(".fe-editable")) return;

    if (!mounts.has(key)) {
      mounts.set(key, host);
    }
  });
}

export function collectStrictMountsByKey(root, getMetaAttr, semanticLookup) {
  const mounts = new Map();

  root.querySelectorAll(".fe-editable").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    const key = scopedHtmlKeyFromMeta(
      getMetaAttr(el, "scope") || "field",
      getMetaAttr(el, "section") || "",
      getMetaAttr(el, "subsection") || "",
      getMetaAttr(el, "name") || "",
    );
    if (key) mounts.set(key, el);
  });

  root.querySelectorAll("[data-mfe-slot]").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    const key = (el.getAttribute("data-mfe-slot") || "").trim();
    if (key) mounts.set(key, el);
  });

  root.querySelectorAll("[data-mfe-root]").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    const key = (el.getAttribute("data-mfe-root") || "").trim();
    if (key) mounts.set(key, el);
  });

  collectReadOnlyHostMounts(root, mounts, semanticLookup);

  return mounts;
}

export function applyChangedHtmlByKeyStrict({
  changedKeys,
  htmlMap,
  root,
  normalizeHtml,
  warnedMissingMountKeys,
  debug,
  getMetaAttr,
  isOuterSwapKey,
  semanticLookup,
}) {
  const mounts = collectStrictMountsByKey(root, getMetaAttr, semanticLookup);
  console.warn("[mfe:fragment-sync] mounts collected", {
    mountCount: mounts.size,
    changedKeysIn: Array.isArray(changedKeys) ? changedKeys : [],
    htmlMapKeys: htmlMap ? Object.keys(htmlMap).length : 0,
  });
  let updated = 0;
  const keys = pruneChangedKeys(changedKeys, mounts);
  console.warn("[mfe:fragment-sync] changed keys pruned", {
    changedKeysOut: keys,
  });
  keys.forEach((key) => {
    if (!key) return;
    const html = htmlMap?.[key];
    if (typeof html !== "string") {
      console.warn("[mfe:fragment-sync] missing html fragment", { key });
      return;
    }

    const mount = mounts.get(key);
    if (!mount) {
      if (debug && warnedMissingMountKeys && !warnedMissingMountKeys.has(key)) {
        warnedMissingMountKeys.add(key);
        console.warn("[mfe:strict-sync] missing mount for changed key", { key });
      }
      console.warn("[mfe:fragment-sync] no mount for key", { key });
      return;
    }

    const normalized = normalizeHtml(html);
    const doOuterSwap =
      typeof isOuterSwapKey === "function" && isOuterSwapKey(key, mount);
    console.warn("[mfe:fragment-sync] applying fragment", {
      key,
      mode: doOuterSwap ? "outerHTML" : "innerHTML",
      mountTag: mount.tagName || "",
      mountClass: mount.className || "",
      mountDataMfe: mount.getAttribute?.("data-mfe") || "",
      mountDataSlot: mount.getAttribute?.("data-mfe-slot") || "",
      htmlLen: normalized.length,
    });
    if (doOuterSwap) {
      mount.outerHTML = normalized;
    } else {
      mount.innerHTML = normalized;
    }
    updated += 1;
  });

  return updated;
}

export function fanOutChangedHtmlBySource({
  changedKeys,
  htmlMap,
  root,
  normalizeHtml,
  semanticLookup,
}) {
  const keys = Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [];
  if (!keys.length) return 0;
  let updated = 0;

  keys.forEach((key) => {
    const html = htmlMap?.[key];
    if (typeof html !== "string") return;
    const normalized = normalizeHtml(html);
    root.querySelectorAll("[data-mfe-source]").forEach((el) => {
      if (el.closest('[data-mfe-window="true"]')) return;
      const raw = (el.getAttribute("data-mfe-source") || "").trim();
      if (!raw) return;
      const resolved = resolveDataMfeKeyWithContext(raw, el, semanticLookup);
      const sourceKey = resolved || raw;
      if (sourceKey !== key) return;
      el.innerHTML = normalized;
      updated += 1;
    });
  });

  console.warn("[mfe:fragment-sync] source fanout", {
    changedKeys: keys,
    updated,
  });

  return updated;
}

export function syncEditableMarkdownAttributesFromFieldsIndex({
  root,
  fields,
  sections,
  getMetaAttr,
  decodeMarkdownBase64,
}) {
  if (!Array.isArray(fields) || !fields.length) return 0;

  const semanticLookup = buildSemanticLookup({ sections, fields });
  const mounts = collectStrictMountsByKey(root, getMetaAttr, semanticLookup);
  let updated = 0;

  fields.forEach((f) => {
    const key = scopedHtmlKeyFromMeta(
      "field",
      f?.section || "",
      f?.subsection || "",
      f?.name || "",
    );
    if (!key) return;

    const mount = mounts.get(key);
    if (!mount || !mount.classList?.contains("fe-editable")) return;

    const markdownB64 = f?.markdownB64 || "";
    if (!markdownB64) return;

    mount.setAttribute("data-markdown-b64", markdownB64);
    try {
      mount.setAttribute("data-markdown", decodeMarkdownBase64(markdownB64));
    } catch (_e) {
      // no-op: invalid payload should not break preview sync
    }
    updated += 1;
  });

  return updated;
}
