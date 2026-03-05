import { Node } from "@tiptap/core";

export const Marker = Node.create({
  name: "mfeMarker",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  isolating: true,

  addAttributes() {
    return {
      name: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-mfe-marker]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          return {
            name: node.getAttribute("data-mfe-marker") || "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const name = node.attrs.name || "";
    const text = String(name).trim().toLowerCase();
    let type = "field";
    if (text === "" || text === "--") {
      type = "field";
    } else if (text === "/" || text.startsWith("/")) {
      type = "close";
    } else if (text.startsWith("section:")) {
      type = "section";
    } else if (text.startsWith("sub:") || text.startsWith("subsection:")) {
      type = "sub";
    } else if (text.startsWith("field:")) {
      type = "field";
    }
    return [
      "div",
      {
        "data-mfe-marker": name,
        "data-mfe-marker-type": type,
        class: `mfe-marker mfe-marker--${type}`,
        contenteditable: "false",
      },
    ];
  },
});

export const GapSentinel = Node.create({
  name: "mfeGap",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      lineCount: {
        default: 1,
        parseHTML: (element) => {
          const value = Number(
            element.getAttribute("data-mfe-gap-lines") || "1",
          );
          if (!Number.isFinite(value) || value < 1) return 1;
          return Math.max(1, Math.floor(value));
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-mfe-gap]",
      },
    ];
  },

  renderHTML({ node }) {
    const lineCount = Math.max(1, Number(node.attrs.lineCount || 1));
    return [
      "div",
      {
        "data-mfe-gap": "1",
        "data-mfe-gap-lines": String(lineCount),
        class: "mfe-gap-sentinel",
        contenteditable: "false",
      },
    ];
  },
});
