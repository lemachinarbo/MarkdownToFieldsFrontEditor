import { parseOriginScopeMeta } from "../src/scope-slice.js";

describe("scope-slice origin key parsing", () => {
  test("parses subsection origin key with page prefix", () => {
    const meta = parseOriginScopeMeta("1:subsection:columns:right");
    expect(meta).toEqual({
      scopeKind: "subsection",
      section: "columns",
      subsection: "right",
      name: "right",
    });
  });

  test("parses field origin key with page prefix", () => {
    const meta = parseOriginScopeMeta("1:field:hero:title");
    expect(meta).toEqual({
      scopeKind: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });
  });
});
