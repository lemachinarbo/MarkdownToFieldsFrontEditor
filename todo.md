# Editor north star

Rule: never trade determinism for convenience, even for “temporary” fixes.
- Protect architecture quality as features grow. 
Priorities:
- Invariant guards at every identity boundary
- Zero heuristic fallbacks, always deterministic resolution
- Markdown source is the single source of truth, never mutated by the editor


# Todo

# Features
- Implement a Notion-like editor.
- Image picker:
  - How it sort the images?
  - Add a search bar to find images by name.
  - Add sorter (date, name, size, folder is a sort option)
- Add Draft feature
- Add internal linking
- Connect snapshots with markComitter https://tiptap.dev/docs/editor/extensions/functionality/snapshot
- Drag handle support https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-react
- Paste markdown
