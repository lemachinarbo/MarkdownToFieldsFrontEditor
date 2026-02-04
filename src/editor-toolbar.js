export function createToolbarButtons({ getEditor, onSave, onToggleSplit }) {
  const getActiveEditor = () => (typeof getEditor === "function" ? getEditor() : null);

  const withEditor = (fn) => () => {
    const editor = getActiveEditor();
    if (!editor) return;
    fn(editor);
  };

  const isActiveMark = (mark, attrs) => {
    const editor = getActiveEditor();
    if (!editor) return false;
    return editor.isActive(mark, attrs);
  };

  return [
    {
      key: "bold",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M5.246 3.744a.75.75 0 0 1 .75-.75h7.125a4.875 4.875 0 0 1 3.346 8.422 5.25 5.25 0 0 1-2.97 9.58h-7.5a.75.75 0 0 1-.75-.75V3.744Zm7.125 6.75a2.625 2.625 0 0 0 0-5.25H8.246v5.25h4.125Zm-4.125 2.251v6h4.5a3 3 0 0 0 0-6h-4.5Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: withEditor((editor) => editor.chain().focus().toggleBold().run()),
      isActive: () => isActiveMark("bold"),
      title: "Bold (Ctrl+B)",
    },
    {
      key: "italic",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M10.497 3.744a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-3.275l-5.357 15.002h2.632a.75.75 0 1 1 0 1.5h-7.5a.75.75 0 1 1 0-1.5h3.275l5.357-15.002h-2.632a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: withEditor((editor) => editor.chain().focus().toggleItalic().run()),
      isActive: () => isActiveMark("italic"),
      title: "Italic (Ctrl+I)",
    },
    {
      key: "strike",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M9.657 4.728c-1.086.385-1.766 1.057-1.979 1.85-.214.8.046 1.733.81 2.616.746.862 1.93 1.612 3.388 2.003.07.019.14.037.21.053h8.163a.75.75 0 0 1 0 1.5h-8.24a.66.66 0 0 1-.02 0H3.75a.75.75 0 0 1 0-1.5h4.78a7.108 7.108 0 0 1-1.175-1.074C6.372 9.042 5.849 7.61 6.229 6.19c.377-1.408 1.528-2.38 2.927-2.876 1.402-.497 3.127-.55 4.855-.086A8.937 8.937 0 0 1 16.94 4.6a.75.75 0 0 1-.881 1.215 7.437 7.437 0 0 0-2.436-1.14c-1.473-.394-2.885-.331-3.966.052Zm6.533 9.632a.75.75 0 0 1 1.03.25c.592.974.846 2.094.55 3.2-.378 1.408-1.529 2.38-2.927 2.876-1.402.497-3.127.55-4.855.087-1.712-.46-3.168-1.354-4.134-2.47a.75.75 0 0 1 1.134-.982c.746.862 1.93 1.612 3.388 2.003 1.473.394 2.884.331 3.966-.052 1.085-.384 1.766-1.056 1.978-1.85.169-.628.046-1.33-.381-2.032a.75.75 0 0 1 .25-1.03Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: withEditor((editor) => editor.chain().focus().toggleStrike().run()),
      isActive: () => isActiveMark("strike"),
      title: "Strikethrough",
    },
    {
      key: "code",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon">
          <path fill-rule="evenodd" d="M14.447 3.026a.75.75 0 0 1 .527.921l-4.5 16.5a.75.75 0 0 1-1.448-.394l4.5-16.5a.75.75 0 0 1 .921-.527ZM16.72 6.22a.75.75 0 0 1 1.06 0l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06L21.44 12l-4.72-4.72a.75.75 0 0 1 0-1.06Zm-9.44 0a.75.75 0 0 1 0 1.06L2.56 12l4.72 4.72a.75.75 0 0 1-1.06 1.06L.97 12.53a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: withEditor((editor) => editor.chain().focus().toggleCode().run()),
      isActive: () => isActiveMark("code"),
      title: "Inline code",
    },
    {
      key: "codeblock",
      label: "```",
      action: withEditor((editor) => editor.chain().focus().toggleCodeBlock().run()),
      isActive: () => isActiveMark("codeBlock"),
      title: "Code block",
    },
    {
      key: "paragraph",
      label: "P",
      action: withEditor((editor) => editor.chain().focus().setParagraph().run()),
      isActive: () => isActiveMark("paragraph"),
      title: "Paragraph",
    },
    {
      key: "h1",
      label: "H1",
      action: withEditor((editor) =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
      ),
      isActive: () => isActiveMark("heading", { level: 1 }),
      title: "Heading 1",
    },
    {
      key: "h2",
      label: "H2",
      action: withEditor((editor) =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
      ),
      isActive: () => isActiveMark("heading", { level: 2 }),
      title: "Heading 2",
    },
    {
      key: "h3",
      label: "H3",
      action: withEditor((editor) =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
      ),
      isActive: () => isActiveMark("heading", { level: 3 }),
      title: "Heading 3",
    },
    {
      key: "h4",
      label: "H4",
      action: withEditor((editor) =>
        editor.chain().focus().toggleHeading({ level: 4 }).run(),
      ),
      isActive: () => isActiveMark("heading", { level: 4 }),
      title: "Heading 4",
    },
    {
      key: "h5",
      label: "H5",
      action: withEditor((editor) =>
        editor.chain().focus().toggleHeading({ level: 5 }).run(),
      ),
      isActive: () => isActiveMark("heading", { level: 5 }),
      title: "Heading 5",
    },
    {
      key: "h6",
      label: "H6",
      action: withEditor((editor) =>
        editor.chain().focus().toggleHeading({ level: 6 }).run(),
      ),
      isActive: () => isActiveMark("heading", { level: 6 }),
      title: "Heading 6",
    },
    {
      key: "ul",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 6l11 0" /><path d="M9 12l11 0" /><path d="M9 18l11 0" /><path d="M5 6l0 .01" /><path d="M5 12l0 .01" /><path d="M5 18l0 .01" /></svg>
      `,
      action: withEditor((editor) => editor.chain().focus().toggleBulletList().run()),
      isActive: () => isActiveMark("bulletList"),
      title: "Bullet list",
    },
    {
      key: "ol",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M11 6h9" /><path d="M11 12h9" /><path d="M12 18h8" /><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4" /><path d="M6 10v-6l-2 2" /></svg>
      `,
      action: withEditor((editor) => editor.chain().focus().toggleOrderedList().run()),
      isActive: () => isActiveMark("orderedList"),
      title: "Numbered list",
    },
    {
      key: "blockquote",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon">
          <path d="M3.75 3.25A.75.75 0 0 0 3 4v16a.75.75 0 0 0 .75.75.75.75 0 0 0 .75-.75V4a.75.75 0 0 0-.75-.75Zm4.5 2A.75.75 0 0 0 7.5 6a.75.75 0 0 0 .75.75h12A.75.75 0 0 0 21 6a.75.75 0 0 0-.75-.75Zm0 6a.75.75 0 0 0-.75.75.75.75 0 0 0 .75.75h12A.75.75 0 0 0 21 12a.75.75 0 0 0-.75-.75Zm0 6a.75.75 0 0 0-.75.75.75.75 0 0 0 .75.75h8.25a.75.75 0 0 0 .75-.75.75.75 0 0 0-.75-.75Z"></path>
        </svg>
      `,
      action: withEditor((editor) => editor.chain().focus().toggleBlockquote().run()),
      isActive: () => isActiveMark("blockquote"),
      title: "Blockquote",
    },
    {
      key: "link",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" data-slot="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12a3 3 0 0 1 3-3h4.5a3 3 0 0 1 0 6H12a3 3 0 0 1-3-3Zm6-3a3 3 0 0 1 3-3h1.5a3 3 0 0 1 0 6H18a3 3 0 0 1-3-3Z"></path>
        </svg>
      `,
      action: withEditor((editor) => {
        const previousUrl = editor.getAttributes("link").href || "";
        const url = window.prompt("URL", previousUrl);
        if (url === null) return;
        if (url.trim() === "") {
          editor.chain().focus().unsetLink().run();
          return;
        }
        editor
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href: url })
          .run();
      }),
      isActive: () => isActiveMark("link"),
      title: "Link",
    },
    {
      key: "unlink",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" data-slot="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 13.5 7 17a3 3 0 0 1-4.243-4.243l3.5-3.5M13.5 10.5 17 7a3 3 0 0 1 4.243 4.243l-3.5 3.5M8 8l8 8"></path>
        </svg>
      `,
      action: withEditor((editor) => editor.chain().focus().unsetLink().run()),
      isActive: () => false,
      title: "Remove link",
    },
    {
      key: "clear",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 15l4 4m0 -4l-4 4" /><path d="M7 6v-1h11v1" /><path d="M7 19l4 0" /><path d="M13 5l-4 14" /></svg>
      `,
      action: withEditor((editor) => editor.chain().focus().clearNodes().unsetAllMarks().run()),
      isActive: () => false,
      title: "Clear formatting",
    },
    {
      key: "split",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M9 2.25a.75.75 0 0 1 .75.75v1.506a49.384 49.384 0 0 1 5.343.371.75.75 0 1 1-.186 1.489c-.66-.083-1.323-.151-1.99-.206a18.67 18.67 0 0 1-2.97 6.323c.318.384.65.753 1 1.107a.75.75 0 0 1-1.07 1.052A18.902 18.902 0 0 1 9 13.687a18.823 18.823 0 0 1-5.656 4.482.75.75 0 0 1-.688-1.333 17.323 17.323 0 0 0 5.396-4.353A18.72 18.72 0 0 1 5.89 8.598a.75.75 0 0 1 1.388-.568A17.21 17.21 0 0 0 9 11.224a17.168 17.168 0 0 0 2.391-5.165 48.04 48.04 0 0 0-8.298.307.75.75 0 0 1-.186-1.489 49.159 49.159 0 0 1 5.343-.371V3A.75.75 0 0 1 9 2.25ZM15.75 9a.75.75 0 0 1 .68.433l5.25 11.25a.75.75 0 1 1-1.36.634l-1.198-2.567h-6.744l-1.198 2.567a.75.75 0 0 1-1.36-.634l5.25-11.25A.75.75 0 0 1 15.75 9Zm-2.672 8.25h5.344l-2.672-5.726-2.672 5.726Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: () => {
        if (typeof onToggleSplit === "function") {
          onToggleSplit();
        }
      },
      isActive: () => false,
      title: "View languages",
    },
    {
      key: "save",
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon" fill="none">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 20.25h12A2.25 2.25 0 0 0 20.25 18V7.5L16.5 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25zm9.75-16.5v5h-9.5v-5zM13 5.5V7m-6.75 4.25h11.5v6.5H6.25Z"></path>
        </svg>
      `,
      action: () => {
        if (typeof onSave === "function") {
          onSave();
        }
      },
      isActive: () => false,
      title: "Save changes (Ctrl+S)",
      className: "editor-toolbar-save",
    },
  ];
}
