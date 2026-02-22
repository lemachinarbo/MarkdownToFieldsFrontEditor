function detectMarkdownLineEnding(markdown) {
  if (markdown.includes("\r\n")) return "\r\n";
  if (markdown.includes("\r")) return "\r";
  return "\n";
}

function preserveMarkdownFormattingFromOriginal(oldMarkdown, newMarkdown) {
  const oldNl = detectMarkdownLineEnding(oldMarkdown);
  const oldLines = oldMarkdown.replace(/\r\n|\r/g, "\n").split("\n");
  const newLines = newMarkdown.replace(/\r\n|\r/g, "\n").split("\n");

  const listLinePattern = /^([ \t]{0,3})([*+-])(\s+)(.*)$/;

  const count = Math.min(oldLines.length, newLines.length);
  for (let i = 0; i < count; i += 1) {
    const oldMatch = oldLines[i].match(listLinePattern);
    const newMatch = newLines[i].match(listLinePattern);
    if (oldMatch && newMatch) {
      newLines[i] = `${oldMatch[1]}${oldMatch[2]}${oldMatch[3]}${newMatch[4]}`;
    }
  }

  const oldMarkers = [];
  oldLines.forEach((line) => {
    const match = line.match(listLinePattern);
    if (match) oldMarkers.push(match[2]);
  });

  const uniqueOldMarkers = [...new Set(oldMarkers)];
  if (uniqueOldMarkers.length === 1) {
    const preferredMarker = uniqueOldMarkers[0];
    for (let i = 0; i < newLines.length; i += 1) {
      const match = newLines[i].match(listLinePattern);
      if (match) {
        newLines[i] = `${match[1]}${preferredMarker}${match[3]}${match[4]}`;
      }
    }
  }

  const separatedLines = [];
  for (let i = 0; i < newLines.length; i += 1) {
    separatedLines.push(newLines[i]);
    if (i >= newLines.length - 1) continue;

    const currentMatch = newLines[i].match(listLinePattern);
    const nextMatch = newLines[i + 1].match(listLinePattern);
    if (currentMatch && nextMatch && currentMatch[2] !== nextMatch[2]) {
      separatedLines.push("");
    }
  }

  let joined = separatedLines.join("\n");
  if (oldNl !== "\n") {
    joined = joined.replace(/\n/g, oldNl);
  }
  return joined;
}

describe("Extreme markdown preservation regression", () => {
  test("keeps two list blocks separated when markers change", () => {
    const oldMarkdown = [
      "<!-- intro... -->",
      "- One",
      "- Two",
      "- Three",
      "",
      "* Four",
      "* Five",
      "",
    ].join("\n");

    const newMarkdown = [
      "<!-- intro... -->",
      "- One updated",
      "- Two",
      "- Three",
      "* Four updated",
      "* Five",
      "",
    ].join("\n");

    const result = preserveMarkdownFormattingFromOriginal(
      oldMarkdown,
      newMarkdown,
    );

    expect(result).toContain("- Three\n\n* Four updated");
    expect(result).not.toContain("- Three\n* Four updated");
  });

  test("preserves consistent old unordered marker style", () => {
    const oldMarkdown = ["* A", "* B", "* C"].join("\n");
    const newMarkdown = ["- A new", "- B", "- C"].join("\n");

    const result = preserveMarkdownFormattingFromOriginal(
      oldMarkdown,
      newMarkdown,
    );
    expect(result).toBe(["* A new", "* B", "* C"].join("\n"));
  });

  test("preserves old CRLF line endings", () => {
    const oldMarkdown = "<!-- intro... -->\r\n- A\r\n- B\r\n";
    const newMarkdown = "<!-- intro... -->\n- A changed\n- B\n";

    const result = preserveMarkdownFormattingFromOriginal(
      oldMarkdown,
      newMarkdown,
    );
    expect(result.includes("\r\n")).toBe(true);
    expect(result.includes("\n") && !result.includes("\r\n")).toBe(false);
  });

  test("does not mutate marker comments, section and subsection boundaries", () => {
    const oldMarkdown = [
      "<!-- containers... -->",
      "<!-- section:foo -->",
      "",
      "<!-- sub:foo -->",
      "",
      "<!-- intro... -->",
      "- item A",
      "- item B",
    ].join("\n");

    const newMarkdown = [
      "<!-- containers... -->",
      "<!-- section:foo -->",
      "",
      "<!-- sub:foo -->",
      "",
      "<!-- intro... -->",
      "- item A updated",
      "- item B",
    ].join("\n");

    const result = preserveMarkdownFormattingFromOriginal(
      oldMarkdown,
      newMarkdown,
    );
    expect(result).toContain("<!-- containers... -->");
    expect(result).toContain("<!-- section:foo -->");
    expect(result).toContain("<!-- sub:foo -->");
    expect(result).toContain("<!-- intro... -->");
  });

  test("extreme mixed markdown stays structurally stable and idempotent", () => {
    const oldMarkdown = [
      "<!-- containers... -->",
      "<!-- section:foo -->",
      "",
      "<!-- sub:foo -->",
      "",
      "<!-- intro... -->",
      "# Heading title",
      "",
      "Paragraph with <em>inline html</em> and **markdown**.",
      "",
      "> Quote line one",
      "> Quote line two",
      "",
      "1. Ordered one",
      "2. Ordered two",
      "",
      "- Bullet one",
      "- Bullet two",
      "",
      "* Legacy bullet one",
      "* Legacy bullet two",
      "",
      '![alt text](image one.jpg "title")',
      "",
      '<div class="custom">User HTML block</div>',
      "",
      "```html",
      '<section data-test="1">x</section>',
      "```",
      "",
    ].join("\n");

    const newMarkdown = [
      "<!-- containers... -->",
      "<!-- section:foo -->",
      "",
      "<!-- sub:foo -->",
      "",
      "<!-- intro... -->",
      "# Heading title changed",
      "",
      "Paragraph with <strong>inline html changed</strong> and **markdown**.",
      "",
      "> Quote line one changed",
      "> Quote line two",
      "",
      "1. Ordered one changed",
      "2. Ordered two",
      "",
      "- Bullet one changed",
      "- Bullet two",
      "* Legacy bullet one changed",
      "* Legacy bullet two",
      "",
      '![alt text](image-two.jpg "title")',
      "",
      '<div class="custom">User HTML block changed</div>',
      "",
      "```html",
      '<section data-test="2">y</section>',
      "```",
      "",
    ].join("\n");

    const once = preserveMarkdownFormattingFromOriginal(
      oldMarkdown,
      newMarkdown,
    );
    const twice = preserveMarkdownFormattingFromOriginal(oldMarkdown, once);

    expect(once).toContain("<!-- section:foo -->");
    expect(once).toContain("<!-- sub:foo -->");
    expect(once).toContain("# Heading title changed");
    expect(once).toContain('<div class="custom">User HTML block changed</div>');
    expect(once).toContain('![alt text](image-two.jpg "title")');

    expect(once).toContain("- Bullet two\n\n* Legacy bullet one changed");
    expect(once).toEqual(twice);
  });
});
