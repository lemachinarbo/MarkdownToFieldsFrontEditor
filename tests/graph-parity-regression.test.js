import { compileMountTargetsByKey } from "../src/sync-by-key.js";

function createElement(attrs = {}, options = {}) {
  const attributes = { ...attrs };
  const classes = new Set(
    String(attributes.class || "")
      .split(/\s+/)
      .map((v) => v.trim())
      .filter(Boolean),
  );

  const el = {
    nodeType: 1,
    tagName: options.tagName || "DIV",
    parentElement: options.parentElement || null,
    previousElementSibling: options.previousElementSibling || null,
    id: options.id || "",
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? String(attributes[name])
        : "";
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
      if (name === "class") {
        classes.clear();
        String(value)
          .split(/\s+/)
          .map((v) => v.trim())
          .filter(Boolean)
          .forEach((v) => classes.add(v));
      }
      if (name === "id") this.id = String(value);
    },
    removeAttribute(name) {
      delete attributes[name];
      if (name === "class") classes.clear();
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },
    closest(selector) {
      if (selector === '[data-mfe-window="true"]') return null;
      return null;
    },
    classList: {
      contains(name) {
        return classes.has(name);
      },
    },
  };

  return el;
}

function createRoot({ editables = [], mfe = [], sources = [] }) {
  return {
    querySelectorAll(selector) {
      if (selector === ".fe-editable") return editables;
      if (selector === "[data-mfe]") return mfe;
      if (selector === "[data-mfe-source]") return sources;
      return [];
    },
  };
}

function getMetaAttr(el, name) {
  return (
    el.getAttribute(`data-mfe-${name}`) ||
    el.getAttribute(`data-md-${name}`) ||
    ""
  );
}

describe("Graph parity regression", () => {
  beforeEach(() => {
    global.window = { MarkdownFrontEditorConfig: {} };
  });

  afterEach(() => {
    delete global.window;
  });

  test("ignores .fe-editable wrappers in data-mfe-source mirror graph collection", () => {
    const editableWrapperWithSource = createElement({
      class: "fe-editable md-edit",
      "data-mfe-source": "field:hero:intro",
    });

    const validMirrorSource = createElement({
      "data-mfe-source": "field:body:predictable",
    });

    const root = createRoot({
      editables: [editableWrapperWithSource],
      sources: [editableWrapperWithSource, validMirrorSource],
    });

    const { report } = compileMountTargetsByKey({
      changedKeys: [],
      root,
      getMetaAttr,
      semanticLookup: undefined,
    });

    expect(report.graphKeys).toEqual(["field:body:predictable"]);
    expect(report.graphNodeCount).toBe(1);
  });
});
