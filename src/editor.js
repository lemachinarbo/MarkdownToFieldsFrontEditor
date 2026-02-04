// Entry: fullscreen editor view
import { initFullscreenEditor } from "./editor-fullscreen.js";
import { initInlineEditor } from "./editor-inline.js";

const view = window.MarkdownFrontEditorConfig?.view || "fullscreen";

if (view === "inline") {
  initInlineEditor();
} else {
  initFullscreenEditor();
}
