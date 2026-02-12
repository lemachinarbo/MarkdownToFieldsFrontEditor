
# Todo
- container fields labels do not appear in the editor
- Implement a Notion-like editor.
- Add an edit all document option
- when using ->text the rollover appears ons ection, but iof section is100% width height, the rollover can dissapear, maybe the solution is giving options on how to render the rollover, so is visible
- Why book button gets editable? ius because multiple scrion use the same class or something? markdown using same label?
- If the markdown contains HTML, we keep it as HTML. However, if the user adds styling using the toolbar (such as H1, italic, bold, etc.), we must save it as markdown. For example, italic should be saved as *foo*, not <em>foo>.
- A full-page plan editor, similar to a large Word document, making it easy to view sections and compare translations as a whole.

# Features
- Add internal linking
- Image editor
  - First, a simple text replacer.
  - Then, a gallery that selects images from the MarkdownToFields image folder.
- Inline fullpage editing based on https://tiptap.dev/docs/editor/extensions/functionality/pages?
- Connect snapshots with markComitter https://tiptap.dev/docs/editor/extensions/functionality/snapshot
- Drag handle support https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-react
- Paste markdown