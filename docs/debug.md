# Debugging Guide

This page is the "when things feel weird" checklist.

## 1) First thing to know

Logs are quiet by default now.

- Normal usage: only important warnings/errors show up.
- If you want deeper runtime logs, turn on debug mode.

## 2) How editable identity works (plain version)

Each editable block gets a final ID when the page is compiled.

You may see these attributes:

- `data-mfe`, `data-mfe-source` → what the template/author wrote
- `data-mfe-key` → final runtime ID (the important one)
- `data-mfe-sig` → structure signature
- `data-mfe-key-id` → internal selector for patching
- `data-mfe-path` → readable path (debug mode only)

### Rule of thumb

- Start with `data-mfe-key`.
- If it looks wrong/outdated, recompile and let runtime restamp from `data-mfe` / `data-mfe-source`.

---

## 3) Console commands you’ll actually use

Run these in browser devtools:

- `window.MarkdownFrontEditor.recompile()`
  - Rebuilds and restamps editable IDs.
- `window.MarkdownFrontEditor.watch()`
  - Auto-recompile when DOM changes.
- `window.MarkdownFrontEditor.unwatch()`
  - Stops watch mode.

---

## 4) ProcessWire log messages (quick meaning)

- `mfe_missing`
  - Server could not resolve one of the fragment keys.
- `FRAGMENTS_GRAPH_MISMATCH`
  - Client/server structure checksums differ.
- `FRAGMENTS_STAMP_WARN` / `FRAGMENTS_STAMP_ERROR`
  - Stamped key mismatch, or server could not recompute a key.

---

## 5) Contract tracer (debug-assert mode only)

Tracer is OFF by default.

Turn it ON with one of these:

- Set before init:
  - `window.MarkdownFrontEditorConfig.debugAssert = true`
- Or with localStorage:
  - `localStorage.setItem("mfeDebugAssert", "1")` then reload

When ON, and an invariant fails, runtime will:

- throw the same error (normal behavior),
- log `[mfe] canonical assert`,
- store a trace entry in `window.__MFE_CONTRACT_VIOLATIONS__`.

### Quick test flow

1. Enable:
   - `localStorage.setItem("mfeDebugAssert", "1")`
   - reload
2. Trigger a known violation:
   - `window.MarkdownFrontEditor.openForElementFromCanonical(document.querySelector(".fe-editable"), { markdown: "x" })`
3. Inspect tracer:
   - `window.__MFE_CONTRACT_VIOLATIONS__`
4. Read entries in order (ring buffer):
   - `(() => { const t = window.__MFE_CONTRACT_VIOLATIONS__; if (!t) return []; const start = (t.cursor - t.count + t.cap) % t.cap; return Array.from({ length: t.count }, (_, i) => t.entries[(start + i) % t.cap]); })()`
5. Disable:
   - `localStorage.removeItem("mfeDebugAssert")`
   - reload

---

## 6) Temporary synthetic patch guard (save safety)

This is a temporary guard for save fallback paths when intent patch journal entries are missing.

If enabled, save is blocked when a synthetic fallback patch is too large.

### Config flags (set before init)

- `window.MarkdownFrontEditorConfig.syntheticPatchGuardEnabled = true`
- `window.MarkdownFrontEditorConfig.syntheticPatchGuardMaxTouchedRatio = 0.65`
- `window.MarkdownFrontEditorConfig.syntheticPatchGuardMaxTouchedBytes = 4096`

Defaults used by runtime:

- `syntheticPatchGuardEnabled`: `false`
- `syntheticPatchGuardMaxTouchedRatio`: `0.65`
- `syntheticPatchGuardMaxTouchedBytes`: `4096`

### What gets blocked

When synthetic fallback is used for outbound save markdown, runtime computes touched patch size and ratio.

Save is blocked if either is true:

- touched ratio `>` `syntheticPatchGuardMaxTouchedRatio`
- touched bytes `>` `syntheticPatchGuardMaxTouchedBytes`

### What to check in logs

- `MFE_SYNTHETIC_PATCH_GUARD_BLOCKED`

That log includes:

- `scopeKind`
- `touchedRatio`, `maxTouchedRatio`
- `touchedBytes`, `maxTouchedBytes`
- `syntheticPatchCount`, `sourceBytes`, `replacementBytes`

### Quick enable/disable during debugging

Enable in devtools (before opening editor):

- `window.MarkdownFrontEditorConfig = window.MarkdownFrontEditorConfig || {}`
- `window.MarkdownFrontEditorConfig.syntheticPatchGuardEnabled = true`

Optional tuning:

- `window.MarkdownFrontEditorConfig.syntheticPatchGuardMaxTouchedRatio = 0.5`
- `window.MarkdownFrontEditorConfig.syntheticPatchGuardMaxTouchedBytes = 2048`

Disable:

- `window.MarkdownFrontEditorConfig.syntheticPatchGuardEnabled = false`