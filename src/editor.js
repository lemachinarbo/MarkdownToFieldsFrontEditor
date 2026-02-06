// Entry: fullscreen editor view
import { initFullscreenEditor } from "./editor-fullscreen.js";
import { initInlineEditor } from "./editor-inline.js";

const cfg = window.MarkdownFrontEditorConfig || {};
const stamp = cfg.buildStamp || "unknown";


initInlineEditor();
