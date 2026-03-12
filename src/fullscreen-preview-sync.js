import { getMetaAttr } from "./editor-shared-helpers.js";
import { normalizeHtmlImageSources } from "./editor-image-annotations.js";
import { scopedHtmlKeyFromMeta } from "./sync-by-key.js";

/**
 * Patch editable hosts directly when fragment updates match known scoped keys.
 * Does not read or mutate canonical markdown authority.
 */
export function applyChangedHtmlEditableOnly({
  changedKeys,
  htmlMap,
  resolveHostImageSrc,
}) {
  const keys = Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [];
  if (!keys.length) return 0;
  const keySet = new Set(keys);
  let updated = 0;
  document.querySelectorAll(".fe-editable").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    const key = scopedHtmlKeyFromMeta(
      getMetaAttr(el, "scope") || "field",
      getMetaAttr(el, "section") || "",
      getMetaAttr(el, "subsection") || "",
      getMetaAttr(el, "name") || "",
    );
    if (!keySet.has(key)) return;
    const html = htmlMap?.[key];
    if (typeof html !== "string") return;
    el.innerHTML = normalizeHtmlImageSources(html, {
      resolveImageSrc: (src) => resolveHostImageSrc(document.body, src),
    });
    updated += 1;
  });
  return updated;
}

/**
 * Patch editable children inside section hosts when direct key matching is insufficient.
 * Does not infer save authority or alter scope state.
 */
export function applyEditableFallbackInSectionHosts({
  sectionKeys,
  mountTargets,
  htmlMap,
  resolveHostImageSrc,
}) {
  const keys = Array.isArray(sectionKeys) ? sectionKeys.filter(Boolean) : [];
  if (!keys.length) return 0;
  let updated = 0;
  keys.forEach((sectionKey) => {
    const targets = Array.isArray(mountTargets?.[sectionKey])
      ? mountTargets[sectionKey]
      : [];
    targets.forEach((target) => {
      const selector = target?.selector || "";
      if (!selector) return;
      const hosts = Array.from(document.querySelectorAll(selector));
      hosts.forEach((host) => {
        if (!host || !host.isConnected) return;
        const editables = [];
        if (host.classList?.contains("fe-editable")) editables.push(host);
        host
          .querySelectorAll?.(".fe-editable")
          ?.forEach((el) => editables.push(el));
        editables.forEach((el) => {
          const key = scopedHtmlKeyFromMeta(
            getMetaAttr(el, "scope") || "field",
            getMetaAttr(el, "section") || "",
            getMetaAttr(el, "subsection") || "",
            getMetaAttr(el, "name") || "",
          );
          const html = htmlMap?.[key];
          if (typeof html !== "string") return;
          el.innerHTML = normalizeHtmlImageSources(html, {
            resolveImageSrc: (src) => resolveHostImageSrc(document.body, src),
          });
          updated += 1;
        });
      });
    });
  });
  return updated;
}

/**
 * Patch every node matched by a Datastar selector.
 * Does not decide selector ordering or patch safety.
 */
export function applyDatastarPatchElement({
  selector,
  mode,
  elements,
  cycleId,
}) {
  if (!selector) return 0;
  const nodes = Array.from(document.querySelectorAll(selector));
  return applyDatastarPatchToNodes({ nodes, mode, elements, cycleId });
}

/**
 * Patch a provided node list with Datastar HTML.
 * Does not normalize selectors or compute patch contents.
 */
export function applyDatastarPatchToNodes({ nodes, mode, elements, cycleId }) {
  if (!nodes.length) return 0;
  const patchMode = mode || "inner";
  let updated = 0;
  nodes.forEach((node) => {
    if (!node || !node.isConnected) return;
    if (patchMode === "outer" || patchMode === "replace") {
      node.outerHTML = elements || "";
      updated += 1;
      return;
    }
    node.innerHTML = elements || "";
    if (cycleId !== undefined && cycleId !== null) {
      node.setAttribute("data-mfe-last-patch", String(cycleId));
    }
    updated += 1;
  });
  return updated;
}

/**
 * Parse fragment HTML into a detached document for safe inspection.
 * Does not sanitize or validate fragment semantics.
 */
export function parseFragmentHtmlDocument(html) {
  try {
    const parser = new DOMParser();
    return parser.parseFromString(String(html || ""), "text/html");
  } catch (_e) {
    return null;
  }
}

/**
 * Collect non-editable images inside a host.
 * Does not inspect fullscreen editor contenteditable regions.
 */
export function collectNonEditableImages(root) {
  if (!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll("img")).filter(
    (img) => !img.closest(".fe-editable"),
  );
}

/**
 * Collect non-editable media roots inside a host.
 * Does not inspect editable image nodes inside editor hosts.
 */
export function collectNonEditableMediaRoots(root) {
  if (!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll("picture, img")).filter((node) => {
    if (node.closest(".fe-editable")) return false;
    if (node.tagName?.toLowerCase() === "img" && node.closest("picture")) {
      return false;
    }
    return true;
  });
}

/**
 * Normalize a srcset string against a rendered host.
 * Does not fetch images or persist rewritten URLs.
 */
export function normalizeSrcsetForHost(host, srcset, resolveHostImageSrc) {
  const value = String(srcset || "").trim();
  if (!value) return "";
  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return "";
      const parts = trimmed.split(/\s+/);
      const url = parts.shift() || "";
      const descriptor = parts.join(" ");
      const resolvedUrl = resolveHostImageSrc(host, url);
      return descriptor ? `${resolvedUrl} ${descriptor}` : resolvedUrl;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Normalize `src` and `srcset` attributes for cloned media nodes.
 * Does not patch the live DOM directly.
 */
export function normalizeMediaNodeUrlsForHost(host, node, resolveHostImageSrc) {
  if (!node || !node.querySelectorAll) return;
  const elements = [];
  if (node.matches?.("img, source")) elements.push(node);
  node.querySelectorAll?.("img, source")?.forEach((el) => elements.push(el));
  elements.forEach((el) => {
    const src = el.getAttribute("src") || "";
    if (src) {
      el.setAttribute("src", resolveHostImageSrc(host, src));
    }
    const srcset = el.getAttribute("srcset") || "";
    if (srcset) {
      el.setAttribute(
        "srcset",
        normalizeSrcsetForHost(host, srcset, resolveHostImageSrc),
      );
    }
  });
}

/**
 * Sync non-editable media after a fragment patch.
 * Does not update editable fullscreen content or canonical markdown.
 */
export function syncNonEditableImagesFromPatch(
  host,
  patchHtml,
  resolveHostImageSrc,
) {
  if (!host || !host.querySelectorAll) return 0;
  const parsed = parseFragmentHtmlDocument(patchHtml);
  if (!parsed) return 0;

  const liveMediaRoots = collectNonEditableMediaRoots(host);
  const patchMediaRoots = collectNonEditableMediaRoots(parsed.body || parsed);
  if (liveMediaRoots.length && patchMediaRoots.length) {
    if (liveMediaRoots.length !== patchMediaRoots.length) return 0;
    let mediaUpdated = 0;
    liveMediaRoots.forEach((liveNode, idx) => {
      const patchNode = patchMediaRoots[idx];
      if (!patchNode || !liveNode?.isConnected) return;
      const patchClone = patchNode.cloneNode(true);
      normalizeMediaNodeUrlsForHost(host, patchClone, resolveHostImageSrc);
      const nextHtml = patchClone.outerHTML || "";
      const currentHtml = liveNode.outerHTML || "";
      if (!nextHtml || nextHtml === currentHtml) return;
      liveNode.outerHTML = nextHtml;
      mediaUpdated += 1;
    });
    if (mediaUpdated > 0) return mediaUpdated;
  }

  const liveImages = collectNonEditableImages(host);
  const patchImages = collectNonEditableImages(parsed.body || parsed);
  if (!liveImages.length || !patchImages.length) return 0;
  if (liveImages.length !== patchImages.length) return 0;

  let updated = 0;
  liveImages.forEach((liveImg, idx) => {
    const patchImg = patchImages[idx];
    if (!patchImg) return;

    const srcRaw = patchImg.getAttribute("src") || "";
    if (srcRaw) {
      const nextSrc = resolveHostImageSrc(host, srcRaw);
      if ((liveImg.getAttribute("src") || "") !== nextSrc) {
        liveImg.setAttribute("src", nextSrc);
        updated += 1;
      }
    }

    const nextAlt = patchImg.getAttribute("alt") || "";
    if ((liveImg.getAttribute("alt") || "") !== nextAlt) {
      liveImg.setAttribute("alt", nextAlt);
    }

    const nextTitle = patchImg.getAttribute("title");
    if (nextTitle === null || nextTitle === "") {
      if (liveImg.hasAttribute("title")) liveImg.removeAttribute("title");
    } else if ((liveImg.getAttribute("title") || "") !== nextTitle) {
      liveImg.setAttribute("title", nextTitle);
    }
  });

  return updated;
}

/**
 * Parse a Datastar SSE block into event payload parts.
 * Does not validate the payload beyond basic line splitting.
 */
export function parseDatastarEventBlock(block) {
  const lines = String(block || "")
    .split(/\r?\n/)
    .filter(Boolean);
  let event = "message";
  const payload = {};
  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      return;
    }
    if (!line.startsWith("data:")) return;
    let raw = line.slice(5);
    if (raw.startsWith(" ")) raw = raw.slice(1);
    const sep = raw.indexOf(" ");
    if (sep <= 0) return;
    const key = raw.slice(0, sep);
    const value = raw.slice(sep + 1);
    if (key === "elements") {
      payload.elements = payload.elements
        ? `${payload.elements}\n${value}`
        : value;
      return;
    }
    payload[key] = value;
  });
  return { event, payload };
}

/**
 * Rank scoped keys so broader patches apply before narrower ones.
 * Does not inspect DOM state or draft caches.
 */
export function keyDepth(key) {
  if (!key) return 99;
  if (key.startsWith("section:")) return 1;
  if (key.startsWith("field:")) return 2;
  if (key.startsWith("subsection:")) return key.split(":").length >= 4 ? 3 : 2;
  return 50;
}

/**
 * Check whether one scoped key is a descendant of another.
 * Does not interpret canonical markdown structure.
 */
export function isDescendantKey(child, parent) {
  if (!child || !parent || child === parent) return false;
  if (parent.startsWith("section:")) {
    const sec = parent.slice("section:".length);
    return (
      child.startsWith(`field:${sec}:`) ||
      child.startsWith(`subsection:${sec}:`)
    );
  }
  if (parent.startsWith("subsection:")) {
    const parts = parent.split(":");
    if (parts.length === 3) return child.startsWith(`${parent}:`);
  }
  return false;
}

/**
 * Check whether a section key still has descendant draft keys.
 * Does not read draft contents or mutate draft state.
 */
export function hasDescendantScopedDrafts(sectionKey, draftKeys = []) {
  if (!sectionKey || !sectionKey.startsWith("section:")) return false;
  for (const scopedKey of draftKeys) {
    if (isDescendantKey(scopedKey, sectionKey)) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether a key matches a scope key or any descendant of it.
 * Does not mutate or normalize keys.
 */
export function isScopeOrDescendantKey(key, scopeKey) {
  if (!key || !scopeKey) return false;
  return key === scopeKey || isDescendantKey(key, scopeKey);
}

