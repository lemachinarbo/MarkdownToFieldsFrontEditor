import { decodeMarkdownBase64 } from "./editor-core.js";
import { getMetaAttr } from "./editor-shared-helpers.js";
import { getFieldsIndex } from "./content-index.js";

function annotateEditableImages(root = document) {
  root.querySelectorAll(".fe-editable").forEach((el) => {
    const scope = getMetaAttr(el, "scope") || "field";
    const section = getMetaAttr(el, "section") || "";
    const subsection = getMetaAttr(el, "subsection") || "";
    const name = getMetaAttr(el, "name") || "";
    const pageId = el.getAttribute("data-page") || "";

    el.querySelectorAll("img").forEach((img) => {
      img.setAttribute("data-mfe-image-bound", "1");
      img.setAttribute("data-mfe-image-scope", scope);
      img.setAttribute("data-mfe-image-section", section);
      img.setAttribute("data-mfe-image-subsection", subsection);
      img.setAttribute("data-mfe-image-name", name);
      img.setAttribute("data-mfe-image-page", pageId);
    });
  });
}

function annotateMfeHostImages(root = document) {
  root.querySelectorAll("[data-mfe]").forEach((host) => {
    const hostValue = host.getAttribute("data-mfe") || "";
    if (!hostValue) return;
    host.querySelectorAll("img").forEach((img) => {
      if (img.getAttribute("data-mfe-image-bound") === "1") return;
      img.setAttribute("data-mfe-image-bound", "1");
      img.setAttribute("data-mfe-image-host", hostValue);
    });
  });
}

function getImageBasename(src) {
  const value = (src || "").split("?")[0].split("#")[0];
  const parts = value.split("/");
  return parts[parts.length - 1] || "";
}

function getImageMatchKey(src) {
  const base = getImageBasename(src).toLowerCase();
  if (!base) return "";
  const extIdx = base.lastIndexOf(".");
  const stem = extIdx > 0 ? base.slice(0, extIdx) : base;
  return stem.replace(/\.\d+x\d+(?:-srcset)?$/i, "");
}

function extractMarkdownImageSrc(markdown) {
  const m = (markdown || "").match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  return m?.[1] || "";
}

function annotateInferredImages(root = document) {
  const fields = getFieldsIndex();
  if (!fields.length) return;

  const imageFields = fields
    .map((f) => {
      const markdown = f?.markdownB64 ? decodeMarkdownBase64(f.markdownB64) : "";
      const src = extractMarkdownImageSrc(markdown);
      const key = getImageMatchKey(src);
      if (!src || !key) return null;
      return {
        scope: "field",
        section: f?.section || "",
        subsection: f?.subsection || "",
        name: f?.name || "",
        key,
      };
    })
    .filter(Boolean);

  if (!imageFields.length) return;

  root.querySelectorAll("img").forEach((img) => {
    if (img.getAttribute("data-mfe-image-bound") === "1") return;
    const key = getImageMatchKey(img.getAttribute("src") || "");
    if (!key) return;
    const matches = imageFields.filter((f) => f.key === key);
    if (matches.length !== 1) return;
    const match = matches[0];
    img.setAttribute("data-mfe-image-bound", "1");
    img.setAttribute("data-mfe-image-scope", match.scope);
    img.setAttribute("data-mfe-image-section", match.section);
    img.setAttribute("data-mfe-image-subsection", match.subsection);
    img.setAttribute("data-mfe-image-name", match.name);
    img.setAttribute("data-mfe-image-inferred", "1");
  });
}

function normalizeHtmlImageSources(html, { resolveImageSrc } = {}) {
  if (!html || typeof html !== "string") return html || "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (!src) return;
      const resolved =
        typeof resolveImageSrc === "function" ? resolveImageSrc(src) : src;
      img.setAttribute("src", resolved || src);
    });
    return doc.body.innerHTML || html;
  } catch (_e) {
    return html;
  }
}

export {
  annotateEditableImages,
  annotateMfeHostImages,
  annotateInferredImages,
  normalizeHtmlImageSources,
};
