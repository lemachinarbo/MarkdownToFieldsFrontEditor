# Changelog

## V0.5.0
- Live preview moved to deterministic server-fragment sync (DataStar SSE).
- Added stable mount graph compiler (`data-mfe-key-id`) with compile report and ambiguity flagging (`data-mfe-ambiguous`).
- Compiler now stamps canonical identity on mounts (`data-mfe-key`, `data-mfe-sig`) and uses canonical keys across the fragment request boundary.
- Added optional dev diagnostics: `data-mfe-path`, invariant checks (`key->sig`, `keyId->sig`), and `watch()/unwatch()` auto-recompile helpers.
- Added mount graph checksum handshake (`mfe-g-*`) between client and server with `FRAGMENTS_GRAPH_MISMATCH` logging.
- Added stamped-key server sanity checks (`FRAGMENTS_STAMP_WARN`, `FRAGMENTS_STAMP_ERROR`) for mismatched or non-recomputable identities.
- Added patch cycle tracing (`cycleId`, `data-mfe-last-patch`) and parent-first apply to avoid nested double-patches.
- Added safe section guard: section patch is skipped if it would remove `.fe-editable` wrappers.
- Added safe missing-key fallback: only matching editable nodes are updated (`mfe_missing`), no structural host flattening.
- Added HTTP-render fallback for fragment generation when direct module render context fails.
- Markdown save path remains canonical and deterministic even when preview is partial.

## V0.4.7
- Live preview now uses server-rendered fragments delivered via DataStar SSE (`datastar-patch-elements`) keyed by changed scoped identities.
- Added fragment endpoint `?markdownFrontEditorFragments=1` with shared auth/CSRF/lang rules and JSON fallback mode for debugging.
- Frontend now requests changed keys after save and applies targeted patch swaps by mount selectors, instead of composing preview HTML client-side.
- `data-mfe` remains the primary preview zone contract; `data-mfe-source` remains explicit mirror contract for extra projections.
- Removed broad host fanout preview behavior that could flatten template-specific markup.

## V0.4.6.3
- Save replacement is now structural and scope-based (section/subsection/field identity), not raw text search.
- Field saves now resolve identity from `fieldId` (when provided), including subsection fields.
- 409 is kept for true structural ambiguity, preventing cross-field mutation.
- Live preview sync applies by changed scoped keys and supports multiview fan-out via `data-mfe-source`.
- `data-mfe-source` now accepts both scoped keys (`subsection:body:features:end`) and slash paths (`body/features/end`).

## V0.4.6.2
- Removed hardcoded frontend path assumptions (`/site/images`, `/site/assets/files`); image URL resolution is now ProcessWire-config-first (`pageFilesBaseUrl`, `imageBaseUrl`) with generic fallbacks.
- Fixed subsection/section image live-refresh matching for `data-mfe` hosts in disconnected-target saves.
- Empty section/subsection/container zones can now be opened from rollover/double-click even when their markdown is currently empty.
- Switched live preview sync to strict changed-key mounts (section/subsection/field) to avoid broad/fuzzy DOM replacement side effects.
- Added cross-scope draft carry while navigating breadcrumbs; pending drafts can now be saved even when current scope has no direct markdown.
- Breadcrumb trail now stays anchored to the original opened path during breadcrumb navigation, so context is preserved while moving up/down scopes.

## V0.4.6.1

- Fix to preserve marker tags with dots/paths during edit/save (e.g. `<!-- description... -->`) so subsection/tag boundaries are not dropped.
- Save replacements now use raw markdown source (not processed image-rewritten content), preventing unrelated image URL mutations.
- Skip no-op saves and preserve original markdown formatting when only image `src` changes (avoids list marker/style rewrites).
- Keep `data-mfe` host layout intact on save; only `.fe-editable` content is replaced.
- Live host image refresh now resolves through ProcessWire URLs (`config->urls->files` via `pageFilesBaseUrl`) and updates only the matched/isolated image.
- Markdown image serialization no longer escapes `_` in filenames; only required URL characters are escaped.
- Fix image binding: images are auto-bound from `.fe-editable` and `[data-mfe]` metadata; removed global filename-guess fallback updates.
- Live image sync now supports `section`, `subsection`, tagged field images, and `...` container image fields using scoped metadata/key fallback (no full-markdown HTML injection).

## V0.4.5

- Images save as relative paths; previews use site base URL.
- Replacing an image from the picker now reliably targets the selected image node + shows relative paths.
- Save sync fallback works for all targets (incl. data-mfe).

## V0.4.3
- New optional `data-mfe` hosts for precise section/subsection rollovers in complex templates.


## V0.4.2
- Marker labels now render with section/sub/field styles and stay non‑editable.
- Unified markdown → editor rendering for inline/fullscreen (more consistent markers and output).
- Split view translations are more stable across field/section switches.
- Image picker listing hardened for missing/permissioned folders.
- Inline HTML is preserved on save: `strong`, `em`, `del`, `u`, `sup`, `sub`, `br` (no `span`).

## V0.4.2.beta.2
- Image support (images in editor can be updated on double click).

## V0.4.1
- Breadcrumbs in fullscreen allow you to edit ancestors (section > subsection > container > field).
- Section breadcrumb is disabled when the section has no direct content.
  
## V0.4
- Adds sections/subsections support.
- New hybrid system: inline editing + fullscreen editing.

## V0.3
- Official launch of the front-end editor tested in one machine, one installation, one browser.
