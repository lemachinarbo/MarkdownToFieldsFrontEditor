import { createInlineStateAdapter } from "../src/inline-state-adapter.js";

describe("inline state adapter", () => {
  test("stores and resolves scope metadata and field elements", () => {
    const adapter = createInlineStateAdapter();
    const element = { id: "host" };

    adapter.setScopeMeta("field:hero::title", {
      fieldId: "1|field|hero|title",
      pageId: "1",
      scope: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });
    adapter.setFieldElement("1|field|hero|title", element);

    expect(adapter.getScopeMeta("field:hero::title")).toEqual({
      fieldId: "1|field|hero|title",
      pageId: "1",
      scope: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });
    expect(adapter.getFieldElement("1|field|hero|title")).toBe(element);
  });

  test("manages draft lifecycle deterministically", () => {
    const adapter = createInlineStateAdapter();

    adapter.setDraft("field:hero::title", { type: "doc" });
    adapter.setDraftMarkdown("field:hero::title", "Hello");
    adapter.setDraftMarkdown("field:hero::subtitle", "World");

    expect(adapter.hasDraft("field:hero::title")).toBe(true);
    expect(adapter.getDraftMarkdownSize()).toBe(2);
    expect(adapter.getDraftMarkdownEntries()).toEqual([
      ["field:hero::title", "Hello"],
      ["field:hero::subtitle", "World"],
    ]);

    adapter.deleteDraft("field:hero::title");
    expect(adapter.hasDraft("field:hero::title")).toBe(false);
    expect(adapter.getDraftMarkdownSize()).toBe(1);

    adapter.clearDrafts();
    expect(adapter.getDraftMarkdownSize()).toBe(0);
  });
});
