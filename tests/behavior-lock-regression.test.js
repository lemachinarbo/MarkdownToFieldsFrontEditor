import fs from "node:fs";
import path from "node:path";
import { Schema } from "prosemirror-model";
import {
  createMarkdownParser,
  renderMarkdownToHtml,
  serializeMarkdownDoc,
} from "../src/editor-core.js";
import {
  parseFieldId as parseFieldIdDraftUtils,
  scopedKeyFromFieldId,
} from "../src/draft-utils.js";
import { scopedHtmlKeyFromMeta } from "../src/sync-by-key.js";

const ROOT = path.resolve(process.cwd());
const INLINE_PATH = path.join(ROOT, "src/editor-inline.js");
const FULLSCREEN_PATH = path.join(ROOT, "src/editor-fullscreen.js");
const SHARED_EXACT_PATH = path.join(ROOT, "src/editor-shared-helpers.js");

function readSource(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractFunctionSource(source, functionName) {
  const pattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`Function not found: ${functionName}`);

  const start = match.index;
  const openBrace = source.indexOf("{", start);
  if (openBrace < 0) throw new Error(`Missing body: ${functionName}`);

  let depth = 0;
  let i = openBrace;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
    i += 1;
  }
  throw new Error(`Unbalanced braces: ${functionName}`);
}

function extractFunctionSourceOrEmpty(source, functionName) {
  try {
    return extractFunctionSource(source, functionName);
  } catch (_e) {
    return "";
  }
}

function extractConstRegexSource(source, constName) {
  const pattern = new RegExp(`const\\s+${constName}\\s*=\\s*([\\s\\S]*?);`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`Const not found: ${constName}`);
  return match[0];
}

function normalizeFnBody(fnSource) {
  return fnSource.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function extractBlockByRegex(source, regex) {
  const match = source.match(regex);
  return match ? match[0] : "";
}

function collectMutationSignature(fnSource) {
  const tokens = [
    "fetch(",
    "setContent(",
    "innerHTML =",
    "dataset.markdown",
    "dataset.markdownB64",
    "window.MarkdownFrontEditorConfig.sectionsIndex",
    "window.MarkdownFrontEditorConfig.fieldsIndex",
  ];
  const lines = fnSource.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    tokens.forEach((token) => {
      if (line.includes(token)) {
        out.push({ line: i + 1, token, code: line.trim() });
      }
    });
  }
  return out;
}

function createBehaviorSchema() {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      blockquote: {
        group: "block",
        content: "block+",
        toDOM() {
          return ["blockquote", 0];
        },
      },
      paragraph: {
        group: "block",
        content: "inline*",
        toDOM() {
          return ["p", 0];
        },
      },
      text: { group: "inline" },
      listItem: {
        group: "block",
        content: "paragraph block*",
        toDOM() {
          return ["li", 0];
        },
      },
      bulletList: {
        group: "block",
        content: "listItem+",
        toDOM() {
          return ["ul", 0];
        },
      },
      orderedList: {
        group: "block",
        attrs: { order: { default: 1 } },
        content: "listItem+",
        toDOM(node) {
          return ["ol", { start: node.attrs.order }, 0];
        },
      },
      heading: {
        group: "block",
        content: "inline*",
        attrs: { level: { default: 1 } },
        toDOM(node) {
          return ["h" + node.attrs.level, 0];
        },
      },
      codeBlock: {
        group: "block",
        content: "text*",
        marks: "",
        code: true,
        toDOM() {
          return ["pre", ["code", 0]];
        },
      },
      horizontalRule: {
        group: "block",
        toDOM() {
          return ["hr"];
        },
      },
      hardBreak: {
        inline: true,
        group: "inline",
        selectable: false,
        toDOM() {
          return ["br"];
        },
      },
      image: {
        inline: true,
        group: "inline",
        attrs: {
          src: { default: "" },
          alt: { default: "" },
          title: { default: null },
          originalFilename: { default: null },
        },
        toDOM(node) {
          return ["img", node.attrs];
        },
      },
      mfeMarker: {
        group: "block",
        atom: true,
        attrs: { name: { default: "" } },
        toDOM(node) {
          return ["div", { "data-mfe-marker": node.attrs.name }];
        },
      },
    },
    marks: {
      bold: {
        toDOM() {
          return ["strong", 0];
        },
      },
      italic: {
        toDOM() {
          return ["em", 0];
        },
      },
      link: {
        attrs: { href: {} },
        toDOM(mark) {
          return ["a", { href: mark.attrs.href }, 0];
        },
      },
      code: {
        toDOM() {
          return ["code", 0];
        },
      },
      strike: {
        toDOM() {
          return ["s", 0];
        },
      },
      underline: {
        toDOM() {
          return ["u", 0];
        },
      },
      superscript: {
        toDOM() {
          return ["sup", 0];
        },
      },
      subscript: {
        toDOM() {
          return ["sub", 0];
        },
      },
    },
  });
}

describe("Behavior lock: markdown + editor parity", () => {
  let inlineSource;
  let fullscreenSource;
  let sharedSource;

  beforeEach(() => {
    global.window = {
      __MFE_DEV: true,
      localStorage: {
        getItem() {
          return null;
        },
      },
    };
    global.atob = (value) => Buffer.from(value, "base64").toString("binary");
    global.btoa = (value) => Buffer.from(value, "binary").toString("base64");
    inlineSource = readSource(INLINE_PATH);
    fullscreenSource = readSource(FULLSCREEN_PATH);
    sharedSource = readSource(SHARED_EXACT_PATH);
  });

  afterEach(() => {
    delete global.window;
  });

  test("marker parsing/render/serialize contract snapshot", () => {
    const schema = createBehaviorSchema();
    const parser = createMarkdownParser(schema);
    const markerMarkdown = [
      "<!-- section:body -->",
      "",
      "Alpha line",
      "",
      "<!-- hero -->",
      "",
      "![alt](image one.jpg)",
      "",
    ].join("\n");
    const plainMarkdown = ["Alpha line", "", "Second line"].join("\n");

    const parsedPlainDoc = parser.parse(plainMarkdown);
    const markerDoc = schema.node("doc", null, [
      schema.node("mfeMarker", { name: "section:body" }),
      schema.node("paragraph", null, [schema.text("Alpha line")]),
      schema.node("mfeMarker", { name: "hero" }),
      schema.node("paragraph", null, [schema.text("![alt](image one.jpg)")]),
    ]);

    const serializedPlain = serializeMarkdownDoc(parsedPlainDoc);
    const serializedMarkerDoc = serializeMarkdownDoc(markerDoc);
    const rendered = renderMarkdownToHtml(markerMarkdown);

    const parserSignature = {
      createMarkdownParserSource: normalizeFnBody(
        extractFunctionSource(
          readSource(path.join(ROOT, "src/editor-core.js")),
          "createMarkdownParser",
        ),
      ),
      markerRegexShared: extractConstRegexSource(
        sharedSource,
        "MFE_MARKER_LINE_RE",
      ),
      sharedStripMarkersSource: normalizeFnBody(
        extractFunctionSource(sharedSource, "stripMfeMarkersForFieldScope"),
      ),
      inlineStripMarkersWrapperOrUse: normalizeFnBody(
        extractFunctionSourceOrEmpty(
          inlineSource,
          "stripMfeMarkersForFieldScope",
        ),
      ),
      fullscreenStripMarkersWrapperOrUse: normalizeFnBody(
        extractFunctionSourceOrEmpty(
          fullscreenSource,
          "stripMfeMarkersForFieldScope",
        ),
      ),
    };

    expect({
      markerMarkdown,
      rendered,
      serializedPlain,
      serializedMarkerDoc,
      markerCountInRendered: rendered.match(/data-mfe-marker=/g)?.length || 0,
      markerCountInSerializedMarkerDoc:
        serializedMarkerDoc.match(/<!--\\s*[a-zA-Z0-9_:.\\/-]+\\s*-->/g)
          ?.length || 0,
      parserSignature,
    }).toMatchSnapshot();
  });

  test("inline vs fullscreen exact duplicate blocks remain equivalent", () => {
    const names = [
      "setOriginalBlockCount",
      "getOriginalBlockCount",
      "applyFieldAttributes",
      "stripTrailingEmptyParagraph",
      "getMarkdownFromEditor",
      "stripMfeMarkersForFieldScope",
    ];

    const report = {
      sharedFunctions: names.map((name) => ({
        name,
        source: normalizeFnBody(extractFunctionSource(sharedSource, name)),
      })),
      inlineUsageAnchors: names.map((name) => ({
        name,
        used: inlineSource.includes(`${name}(`),
      })),
      fullscreenUsageAnchors: names.map((name) => ({
        name,
        used: fullscreenSource.includes(`${name}(`),
      })),
      createEditorInstanceInline: normalizeFnBody(
        extractFunctionSource(inlineSource, "createEditorInstance"),
      ),
      createEditorInstanceFullscreen: normalizeFnBody(
        extractFunctionSource(fullscreenSource, "createEditorInstance"),
      ),
    };

    expect(report).toMatchSnapshot();
  });

  test("save pipeline DOM mutation signatures stay unchanged", () => {
    const inlineSaveField = extractFunctionSource(inlineSource, "saveField");
    const inlineSaveBatch = extractFunctionSource(inlineSource, "saveBatch");
    const fullscreenSave = extractFunctionSource(
      fullscreenSource,
      "handlePrimarySaveResponse",
    );

    const signature = {
      inlineSaveField: collectMutationSignature(inlineSaveField),
      inlineSaveBatch: collectMutationSignature(inlineSaveBatch),
      fullscreenHandlePrimarySaveResponse:
        collectMutationSignature(fullscreenSave),
    };

    expect(signature).toMatchSnapshot();
  });

  test("keyboard shortcut behavior signatures stay unchanged", () => {
    const inlineEsc = extractFunctionSource(
      inlineSource,
      "confirmDiscardChanges",
    );
    const fullscreenShortcuts = extractFunctionSource(
      fullscreenSource,
      "setupKeyboardShortcuts",
    );

    expect({
      inlineKeydownAnchor: normalizeFnBody(
        extractBlockByRegex(
          inlineSource,
          /if \(!keydownHandler\) \{[\s\S]*?document\.addEventListener\("keydown", keydownHandler, true\);[\s\S]*?\n\s*\}/,
        ),
      ),
      inlineEscapeConfirm: normalizeFnBody(inlineEsc),
      fullscreenShortcutHandler: normalizeFnBody(fullscreenShortcuts),
    }).toMatchSnapshot();
  });

  test("image insertion flow signatures stay unchanged", () => {
    const inlineImageFlow = extractFunctionSource(
      inlineSource,
      "openImagePickerInline",
    );
    const fullscreenImageFlow = extractFunctionSource(
      fullscreenSource,
      "openImagePicker",
    );

    expect({
      inlineImageFlow: normalizeFnBody(inlineImageFlow),
      fullscreenImageFlow: normalizeFnBody(fullscreenImageFlow),
    }).toMatchSnapshot();
  });

  test("field resolution + id format contracts snapshot", () => {
    expect({
      inlineParseDataMfeSource: normalizeFnBody(
        extractFunctionSource(inlineSource, "parseDataMfe"),
      ),
      inlineBuildFieldIdSource: normalizeFnBody(
        extractFunctionSource(inlineSource, "buildFieldId"),
      ),
      inlineParseFieldIdSource: normalizeFnBody(
        extractFunctionSource(inlineSource, "parseFieldId"),
      ),
      fullscreenBuildFieldIdSource: normalizeFnBody(
        extractFunctionSource(fullscreenSource, "buildFieldId"),
      ),
      draftUtilsFieldIdParse: parseFieldIdDraftUtils("123:field:body:title"),
      draftUtilsScopedFromFieldId: scopedKeyFromFieldId("123:field:body:title"),
      scopedHtmlKeyFromMeta: scopedHtmlKeyFromMeta(
        "field",
        "body",
        "",
        "title",
      ),
      markerRegexShared: extractConstRegexSource(
        sharedSource,
        "MFE_MARKER_LINE_RE",
      ),
      sharedStripMarkersSource: normalizeFnBody(
        extractFunctionSource(sharedSource, "stripMfeMarkersForFieldScope"),
      ),
      inlineStripMarkersWrapperOrUse: normalizeFnBody(
        extractFunctionSourceOrEmpty(
          inlineSource,
          "stripMfeMarkersForFieldScope",
        ),
      ),
      fullscreenStripMarkersWrapperOrUse: normalizeFnBody(
        extractFunctionSourceOrEmpty(
          fullscreenSource,
          "stripMfeMarkersForFieldScope",
        ),
      ),
    }).toMatchSnapshot();
  });
});
