function isSingleBlockField(editor) {
  return Boolean(
    editor?.view?.dom?.getAttribute("data-extra-warning") === "true",
  );
}

function resetToSingleParagraph(editor) {
  if (!editor) return;
  const docSize = editor.state.doc.content.size;
  const text = editor.state.doc.textBetween(0, docSize, "\n", "\n");
  const paragraph = {
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
  editor.commands.setContent({ type: "doc", content: [paragraph] }, false);
}

export function toggleListWithFieldConstraints(editor, listType) {
  if (!editor) return;
  const isBullet = listType === "bullet";
  const toggle = isBullet
    ? () => editor.chain().focus().toggleBulletList().run()
    : () => editor.chain().focus().toggleOrderedList().run();

  if (!isSingleBlockField(editor)) {
    toggle();
    return;
  }

  if (toggle()) return;

  if (
    (isBullet && editor.isActive("bulletList")) ||
    (!isBullet && editor.isActive("orderedList"))
  ) {
    const turnedOff =
      editor.chain().focus().liftListItem("listItem").run() ||
      editor.chain().focus().clearNodes().run() ||
      editor.chain().focus().setParagraph().run();

    if (
      !turnedOff ||
      editor.isActive("bulletList") ||
      editor.isActive("orderedList")
    ) {
      resetToSingleParagraph(editor);
    }
    return;
  }

  if (
    (isBullet && editor.isActive("orderedList")) ||
    (!isBullet && editor.isActive("bulletList"))
  ) {
    if (editor.chain().focus().liftListItem("listItem").run()) {
      toggle();
    }
  }
}

export function clearFormattingWithFieldConstraints(editor) {
  if (!editor) return;

  if (!isSingleBlockField(editor)) {
    editor.chain().focus().clearNodes().unsetAllMarks().run();
    return;
  }

  editor.chain().focus().unsetAllMarks().run();

  const cleared =
    (editor.isActive("listItem")
      ? editor.chain().focus().liftListItem("listItem").run()
      : false) ||
    editor.chain().focus().clearNodes().run() ||
    editor.chain().focus().setParagraph().run();

  if (
    !cleared ||
    editor.isActive("bulletList") ||
    editor.isActive("orderedList")
  ) {
    resetToSingleParagraph(editor);
    editor.chain().focus().unsetAllMarks().run();
  }
}
