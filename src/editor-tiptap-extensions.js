import { Extension, Mark } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Bold from "@tiptap/extension-bold";
import BulletList from "@tiptap/extension-bullet-list";
import Italic from "@tiptap/extension-italic";
import TaskList from "@tiptap/extension-task-list";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { inlineHtmlTags } from "./editor-core.js";
import {
  getDefaultBoldDelimiter,
  getDefaultItalicDelimiter,
  getDefaultUnorderedListMarker,
} from "./markdown-style-preferences.js";

function updateNearestNodeAttrsForSelection(selection, tr, nodeTypeName, attrs) {
  if (!selection || !tr) return false;
  let target = null;

  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    if (node?.type?.name !== nodeTypeName) continue;
    target = {
      node,
      pos: selection.$from.before(depth),
    };
    break;
  }

  if (!target) return false;

  tr.setNodeMarkup(target.pos, undefined, {
    ...(target.node?.attrs || {}),
    ...(attrs || {}),
  });
  return true;
}

export const MarkerAwareBold = Bold.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      delimiter: {
        default: getDefaultBoldDelimiter(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      setBold:
        () =>
        ({ commands }) =>
          commands.setMark(this.name, {
            delimiter: getDefaultBoldDelimiter(),
          }),
      toggleBold:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name, {
            delimiter: getDefaultBoldDelimiter(),
          }),
      unsetBold:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const MarkerAwareItalic = Italic.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      delimiter: {
        default: getDefaultItalicDelimiter(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      setItalic:
        () =>
        ({ commands }) =>
          commands.setMark(this.name, {
            delimiter: getDefaultItalicDelimiter(),
          }),
      toggleItalic:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name, {
            delimiter: getDefaultItalicDelimiter(),
          }),
      unsetItalic:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const MarkerAwareBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      bullet: {
        default: getDefaultUnorderedListMarker(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      toggleBulletList:
        () =>
        ({ chain }) =>
          chain()
            .toggleList(this.name, this.options.itemTypeName, this.options.keepMarks)
            .command(({ tr }) => {
              return updateNearestNodeAttrsForSelection(
                tr.selection,
                tr,
                this.name,
                {
                  bullet: getDefaultUnorderedListMarker(),
                },
              );
            })
            .run(),
    };
  },
});

export const MarkerAwareTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      bullet: {
        default: getDefaultUnorderedListMarker(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      toggleTaskList:
        () =>
        ({ chain }) =>
          chain()
            .toggleList(this.name, this.options.itemTypeName)
            .command(({ tr }) => {
              return updateNearestNodeAttrsForSelection(
                tr.selection,
                tr,
                this.name,
                {
                  bullet: getDefaultUnorderedListMarker(),
                },
              );
            })
            .run(),
    };
  },
});

export const InlineHtmlLabelExtension = Extension.create({
  name: "inlineHtmlLabel",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations = [];
            state.doc.descendants((node, pos, parent) => {
              if (!node.isText) return;
              if (parent?.type?.name === "codeBlock") return;
              if (node.marks?.some((mark) => mark.type.name === "code")) return;

              inlineHtmlTags.forEach((tag) => {
                const re = new RegExp(`<\\s*\\/?\\s*${tag}\\b[^>]*>`, "gi");
                let match;
                while ((match = re.exec(node.text)) !== null) {
                  const from = pos + match.index;
                  const to = from + match[0].length;
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: "mfe-inline-html",
                      "data-inline-html": match[0],
                    }),
                  );
                }
              });
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export const UnderlineMark = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML() {
    return ["u", 0];
  },
});

export const SuperscriptMark = Mark.create({
  name: "superscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML() {
    return ["sup", 0];
  },
});

export const SubscriptMark = Mark.create({
  name: "subscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML() {
    return ["sub", 0];
  },
});

export function createMfeImageExtension(resolveImageBaseUrl) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: (element) => element.getAttribute("src"),
          renderHTML: (attributes) => {
            if (!attributes.src) return {};

            if (attributes.src.match(/^(https?:|\/|\?|\/\/)/)) {
              return { src: attributes.src };
            }

            const resolvedSrc = `${resolveImageBaseUrl()}${attributes.src.replace(/^\/+/, "")}`;
            return { src: resolvedSrc };
          },
        },
        originalFilename: {
          default: null,
        },
      };
    },
    addNodeView() {
      return ({ node, HTMLAttributes, getPos }) => {
        const resolveImageSrc = (src) => {
          if (!src) return "";
          if (src.match(/^(https?:|\/|\?|\/\/)/)) return src;
          return `${resolveImageBaseUrl()}${src.replace(/^\/+/, "")}`;
        };

        const container = document.createElement("span");
        container.classList.add("mfe-tiptap-image-container");

        const img = document.createElement("img");

        Object.entries(HTMLAttributes).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            img.setAttribute(key, value);
          }
        });

        const label = document.createElement("span");
        label.classList.add("mfe-tiptap-image-label");
        label.innerText = "edit";

        container.append(img, label);

        container.ondblclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.mfeOpenImagePicker) {
            const imagePos = typeof getPos === "function" ? getPos() : null;
            window.mfeOpenImagePicker(node.attrs, imagePos);
          }
        };

        return {
          dom: container,
          update: (updatedNode) => {
            if (updatedNode.type.name !== "image") return false;
            const src = resolveImageSrc(updatedNode.attrs.src);
            if (src) {
              img.setAttribute("src", src);
            } else {
              img.removeAttribute("src");
            }
            img.setAttribute("alt", updatedNode.attrs.alt || "");
            if (updatedNode.attrs.title) {
              img.setAttribute("title", updatedNode.attrs.title);
            } else {
              img.removeAttribute("title");
            }
            return true;
          },
        };
      };
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDoubleClickOn: (view, pos, node, nodePos, event, direct) => {
              if (node.type.name === "image") {
                if (window.mfeOpenImagePicker) {
                  window.mfeOpenImagePicker(node.attrs, nodePos);
                }
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  }).configure({
    inline: true,
    allowBase64: false,
  });
}
