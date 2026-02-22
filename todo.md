# Editor north star

- Protect architecture quality as features grow. Priorities:
- Invariant guards at every identity boundary
- Zero heuristic fallbacks, always deterministic resolution
- Markdown source is the single source of truth, never mutated by the editor
- Content Map view for structural navigation

Rule: never trade determinism for convenience, even for “temporary” fixes.

# Todo

- Inline editor and fullscreen editor have logic duplicated?




# Features
- Implement a Notion-like editor.
- Image picker:
  - How it sort the images?
  - Add a search bar to find images by name.
  - Add sorter (date, name, size, folder is a sort option)
- Add Draft feature
- Add internal linking
- Image editor
  - First, a simple text replacer.
  - Then, a gallery that selects images from the MarkdownToFields image folder.
- Inline fullpage editing based on https://tiptap.dev/docs/editor/extensions/functionality/pages?
- Connect snapshots with markComitter https://tiptap.dev/docs/editor/extensions/functionality/snapshot
- Drag handle support https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-react
- Paste markdown
- A full-page plan editor, similar to a large Word document, making it easy to view sections and compare translations as a whole.
- Add an edit all document option
- Crazy idea: 

Imagine markdown is
```
<!-- section:hero -->

Foo

<!-- bar -->
Bar
```

And template only renders `hero->bar->html`.

In frontend user will only see Bar, BUT can edit Foo if he goes up to Hero on breadcrumbs, but he will never see it on the frontend, only Bar.

What if... we add a VIEW or something that shows user the exact part that are displayed in the page. Maybe is part of the whole document view? 

So we can add a `Content Map view` mode where the editor shows the full document structure, not just what the template renders. Visible parts appear normal, hidden parts appear dimmed or listed in a tree, so users can navigate and edit sections that exist in the source but aren’t currently rendered on the page. This would map rendered DOM back to canonical content keys, helping users locate invisible content and understand what part of the document they’re editing.
