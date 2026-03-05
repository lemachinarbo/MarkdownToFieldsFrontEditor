export class NetworkError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "NetworkError";
    if (cause) {
      this.cause = cause;
    }
  }
}

export class ParseError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "ParseError";
    if (cause) {
      this.cause = cause;
    }
  }
}

function parseResponse(response, parse) {
  if (parse === "raw") {
    return Promise.resolve(response);
  }
  if (parse === "text") {
    return response.text();
  }
  if (parse === "json") {
    return response.json().catch((error) => {
      throw new ParseError("Failed to parse JSON response.", error);
    });
  }
  return Promise.reject(new Error(`[mfe] invalid parse mode "${parse}"`));
}

export function request(
  url,
  { method, headers, body, parse, timeout } = {},
) {
  if (!parse) {
    throw new Error("[mfe] request requires parse mode.");
  }

  const controller = typeof AbortController === "function"
    ? new AbortController()
    : null;
  let timeoutId = null;
  if (
    controller &&
    Number.isFinite(timeout) &&
    Number(timeout) > 0 &&
    typeof setTimeout === "function"
  ) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, Number(timeout));
  }

  return fetch(url, {
    method,
    headers,
    body,
    signal: controller ? controller.signal : undefined,
  })
    .catch((error) => {
      throw new NetworkError("Network request failed.", error);
    })
    .then((response) =>
      parseResponse(response, parse).then((data) => ({
        ok: response.ok,
        status: response.status,
        data,
      })),
    )
    .finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    });
}

export function assertOk(result) {
  if (!result?.ok) {
    throw new Error(`Request failed (${result?.status || "unknown"}).`);
  }
  return result;
}

export function getDataOrThrow(result) {
  return assertOk(result).data;
}
