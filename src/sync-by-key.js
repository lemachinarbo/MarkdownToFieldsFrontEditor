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

function parseDataMfeValue(value) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const splitPath = (path) =>
    (path || "")
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);

  if (lower.startsWith("section:")) {
    const parts = splitPath(raw.slice(8));
    if (!parts.length) return null;
    return { scope: "section", section: "", subsection: "", name: parts[0] };
  }
  if (lower.startsWith("sub:") || lower.startsWith("subsection:")) {
    const path = lower.startsWith("sub:") ? raw.slice(4) : raw.slice(11);
    const parts = splitPath(path.replace(/:/g, "/"));
    if (parts.length < 2) return null;
    return {
      scope: "subsection",
      section: parts[0],
      subsection: "",
      name: parts[1],
    };
  }

  const parts = splitPath(raw.replace(/:/g, "/"));
  if (parts.length === 1) {
    return { scope: "auto", section: "", subsection: "", name: parts[0] };
  }
  if (parts.length === 2) {
    return { scope: "auto", section: parts[0], subsection: "", name: parts[1] };
  }
  if (parts.length >= 3) {
    return {
      scope: "field",
      section: parts[0] || "",
      subsection: parts[1] || "",
      name: parts[2] || "",
    };
  }
  return null;
}

function collectReadOnlyHostMounts(root, mounts) {
  root.querySelectorAll("[data-mfe]").forEach((host) => {
    if (host.closest('[data-mfe-window="true"]')) return;
    const parsed = parseDataMfeValue(host.getAttribute("data-mfe") || "");
    if (!parsed) return;

    const isSubsectionHost =
      parsed.scope === "subsection" ||
      (parsed.scope === "auto" &&
        Boolean(parsed.section) &&
        !parsed.subsection &&
        Boolean(parsed.name));
    if (isSubsectionHost) {
      const key = `subsection:${parsed.section}:${parsed.name}`;
      if (!mounts.has(key)) {
        mounts.set(key, host);
      }
      return;
    }

    const isSectionHost =
      parsed.scope === "section" ||
      (parsed.scope === "auto" &&
        !parsed.section &&
        !parsed.subsection &&
        Boolean(parsed.name));
    if (!isSectionHost) return;

    // Avoid replacing structural wrapper hosts that contain nested editable hosts.
    if (host.querySelector("[data-mfe]")) return;

    const key = `section:${parsed.name}`;
    if (!mounts.has(key)) {
      mounts.set(key, host);
    }
  });
}

export function collectStrictMountsByKey(root, getMetaAttr) {
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

  collectReadOnlyHostMounts(root, mounts);

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
}) {
  const mounts = collectStrictMountsByKey(root, getMetaAttr);
  let updated = 0;

  (Array.isArray(changedKeys) ? changedKeys : []).forEach((key) => {
    if (!key) return;
    const html = htmlMap?.[key];
    if (typeof html !== "string") return;

    const mount = mounts.get(key);
    if (!mount) {
      if (debug && warnedMissingMountKeys && !warnedMissingMountKeys.has(key)) {
        warnedMissingMountKeys.add(key);
        console.warn("[mfe:strict-sync] missing mount for changed key", { key });
      }
      return;
    }

    mount.innerHTML = normalizeHtml(html);
    updated += 1;
  });

  return updated;
}

export function syncEditableMarkdownAttributesFromFieldsIndex({
  root,
  fields,
  getMetaAttr,
  decodeMarkdownBase64,
}) {
  if (!Array.isArray(fields) || !fields.length) return 0;

  const mounts = collectStrictMountsByKey(root, getMetaAttr);
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
