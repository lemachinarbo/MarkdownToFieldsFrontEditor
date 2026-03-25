import { fetchCsrfToken, getSaveUrl } from "./editor-core.js";
import { request } from "./network.js";

function buildUrl(action, params = {}) {
  const base = String(getSaveUrl() || "?markdownFrontEditorSave=1");
  const [path, queryString = ""] = base.split("?");
  const query = new URLSearchParams(queryString);
  query.set("action", action);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    query.set(key, String(value));
  });
  return `${path || ""}?${query.toString()}`;
}

async function assertApiResult(result) {
  if (!result?.ok) {
    throw new Error(`Request failed (${result?.status || "unknown"})`);
  }
  const data = result.data;
  if (!data || typeof data !== "object") {
    throw new Error("Invalid snapshot response");
  }
  if (Number(data.status) !== 1) {
    throw new Error(String(data.error || "Snapshot request failed"));
  }
  return data;
}

async function buildFormData(fields = {}) {
  const formData = new FormData();
  const token = await fetchCsrfToken();
  if (token?.name && token?.value) {
    formData.append(token.name, token.value);
  }
  Object.entries(fields).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    formData.append(key, String(value));
  });
  return formData;
}

export async function listSnapshots({ pageId, lang }) {
  const result = await request(
    buildUrl("snapshotList", {
      pageId,
      lang,
    }),
    {
      method: "GET",
      parse: "json",
    },
  );
  return assertApiResult(result);
}

export async function createSnapshot({
  pageId,
  lang,
  eventType,
  snapshotState,
  label = "",
  content = null,
}) {
  const formData = await buildFormData({
    action: "createSnapshot",
    pageId,
    lang,
    eventType,
    snapshotState,
    label,
    ...(content !== null ? { content } : {}),
  });
  const result = await request(getSaveUrl(), {
    method: "POST",
    body: formData,
    parse: "json",
  });
  return assertApiResult(result);
}

export async function getSnapshotDiff({
  pageId,
  lang,
  snapshotId,
  compare = "current",
}) {
  const result = await request(
    buildUrl("snapshotDiff", {
      pageId,
      lang,
      snapshotId,
      compare,
    }),
    {
      method: "GET",
      parse: "json",
    },
  );
  return assertApiResult(result);
}

export async function checkExternalChange({
  pageId,
  lang,
  knownHash,
  knownMtime = null,
}) {
  const result = await request(
    buildUrl("checkExternalChange", {
      pageId,
      lang,
      knownHash,
      ...(knownMtime !== null ? { knownMtime } : {}),
    }),
    {
      method: "GET",
      parse: "json",
    },
  );
  return assertApiResult(result);
}

export async function restoreSnapshot({ pageId, lang, snapshotId, label = "" }) {
  const formData = await buildFormData({
    action: "restoreSnapshot",
    pageId,
    lang,
    snapshotId,
    label,
  });
  const result = await request(getSaveUrl(), {
    method: "POST",
    body: formData,
    parse: "json",
  });
  return assertApiResult(result);
}

export async function deleteSnapshot({ pageId, lang, snapshotId }) {
  const formData = await buildFormData({
    action: "deleteSnapshot",
    pageId,
    lang,
    snapshotId,
  });
  const result = await request(getSaveUrl(), {
    method: "POST",
    body: formData,
    parse: "json",
  });
  return assertApiResult(result);
}
