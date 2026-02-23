function splitLeadingFrontmatter(markdown) {
  const match = markdown.match(
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
  );
  if (!match) return { frontmatter: "", body: markdown };
  return {
    frontmatter: match[0],
    body: markdown.slice(match[0].length),
  };
}

function preserveMarkerSpacingFromOriginal(oldMarkdown, newMarkdown) {
  const oldLines = oldMarkdown.replace(/\r\n|\r/g, "\n").split("\n");
  const newLines = newMarkdown.replace(/\r\n|\r/g, "\n").split("\n");
  const markerLinePattern = /^<!--\s*[^>]+-->$/;

  const oldMarkerSpacing = new Map();
  for (let index = 0; index < oldLines.length; index += 1) {
    const marker = oldLines[index].trim();
    if (!markerLinePattern.test(marker)) continue;

    let before = 0;
    for (let j = index - 1; j >= 0; j -= 1) {
      if (oldLines[j].trim() !== "") break;
      before += 1;
    }

    let after = 0;
    for (let j = index + 1; j < oldLines.length; j += 1) {
      if (oldLines[j].trim() !== "") break;
      after += 1;
    }

    if (!oldMarkerSpacing.has(marker)) oldMarkerSpacing.set(marker, []);
    oldMarkerSpacing.get(marker).push({ before, after });
  }

  const markerSeen = new Map();
  for (let index = 0; index < newLines.length; index += 1) {
    const marker = newLines[index].trim();
    if (!markerLinePattern.test(marker)) continue;

    const occurrence = markerSeen.get(marker) || 0;
    markerSeen.set(marker, occurrence + 1);

    const target = oldMarkerSpacing.get(marker)?.[occurrence];
    if (!target) continue;

    let before = 0;
    for (let j = index - 1; j >= 0; j -= 1) {
      if (newLines[j].trim() !== "") break;
      before += 1;
    }

    if (before < target.before) {
      const add = target.before - before;
      newLines.splice(index, 0, ...new Array(add).fill(""));
      index += add;
    } else if (before > target.before) {
      const remove = before - target.before;
      newLines.splice(index - before, remove);
      index -= remove;
    }

    let after = 0;
    for (let j = index + 1; j < newLines.length; j += 1) {
      if (newLines[j].trim() !== "") break;
      after += 1;
    }

    if (after < target.after) {
      const add = target.after - after;
      newLines.splice(index + 1, 0, ...new Array(add).fill(""));
    } else if (after > target.after) {
      const remove = after - target.after;
      newLines.splice(index + 1, remove);
    }
  }

  return newLines.join("\n");
}

function applyDocumentSavePreserve(oldDocument, incomingDocumentMarkdown) {
  const oldSplit = splitLeadingFrontmatter(oldDocument);
  const newSplit = splitLeadingFrontmatter(incomingDocumentMarkdown);
  const bodyPreserved = preserveMarkerSpacingFromOriginal(
    oldSplit.body,
    newSplit.body,
  );
  if (!newSplit.frontmatter && oldSplit.frontmatter) {
    return `${oldSplit.frontmatter}${bodyPreserved}`;
  }
  return preserveMarkerSpacingFromOriginal(
    oldDocument,
    incomingDocumentMarkdown,
  );
}

describe("Document frontmatter + spacing preservation", () => {
  test("preserves frontmatter when incoming document body has no frontmatter", () => {
    const original = [
      "---",
      "title: The Urban Farm Studio. ",
      "name: price: USD 200",
      "---",
      "",
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# Test asas <br> Holas",
      "",
    ].join("\n");

    const incomingBodyOnly = [
      "<!-- section:hero -->",
      "<!-- title -->",
      "# Test asas <br> UPDATE",
      "",
    ].join("\n");

    const result = applyDocumentSavePreserve(original, incomingBodyOnly);

    expect(result.startsWith("---\ntitle: The Urban Farm Studio.")).toBe(true);
    expect(result).toContain("# Test asas <br> UPDATE");
    expect(result).toContain("<!-- section:hero -->");
  });

  test("preserves frontmatter for both BOM and non-BOM documents", () => {
    const originalNoBom = [
      "---",
      "title: A",
      "---",
      "",
      "<!-- section:hero -->",
      "# X",
    ].join("\n");

    const originalBom = `\uFEFF${originalNoBom}`;
    const incomingBodyOnly = ["<!-- section:hero -->", "# Y"].join("\n");

    const noBomResult = applyDocumentSavePreserve(
      originalNoBom,
      incomingBodyOnly,
    );
    const bomResult = applyDocumentSavePreserve(originalBom, incomingBodyOnly);

    expect(noBomResult.startsWith("---\ntitle: A\n---")).toBe(true);
    expect(bomResult.startsWith("\uFEFF---\ntitle: A\n---")).toBe(true);
  });

  test("keeps marker spacing from incoming body content", () => {
    const original = [
      "---",
      "title: T",
      "---",
      "",
      "<!-- section:hero -->",
      "",
      "<!-- intro... -->",
      "```",
      "Hello",
      "",
      "```",
      "",
      "Hola",
    ].join("\n");

    const incomingBodyOnly = [
      "<!-- section:hero -->",
      "",
      "<!-- intro... -->",
      "```",
      "Hello",
      "",
      "",
      "```",
      "",
      "Hola",
      "",
      "Amigo",
    ].join("\n");

    const result = applyDocumentSavePreserve(original, incomingBodyOnly);

    expect(result).toContain("<!-- intro... -->\n```\nHello\n\n\n```\n\nHola");
    expect(result).toContain("\n\nAmigo");
  });

  test("restores blank lines around section/title markers after one-word edit", () => {
    const original = [
      "---",
      "title: The Urban Farm Studio. ",
      "name: price: USD 200",
      "---",
      "",
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# Test asas <br> Holas",
      "",
      "<!-- intro... -->",
      "```",
      "Hello",
      "",
      "```",
      "",
      "This is an example.",
    ].join("\n");

    const incomingAfterEdit = [
      "<!-- section:hero -->",
      "<!-- title -->",
      "# Test asas <br> Holass",
      "",
      "<!-- intro... -->",
      "```",
      "Hello",
      "",
      "",
      "```",
      "",
      "This is an example.",
    ].join("\n");

    const result = applyDocumentSavePreserve(original, incomingAfterEdit);

    expect(result).toContain("---\ntitle: The Urban Farm Studio. ");
    expect(result).toContain("<!-- section:hero -->\n\n<!-- title -->");
    expect(result).toContain("# Test asas <br> Holass");
    expect(result).toContain(
      "<!-- title -->\n# Test asas <br> Holass\n\n<!-- intro... -->",
    );
  });
});
