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
      `<!-- ${name} -->`,
    ];
  },
});
