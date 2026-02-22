# Editor north star

- Protect architecture quality as features grow. Priorities:
- Invariant guards at every identity boundary
- Zero heuristic fallbacks, always deterministic resolution
- Markdown source is the single source of truth, never mutated by the editor
- Content Map view for structural navigation

Rule: never trade determinism for convenience, even for “temporary” fixes.

# Todo


- If user is updating a field, and field is a list they can add new lines and thgat content goes to markdown but maybe user insnt aware.
- If a field is edited inside a section, the mirror doent update. Probably thats ok, but lets investigate  
- Inline editor and fullscreen editor have logic duplicated?

- container fields labels do not appear in the editor
- Implement a Notion-like editor.
- Add an edit all document option
- Why book button gets editable? ius because multiple scrion use the same class or something? markdown using same label?
- If the markdown contains HTML, we keep it as HTML. However, if the user adds styling using the toolbar (such as H1, italic, bold, etc.), we must save it as markdown. For example, italic should be saved as *foo*, not <em>foo>.
- A full-page plan editor, similar to a large Word document, making it easy to view sections and compare translations as a whole.

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


# Features
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