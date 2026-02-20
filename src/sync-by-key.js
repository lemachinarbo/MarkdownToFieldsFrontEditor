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

function resolveDataMfeCandidates(rawValue, lookup) {
  const raw = (rawValue || "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const pathParts = splitPath(raw.replace(/:/g, "/"));
  const out = new Set();

  if (lower.startsWith("section:")) {
    const parts = splitPath(raw.slice(8));
    if (!parts.length) return [];
    out.add(`section:${parts[0]}`);
    return Array.from(out);
  }
  if (lower.startsWith("field:")) {
    const parts = splitPath(raw.slice(6).replace(/:/g, "/"));
    if (parts.length === 1) out.add(`field:${parts[0]}`);
    if (parts.length >= 2) out.add(`field:${parts[0]}:${parts[1]}`);
    return Array.from(out);
  }
  if (lower.startsWith("sub:") || lower.startsWith("subsection:")) {
    const path = lower.startsWith("sub:") ? raw.slice(4) : raw.slice(11);
    const parts = splitPath(path.replace(/:/g, "/"));
    if (parts.length < 2) return [];
    if (parts.length === 2) out.add(`subsection:${parts[0]}:${parts[1]}`);
    if (parts.length >= 3)
      out.add(`subsection:${parts[0]}:${parts[1]}:${parts[2]}`);
    return Array.from(out);
  }

  const {
    sectionNames,
    subsectionKeys,
    fieldSectionKeys,
    fieldSubsectionKeys,
    fieldTopLevelNames,
  } = lookup || buildSemanticLookup();

  if (pathParts.length === 1) {
    const a = pathParts[0];
    if (sectionNames.has(a)) out.add(`section:${a}`);
    if (fieldTopLevelNames.has(a)) out.add(`field:${a}`);
    return Array.from(out);
  }
  if (pathParts.length === 2) {
    const [a, b] = pathParts;
    const subKey = `${a}/${b}`;
    const fieldKey = `${a}/${b}`;
    if (subsectionKeys.has(subKey)) out.add(`subsection:${a}:${b}`);
    if (fieldSectionKeys.has(fieldKey)) out.add(`field:${a}:${b}`);
    return Array.from(out);
  }
  if (pathParts.length >= 3) {
    const [a, b, c] = pathParts;
    const fieldSubKey = `${a}/${b}/${c}`;
    if (fieldSubsectionKeys.has(fieldSubKey))
      out.add(`subsection:${a}:${b}:${c}`);
    return Array.from(out);
  }
  return Array.from(out);
}

function inferContextFromAncestors(host, lookup) {
  let el = host?.parentElement || null;
  while (el) {
    const raw = (el.getAttribute?.("data-mfe") || "").trim();
    if (raw) {
      const candidates = resolveDataMfeCandidates(raw, lookup);
      const key = candidates.length === 1 ? candidates[0] : "";
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
  const candidates = resolveDataMfeCandidatesWithContext(
    rawValue,
    host,
    lookup,
  );
  return candidates.length === 1 ? candidates[0] : "";
}

function resolveDataMfeCandidatesWithContext(rawValue, host, lookup) {
  const direct = resolveDataMfeCandidates(rawValue, lookup);
  if (direct.length) return direct;

  const raw = (rawValue || "").trim();
  if (!raw) return [];
  const parts = splitPath(raw.replace(/:/g, "/"));
  if (!parts.length) return [];

  const ctx = inferContextFromAncestors(host, lookup);
  if (!ctx?.section) return [];

  const { fieldSectionKeys, fieldSubsectionKeys } =
    lookup || buildSemanticLookup();
  const out = new Set();

  if (parts.length === 1) {
    const name = parts[0];
    if (ctx.subsection) {
      const subKey = `${ctx.section}/${ctx.subsection}/${name}`;
      if (fieldSubsectionKeys.has(subKey)) {
        out.add(`subsection:${ctx.section}:${ctx.subsection}:${name}`);
      }
    }
    const secKey = `${ctx.section}/${name}`;
    if (fieldSectionKeys.has(secKey)) {
      out.add(`field:${ctx.section}:${name}`);
    }
    return Array.from(out);
  }

  if (parts.length === 2) {
    const [a, b] = parts;
    const subKey = `${ctx.section}/${a}/${b}`;
    if (fieldSubsectionKeys.has(subKey)) {
      out.add(`subsection:${ctx.section}:${a}:${b}`);
    }
  }

  return Array.from(out);
}

function hashMountKey(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const mountIdSignatureMap = new Map();

function isCanonicalScopedKey(key) {
  const value = (key || "").trim();
  if (!value) return false;
  if (/^section:[^:]+$/.test(value)) return true;
  if (/^field:[^:]+$/.test(value)) return true;
  if (/^field:[^:]+:[^:]+$/.test(value)) return true;
  if (/^subsection:[^:]+:[^:]+$/.test(value)) return true;
  if (/^subsection:[^:]+:[^:]+:[^:]+$/.test(value)) return true;
  return false;
}

function isDevDiagnosticsEnabled() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  return Boolean(cfg.debug || cfg.debugShowSections || cfg.debugLabels);
}

function debugWarn(...args) {
  if (!isDevDiagnosticsEnabled()) return;
  console.warn(...args);
}

function debugError(...args) {
  if (!isDevDiagnosticsEnabled()) return;
  console.error(...args);
}

function getDomPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const tag = (node.tagName || "x").toLowerCase();
    let idx = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if ((sib.tagName || "").toLowerCase() === tag) idx += 1;
      sib = sib.previousElementSibling;
    }
    parts.push(`${tag}:${idx}`);
    node = node.parentElement;
  }
  return parts.reverse().join(">");
}

function buildMountSignature(el, key) {
  return `${key}|${getDomPath(el)}|${el.getAttribute("data-mfe") || ""}|${el.getAttribute("data-mfe-source") || ""}|${(el.tagName || "").toLowerCase()}`;
}

function canonicalKeyToPath(key) {
  const parts = String(key || "").split(":");
  if (parts[0] === "section" && parts[1]) return parts[1];
  if (parts[0] === "field") {
    if (parts[2]) return `${parts[1]}.${parts[2]}`;
    if (parts[1]) return parts[1];
  }
  if (parts[0] === "subsection") {
    if (parts[3]) return `${parts[1]}.${parts[2]}.${parts[3]}`;
    if (parts[2]) return `${parts[1]}.${parts[2]}`;
  }
  return "";
}

function stampCanonicalIdentity(el, key, sig) {
  const prevKey = (el.getAttribute("data-mfe-key") || "").trim();
  const prevSig = (el.getAttribute("data-mfe-sig") || "").trim();
  const dev = isDevDiagnosticsEnabled();
  const pathValue = dev ? canonicalKeyToPath(key) : "";
  const prevPath = (el.getAttribute("data-mfe-path") || "").trim();
  if (
    prevKey === key &&
    prevSig === sig &&
    ((!dev && !prevPath) || (dev && prevPath === pathValue))
  ) {
    return false;
  }
  if (prevKey !== key) el.setAttribute("data-mfe-key", key);
  if (prevSig !== sig) el.setAttribute("data-mfe-sig", sig);
  if (dev) {
    if (pathValue) el.setAttribute("data-mfe-path", pathValue);
  } else if (prevPath) {
    el.removeAttribute("data-mfe-path");
  }
  return true;
}

function clearCanonicalIdentityIfPresent(el) {
  if (el.hasAttribute("data-mfe-key")) el.removeAttribute("data-mfe-key");
  if (el.hasAttribute("data-mfe-sig")) el.removeAttribute("data-mfe-sig");
  if (el.hasAttribute("data-mfe-path")) el.removeAttribute("data-mfe-path");
}

function ensureMountKeyId(el, key, sig) {
  const existing = (el.getAttribute("data-mfe-key-id") || "").trim();
  const prevKey = (el.getAttribute("data-mfe-key") || "").trim();
  const prevSig = (el.getAttribute("data-mfe-sig") || "").trim();
  const canReuseExisting = existing && prevKey === key && prevSig === sig;
  if (canReuseExisting) {
    if (!el.id) el.id = existing;
    return existing;
  }
  const source = sig;
  const id = `mfe-k-${hashMountKey(source)}`;
  const existingSig = mountIdSignatureMap.get(id);
  if (existingSig && existingSig !== source) {
    debugWarn("[mfe:bind] mount id collision", {
      id,
      previous: existingSig,
      next: source,
    });
  } else {
    mountIdSignatureMap.set(id, source);
  }
  el.setAttribute("data-mfe-key-id", id);
  if (!el.id) el.id = id;
  return id;
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
    if (host.querySelector("[data-mfe]") || host.querySelector(".fe-editable"))
      return;

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

export function collectMountTargetsByKey({
  changedKeys,
  root,
  getMetaAttr,
  semanticLookup,
}) {
  return compileMountTargetsByKey({
    changedKeys,
    root,
    getMetaAttr,
    semanticLookup,
  }).targetsByKey;
}

export function compileMountTargetsByKey({
  changedKeys,
  root,
  getMetaAttr,
  semanticLookup,
}) {
  const keys = Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [];
  const keySet = new Set(keys);
  const byKey = {};
  const report = {
    nodes: 0,
    ambiguous: [],
    unresolved: [],
    fingerprint: "",
    graphChecksum: "",
    graphNodeCount: 0,
    graphKeys: [],
  };
  const ambiguousSet = new Set();
  const unresolvedSet = new Set();
  const graphKeySet = new Set();
  const keyToCanonicalSigSet = new Map();
  const keyToMirrorSigSet = new Map();
  const keyIdToSig = new Map();
  const keyToSelectorSet = new Map();
  const devDiagnostics = isDevDiagnosticsEnabled();

  const addTarget = (key, el, mode = "inner", origin = "canonical") => {
    if (!el) return;
    if (!key) {
      clearCanonicalIdentityIfPresent(el);
      return;
    }
    report.nodes += 1;
    if (origin !== "editable") {
      graphKeySet.add(key);
    }
    const sig = buildMountSignature(el, key);
    stampCanonicalIdentity(el, key, sig);
    if (devDiagnostics) {
      const sigMap =
        origin === "mirror" ? keyToMirrorSigSet : keyToCanonicalSigSet;
      const currentByKey = sigMap.get(key) || new Map();
      currentByKey.set(sig, el);
      sigMap.set(key, currentByKey);
    }
    if (!keySet.has(key)) return;
    const keyId = ensureMountKeyId(el, key, sig);
    const selector = `[data-mfe-key-id="${keyId}"]`;
    const selectorSet = keyToSelectorSet.get(key) || new Set();
    if (selectorSet.has(selector)) {
      return;
    }
    selectorSet.add(selector);
    keyToSelectorSet.set(key, selectorSet);
    if (devDiagnostics) {
      const seenSig = keyIdToSig.get(keyId);
      if (seenSig && seenSig.sig !== sig) {
        debugError("[mfe:bind] invariant violation keyId->sig", {
          keyId,
          previousSig: seenSig.sig,
          nextSig: sig,
          previousNode: seenSig.node,
          nextNode: el,
        });
      } else if (!seenSig) {
        keyIdToSig.set(keyId, { sig, node: el });
      }
    }
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({
      selector,
      mode,
    });
  };

  root.querySelectorAll(".fe-editable").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    const key = scopedHtmlKeyFromMeta(
      getMetaAttr(el, "scope") || "field",
      getMetaAttr(el, "section") || "",
      getMetaAttr(el, "subsection") || "",
      getMetaAttr(el, "name") || "",
    );
    addTarget(key, el, "inner", "editable");
  });

  root.querySelectorAll("[data-mfe]").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    const raw = el.getAttribute("data-mfe") || "";
    const stamped = (el.getAttribute("data-mfe-key") || "").trim();
    let candidates = [];
    if (stamped && !isCanonicalScopedKey(stamped) && devDiagnostics) {
      throw new Error(
        `[mfe:bind] invalid stamped key on data-mfe node: ${stamped}`,
      );
    }
    candidates = resolveDataMfeCandidatesWithContext(raw, el, semanticLookup);
    if (
      isCanonicalScopedKey(stamped) &&
      !(candidates.length === 1 && candidates[0] === stamped)
    ) {
      clearCanonicalIdentityIfPresent(el);
    }
    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        el.setAttribute("data-mfe-ambiguous", candidates.join("|"));
        clearCanonicalIdentityIfPresent(el);
        const sig = `${raw} -> ${candidates.join("|")}`;
        if (!ambiguousSet.has(sig)) {
          ambiguousSet.add(sig);
          report.ambiguous.push(sig);
        }
      } else {
        el.removeAttribute("data-mfe-ambiguous");
        clearCanonicalIdentityIfPresent(el);
        const sig = `${raw}`;
        if (!unresolvedSet.has(sig)) {
          unresolvedSet.add(sig);
          report.unresolved.push(sig);
        }
      }
      return;
    }
    el.removeAttribute("data-mfe-ambiguous");
    const key = candidates[0];
    const mode =
      key.startsWith("section:") &&
      (el.getAttribute("data-mfe-root") || "") === key
        ? "outer"
        : "inner";
    addTarget(key, el, mode);
  });

  root.querySelectorAll("[data-mfe-source]").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    if (el.classList?.contains("fe-editable")) return;
    const raw = (el.getAttribute("data-mfe-source") || "").trim();
    if (!raw) return;
    const stamped = (el.getAttribute("data-mfe-key") || "").trim();
    let candidates = [];
    if (stamped && !isCanonicalScopedKey(stamped) && devDiagnostics) {
      throw new Error(
        `[mfe:bind] invalid stamped key on data-mfe-source node: ${stamped}`,
      );
    }
    candidates = resolveDataMfeCandidatesWithContext(raw, el, semanticLookup);
    if (
      isCanonicalScopedKey(stamped) &&
      !(candidates.length === 1 && candidates[0] === stamped)
    ) {
      clearCanonicalIdentityIfPresent(el);
    }
    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        el.setAttribute("data-mfe-ambiguous", candidates.join("|"));
        clearCanonicalIdentityIfPresent(el);
        const sig = `${raw} -> ${candidates.join("|")}`;
        if (!ambiguousSet.has(sig)) {
          ambiguousSet.add(sig);
          report.ambiguous.push(sig);
        }
      } else {
        el.removeAttribute("data-mfe-ambiguous");
        clearCanonicalIdentityIfPresent(el);
        const sig = `${raw}`;
        if (!unresolvedSet.has(sig)) {
          unresolvedSet.add(sig);
          report.unresolved.push(sig);
        }
      }
      return;
    }
    el.removeAttribute("data-mfe-ambiguous");
    addTarget(candidates[0], el, "inner", "mirror");
  });

  const fpSource = JSON.stringify({
    nodes: report.nodes,
    ambiguous: [...report.ambiguous].sort(),
    unresolved: [...report.unresolved].sort(),
  });
  report.fingerprint = `mfe-r-${hashMountKey(fpSource)}`;
  const graphParts = Array.from(graphKeySet).sort();
  report.graphKeys = graphParts;
  report.graphNodeCount = graphParts.length;
  report.graphChecksum = `mfe-g-${hashMountKey(JSON.stringify(graphParts))}`;

  if (devDiagnostics) {
    keyToCanonicalSigSet.forEach((canonicalSigMap, key) => {
      if (canonicalSigMap.size > 1) {
        const entries = Array.from(canonicalSigMap.entries()).map(
          ([sig, node]) => ({
            key,
            sig,
            node,
          }),
        );
        debugWarn("[mfe:bind] invariant warning key->multiple-sig", {
          key,
          sigCount: canonicalSigMap.size,
          mirrorSigCount: (keyToMirrorSigSet.get(key) || new Map()).size,
          entries,
        });
      }
    });
  }

  return { targetsByKey: byKey, report };
}
