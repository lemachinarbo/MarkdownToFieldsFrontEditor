import { Extension } from "@tiptap/core";
import Document from "@tiptap/extension-document";

const SINGLE_BLOCK_ENTER_MESSAGE =
  "This area supports only one line. Multiple lines aren’t allowed.";

export const SingleBlockDocumentExtension = Document.extend({
  content: "block",
});

export const HeadingSingleLineExtension = Extension.create({
  name: "headingSingleLineExtension",
  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => {
        const selection = this.editor?.state?.selection;
        const parentType = selection?.$from?.parent?.type?.name;
        if (parentType !== "heading") return false;
        return this.editor.chain().focus().insertContent(" ").run();
      },
    };
  },
});

export function createSingleBlockEnterToastExtension(onNotify) {
  return Extension.create({
    name: "singleBlockEnterToastExtension",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          if (this.editor?.isActive("listItem")) {
            const selection = this.editor?.state?.selection;
            const parent = selection?.$from?.parent;
            const isEmptyListParagraph =
              parent?.type?.name === "paragraph" &&
              parent.textContent.trim().length === 0;
            if (isEmptyListParagraph) {
              if (this.editor.isActive("bulletList")) {
                return this.editor.chain().focus().toggleBulletList().run();
              }
              if (this.editor.isActive("orderedList")) {
                return this.editor.chain().focus().toggleOrderedList().run();
              }
            }
            return false;
          }
          if (typeof onNotify === "function") {
            onNotify(SINGLE_BLOCK_ENTER_MESSAGE, { persistent: true });
          }
          return true;
        },
      };
    },
  });
}
