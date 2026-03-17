import { getHostConfig } from "./host-env.js";

function parseAnchorHtml(markup) {
  const container = document.createElement("div");
  container.innerHTML = String(markup || "");
  return container.querySelector("a");
}

function normalizeAdminUrl(adminUrl) {
  const value = String(adminUrl || "").trim();
  if (!value) {
    return "";
  }

  const base = window.location?.origin || window.location?.href || "";
  return new URL(value, base).toString();
}

function resolvePickerLanguageId(language, cfg) {
  const requested = String(language || "").trim();
  if (/^\d+$/.test(requested)) {
    return requested;
  }

  const languages = Array.isArray(cfg?.languages) ? cfg.languages : [];
  const match = languages.find(
    (item) => String(item?.name || "").trim() === requested,
  );
  const id = String(match?.id || "").trim();
  return /^\d+$/.test(id) && id !== "0" ? id : "";
}

function buildPickerUrl({ adminUrl, pageId, language, href, cfg }) {
  const url = new URL("page/link/", normalizeAdminUrl(adminUrl));
  url.searchParams.set("modal", "1");
  url.searchParams.set("id", String(pageId || "0"));
  const langId = resolvePickerLanguageId(language, cfg);
  if (langId) {
    url.searchParams.set("lang", langId);
  }
  if (href) {
    url.searchParams.set("href", String(href));
  }
  return url.toString();
}

export function openPageLinkPicker({ currentHref = "", language = "" } = {}) {
  const cfg = getHostConfig();
  const adminUrl = String(cfg.adminUrl || "").trim();
  const pageId = String(cfg.pageId || "0");

  if (!adminUrl || !pageId || pageId === "0") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "mfe-link-picker";

    const dialog = document.createElement("div");
    dialog.className = "mfe-link-picker__dialog";

    const header = document.createElement("div");
    header.className = "mfe-link-picker__header";
    header.textContent = "Choose link";

    const body = document.createElement("div");
    body.className = "mfe-link-picker__body";

    const iframe = document.createElement("iframe");
    iframe.className = "mfe-link-picker__frame";
    iframe.src = buildPickerUrl({
      adminUrl,
      pageId,
      language: language || cfg.currentLanguage || "",
      href: currentHref,
      cfg,
    });

    const footer = document.createElement("div");
    footer.className = "mfe-link-picker__footer";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className =
      "mfe-link-picker__button mfe-link-picker__button--secondary";
    cancelButton.textContent = "Cancel";

    const insertButton = document.createElement("button");
    insertButton.type = "button";
    insertButton.className = "mfe-link-picker__button";
    insertButton.textContent = "Insert";

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    function readResult() {
      const iframeDocument = iframe.contentWindow?.document;
      if (!iframeDocument) return null;

      const markup = iframeDocument.querySelector("#link_markup")?.textContent || "";
      const anchor = parseAnchorHtml(markup);
      const href = String(anchor?.getAttribute("href") || "").trim();
      if (!href) {
        return null;
      }

      const selectedPageId = String(
        iframeDocument.querySelector("#link_page_id")?.value || "",
      ).trim();

      return {
        href,
        pageId: selectedPageId !== "" && selectedPageId !== "0" ? selectedPageId : "",
        pageLang: String(language || cfg.currentLanguage || "").trim(),
      };
    }

    cancelButton.addEventListener("click", () => cleanup(null));
    insertButton.addEventListener("click", () => cleanup(readResult()));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        cleanup(null);
      }
    });

    iframe.addEventListener("load", () => {
      const iframeDocument = iframe.contentWindow?.document;
      const urlInput = iframeDocument?.querySelector("#link_page_url_input");
      if (!urlInput) return;
      urlInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const value = String(urlInput.value || "").trim();
        if (!value) return;
        event.preventDefault();
        cleanup(readResult());
      });
    });

    footer.appendChild(cancelButton);
    footer.appendChild(insertButton);
    body.appendChild(iframe);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

export async function applyPickedLinkToEditor(editor, options = {}) {
  if (!editor) return;

  const previousAttrs = editor.getAttributes("link") || {};
  const previousHref = String(previousAttrs.href || "");
  const picked = await openPageLinkPicker({
    currentHref: previousHref,
    language: options.language || previousAttrs.pageLang || "",
  });

  if (picked === null) {
    return;
  }

  if (typeof options.markUserIntentToken === "function") {
    options.markUserIntentToken("link-picker:select");
  }

  if (!picked.href || String(picked.href).trim() === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }

  editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({
      href: picked.href,
      pageId: picked.pageId || null,
      pageLang: picked.pageLang || null,
    })
    .run();
}
