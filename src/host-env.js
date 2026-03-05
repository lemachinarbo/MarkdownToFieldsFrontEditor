const CONFIG_KEY = "MarkdownFrontEditorConfig";
let cachedHostEnv = null;

function isConfigObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getHostWindowOptional() {
  if (typeof window === "undefined" || window === null) return null;
  return window;
}

export function getHostWindow() {
  const hostWindow = getHostWindowOptional();
  if (!hostWindow) {
    throw new Error("[mfe] host runtime window is unavailable.");
  }
  return hostWindow;
}

export function getHostApiOptional(apiName) {
  const hostWindow = getHostWindowOptional();
  if (!hostWindow) return null;
  const api = hostWindow[apiName];
  return api && typeof api === "object" ? api : null;
}

export function getHostApi(apiName, requiredMethods = []) {
  const api = getHostApiOptional(apiName);
  if (!api) {
    throw new Error(`[mfe] host API "${apiName}" is unavailable.`);
  }
  requiredMethods.forEach((method) => {
    if (typeof api[method] !== "function") {
      throw new Error(
        `[mfe] host API "${apiName}" is missing method "${method}".`,
      );
    }
  });
  return api;
}

function getHostConfigOptional() {
  const hostWindow = getHostWindowOptional();
  if (!hostWindow) return null;
  const cfg = hostWindow[CONFIG_KEY];
  if (cfg == null) return null;
  if (!isConfigObject(cfg)) {
    throw new Error("[mfe] host config MarkdownFrontEditorConfig is invalid.");
  }
  return cfg;
}

export function getHostConfig() {
  const cfg = getHostConfigOptional();
  if (!cfg) {
    throw new Error("[mfe] host config MarkdownFrontEditorConfig is required.");
  }
  return cfg;
}

export function ensureHostConfigObject() {
  const hostWindow = getHostWindow();
  const current = hostWindow[CONFIG_KEY];
  if (current == null) {
    hostWindow[CONFIG_KEY] = {};
    return hostWindow[CONFIG_KEY];
  }
  if (!isConfigObject(current)) {
    throw new Error("[mfe] host config MarkdownFrontEditorConfig is invalid.");
  }
  return current;
}

export function isHostFlagEnabled(flagName) {
  const cfg = getHostConfigOptional();
  if (!cfg) return false;
  return cfg[flagName] === true;
}

function readHostLocalStorage(key) {
  const hostWindow = getHostWindowOptional();
  if (!hostWindow) return null;
  try {
    return hostWindow.localStorage?.getItem(key) ?? null;
  } catch (_err) {
    return null;
  }
}

export function initHostEnv() {
  if (cachedHostEnv) return cachedHostEnv;

  const hostWindow = getHostWindowOptional();
  const cfg = getHostConfigOptional() || {};
  const devFromStorage = readHostLocalStorage("mfe-dev") === "1";
  const debugAssertFromStorage = readHostLocalStorage("mfeDebugAssert") === "1";
  const debugLabelsFromStorage = readHostLocalStorage("mfeDebugLabels") === "1";
  const debugClicksFromStorage = readHostLocalStorage("mfeDebugClicks") === "1";
  const devFromWindow = hostWindow?.__MFE_DEV === true;
  const debug = cfg.debug === true;
  const debugShowSections = cfg.debugShowSections === true;
  const debugAssert = cfg.debugAssert === true;

  cachedHostEnv = Object.freeze({
    devMode: devFromWindow || devFromStorage,
    debug,
    debugShowSections,
    debugAssert:
      debugAssert ||
      debug ||
      debugShowSections ||
      devFromWindow ||
      devFromStorage ||
      debugAssertFromStorage,
    debugLabels: cfg.debugLabels === true || debugLabelsFromStorage,
    debugClicks: debugClicksFromStorage,
  });

  return cachedHostEnv;
}

export function isHostDevMode() {
  const hostWindow = getHostWindowOptional();
  if (!hostWindow) return false;
  return hostWindow.__MFE_DEV === true || readHostLocalStorage("mfe-dev") === "1";
}

export function isHostDebugAssertEnabled() {
  return (
    isHostFlagEnabled("debugAssert") ||
    isHostFlagEnabled("debug") ||
    isHostFlagEnabled("debugShowSections") ||
    isHostDevMode() ||
    readHostLocalStorage("mfeDebugAssert") === "1"
  );
}

export function isHostDebugLabelsEnabled() {
  return (
    isHostFlagEnabled("debugLabels") ||
    readHostLocalStorage("mfeDebugLabels") === "1"
  );
}

export function isHostDebugClicksEnabled() {
  return readHostLocalStorage("mfeDebugClicks") === "1";
}

export function __resetHostEnvForTests() {
  cachedHostEnv = null;
}
