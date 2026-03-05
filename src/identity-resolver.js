function splitPath(value) {
  return (value || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function parseDataMfe(value) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.startsWith("field:")) {
    const parts = splitPath(raw.slice(6));
    if (parts.length === 1) {
      return { scope: "field", name: parts[0], section: "", subsection: "" };
    }
    if (parts.length === 2) {
      return {
        scope: "field",
        section: parts[0],
        name: parts[1],
        subsection: "",
      };
    }
    if (parts.length >= 3) {
      return {
        scope: "field",
        section: parts[0],
        subsection: parts[1],
        name: parts[2],
      };
    }
    return null;
  }

  if (lower.startsWith("section:")) {
    const parts = splitPath(raw.slice(8));
    if (!parts.length) return null;
    return { scope: "section", name: parts[0], section: "" };
  }

  if (lower.startsWith("sub:") || lower.startsWith("subsection:")) {
    const path = lower.startsWith("sub:") ? raw.slice(4) : raw.slice(11);
    const parts = splitPath(path.replace(/:/g, "/"));
    if (parts.length < 2) return null;
    return { scope: "subsection", section: parts[0], name: parts[1] };
  }

  const pathParts = splitPath(raw);
  if (pathParts.length === 2) {
    return {
      scope: "auto",
      section: pathParts[0],
      name: pathParts[1],
      subsection: "",
    };
  }
  if (pathParts.length >= 3) {
    return {
      scope: "field",
      section: pathParts[0],
      subsection: pathParts[1],
      name: pathParts[2],
    };
  }

  const legacy = raw
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean);
  if (legacy.length === 1) {
    return { scope: "auto", name: legacy[0], section: "", subsection: "" };
  }
  if (legacy.length >= 2) {
    return { scope: "subsection", section: legacy[0], name: legacy[1] };
  }
  return null;
}

export function resolveDataMfeCandidates(rawValue, lookup) {
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
  } = lookup || {};

  if (pathParts.length === 1) {
    const a = pathParts[0];
    if (sectionNames?.has(a)) out.add(`section:${a}`);
    if (fieldTopLevelNames?.has(a)) out.add(`field:${a}`);
    return Array.from(out);
  }
  if (pathParts.length === 2) {
    const [a, b] = pathParts;
    const subKey = `${a}/${b}`;
    const fieldKey = `${a}/${b}`;
    if (subsectionKeys?.has(subKey)) out.add(`subsection:${a}:${b}`);
    if (fieldSectionKeys?.has(fieldKey)) out.add(`field:${a}:${b}`);
    return Array.from(out);
  }
  if (pathParts.length >= 3) {
    const [a, b, c] = pathParts;
    const fieldSubKey = `${a}/${b}/${c}`;
    if (fieldSubsectionKeys?.has(fieldSubKey))
      out.add(`subsection:${a}:${b}:${c}`);
    return Array.from(out);
  }
  return Array.from(out);
}

export function inferContextFromAncestors(host, lookup) {
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

export function resolveDataMfeCandidatesWithContext(rawValue, host, lookup) {
  const direct = resolveDataMfeCandidates(rawValue, lookup);
  if (direct.length) return direct;

  const raw = (rawValue || "").trim();
  if (!raw) return [];
  const parts = splitPath(raw.replace(/:/g, "/"));
  if (!parts.length) return [];

  const ctx = inferContextFromAncestors(host, lookup);
  if (!ctx?.section) return [];

  const { fieldSectionKeys, fieldSubsectionKeys } = lookup || {};
  const out = new Set();

  if (parts.length === 1) {
    const name = parts[0];
    if (ctx.subsection) {
      const subKey = `${ctx.section}/${ctx.subsection}/${name}`;
      if (fieldSubsectionKeys?.has(subKey)) {
        out.add(`subsection:${ctx.section}:${ctx.subsection}:${name}`);
      }
    }
    const secKey = `${ctx.section}/${name}`;
    if (fieldSectionKeys?.has(secKey)) {
      out.add(`field:${ctx.section}:${name}`);
    }
    return Array.from(out);
  }

  if (parts.length === 2) {
    const [a, b] = parts;
    const subKey = `${ctx.section}/${a}/${b}`;
    if (fieldSubsectionKeys?.has(subKey)) {
      out.add(`subsection:${ctx.section}:${a}:${b}`);
    }
  }

  return Array.from(out);
}

export function resolveDataMfeKeyWithContext(rawValue, host, lookup) {
  const candidates = resolveDataMfeCandidatesWithContext(
    rawValue,
    host,
    lookup,
  );
  return candidates.length === 1 ? candidates[0] : "";
}
