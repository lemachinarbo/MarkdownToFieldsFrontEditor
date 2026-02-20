function findMatchingClosingTag(html, offset, tag) {
  const pattern = new RegExp(`<\\s*\\/?\\s*${tag}\\b[^>]*>`, "i");
  let depth = 1;
  let pos = offset;
  while (true) {
    const match = pattern.exec(html.slice(pos));
    if (!match) return null;
    const token = match[0];
    const tokenPos = pos + match.index;
    pos = tokenPos + token.length;
    const isClosing = /^<\s*\//i.test(token);
    const isSelfClosing = /\/\s*>$/.test(token);
    if (isClosing) {
      depth -= 1;
      if (depth === 0) return tokenPos;
      continue;
    }
    if (!isSelfClosing) depth += 1;
  }
}

function findDataMfeHostRange(html, dataMfeValue) {
  const value = (dataMfeValue || "").trim();
  if (!value) return null;
  const pattern = new RegExp(
    `<([a-z0-9]+)\\b[^>]*\\bdata-mfe="${value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) return null;
  const tag = String(match[1] || "").toLowerCase();
  const start = match.index;
  const openEnd = start + match[0].length;
  const closeStart = findMatchingClosingTag(html, openEnd, tag);
  if (closeStart === null) return null;
  return { start: openEnd, end: closeStart };
}

function replaceFirstMatchInRange(html, needle, replacement, start, end) {
  if (end <= start) return null;
  const segment = html.slice(start, end);
  const count = segment.split(needle).length - 1;
  if (count !== 1) return null;
  const pos = segment.indexOf(needle);
  if (pos === -1) return null;
  const absolute = start + pos;
  return (
    html.slice(0, absolute) + replacement + html.slice(absolute + needle.length)
  );
}

function replaceFirstScopedHtmlMatch(html, needle, replacement, scopeKey) {
  if (!needle) return html;
  const range = findDataMfeHostRange(html, scopeKey);
  if (range) {
    const replaced = replaceFirstMatchInRange(
      html,
      needle,
      replacement,
      range.start,
      range.end,
    );
    if (replaced !== null) return replaced;
  }
  const count = html.split(needle).length - 1;
  if (count === 1) {
    const pos = html.indexOf(needle);
    if (pos !== -1) {
      return html.slice(0, pos) + replacement + html.slice(pos + needle.length);
    }
  }
  return html;
}

function getHostInnerHtml(html, scopeKey) {
  const range = findDataMfeHostRange(html, scopeKey);
  if (!range) return "";
  return html.slice(range.start, range.end);
}

describe("Auto-wrap scoping with repeated content", () => {
  test("wraps only inside matching subsection host when list repeats", () => {
    const listHtml = "<ul><li>A</li><li>B</li></ul>";
    const html = `
<section data-mfe="columns">
  <div data-mfe="columns/left">${listHtml}</div>
  <div data-mfe="columns/right">${listHtml}</div>
</section>`;
    const wrapper = `<div class="fe-editable">${listHtml}</div>`;
    const updated = replaceFirstScopedHtmlMatch(
      html,
      listHtml,
      wrapper,
      "columns/right",
    );
    const left = getHostInnerHtml(updated, "columns/left");
    const right = getHostInnerHtml(updated, "columns/right");
    expect(left).toContain(listHtml);
    expect(left).not.toContain("fe-editable");
    expect(right).toContain("fe-editable");
  });

  test("does not wrap when section scope contains duplicates", () => {
    const listHtml = "<ul><li>A</li><li>B</li></ul>";
    const html = `
<section data-mfe="columns">
  <div data-mfe="columns/left">${listHtml}</div>
  <div data-mfe="columns/right">${listHtml}</div>
</section>`;
    const wrapper = `<div class="fe-editable">${listHtml}</div>`;
    const updated = replaceFirstScopedHtmlMatch(
      html,
      listHtml,
      wrapper,
      "columns",
    );
    expect(updated).toBe(html);
  });

  test("section scoping wins when duplicate exists outside", () => {
    const content = "<p>Same text</p>";
    const html = `
<section data-mfe="hero">
  ${content}
</section>
<section data-mfe="body">
  ${content}
</section>`;
    const wrapper = `<div class="fe-editable">${content}</div>`;
    const updated = replaceFirstScopedHtmlMatch(html, content, wrapper, "hero");
    const hero = getHostInnerHtml(updated, "hero");
    const body = getHostInnerHtml(updated, "body");
    expect(hero).toContain("fe-editable");
    expect(body).not.toContain("fe-editable");
  });

  test("container scoping wins when duplicate exists outside", () => {
    const content = "<p>Repeat me</p>";
    const html = `
<div data-mfe="hero/intro">${content}</div>
<div data-mfe="hero">${content}</div>`;
    const wrapper = `<div class="fe-editable">${content}</div>`;
    const updated = replaceFirstScopedHtmlMatch(
      html,
      content,
      wrapper,
      "hero/intro",
    );
    const intro = getHostInnerHtml(updated, "hero/intro");
    const hero = getHostInnerHtml(updated, "hero");
    expect(intro).toContain("fe-editable");
    expect(hero).not.toContain("fe-editable");
  });

  test("skips when no scope and duplicates exist", () => {
    const item = "<p>Repeat</p>";
    const html = `<div>${item}</div><div>${item}</div>`;
    const wrapper = `<div class="fe-editable">${item}</div>`;
    const updated = replaceFirstScopedHtmlMatch(html, item, wrapper, "");
    expect(updated).toBe(html);
  });

  test("wraps when single match and no scope", () => {
    const item = "<p>Once</p>";
    const html = `<div>${item}</div>`;
    const wrapper = `<div class="fe-editable">${item}</div>`;
    const updated = replaceFirstScopedHtmlMatch(html, item, wrapper, "");
    expect(updated).toContain("fe-editable");
  });
});
