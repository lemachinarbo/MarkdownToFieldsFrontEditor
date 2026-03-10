# Changelog

## v7.0.3

- Fixed field, section, and subsection edit failures on documents containing marker lines with trailing whitespace.
- Unified browser-side marker boundary validation with the shared structural validator to avoid editor/runtime drift.
- Stopped section and subsection scoped edits from rewriting marker whitespace outside the active scope, and added regressions for the `df` chirology content shape.

## v7.0.2

- Fixed a document-scope regression after `section -> document` breadcrumb rebound where live edits on complex marker-heavy content could trip `document marker boundary violation`.
- Hardened section and subsection scoped projection so marker-adjacent whitespace is restored from the canonical baseline before boundary validation.
- Added regression coverage for editing and saving at the start and end of field, section, and subsection scopes, plus a browser regression for section-to-document rebound on complex content.
- Added a complex scope-transition matrix and deterministic document offset sweep to catch rebound-related boundary drift earlier.

## v7.0.1

- Fixed a breadcrumb regression introduced by stamped-key shape validation: parent breadcrumb navigation now keeps the original field context visible while preserving the `df7e82f` safeguard for malformed host stamps.
- Fixed document-scope save replay for dirty languages without a mounted editor by projecting canonical fallback markdown back to editor display text before V2 mutation.
- Added regression coverage for the field-to-section breadcrumb transition and for document-scope fallback save normalization.

## v0.7

- Big cleanup release focused on trust and stability.
- The editor flow is now simpler and more consistent: one clear way to open, edit, and save content without hidden side paths (check architect.md).
- New E2E tests.

## v0.6.2

- Editor’s been hardened for deterministic behavior. Updates and new features can now be added freely, without worrying about hidden state ghosts or timing gremlins lurking in the machinery.
- You can now target the main markdown area by passing an empty key when applying or syncing drafts. Before, the system treated the whole document like a normal field and ignored it. That’s fixed now, with tests to make sure it stays that way.
- Saves now show a persistent “Saving…” notice, the status bar reflects processing, and concurrent saves are queued instead of racing. Notices can be pinned, and closing fullscreen no longer waits for saves.
- Fix document view button.
- Fullscreen editor now reliably tracks changes for document‑scope edits and correctly saves the canonical markdown. Dirty flags, draft maps and save logic have been cleaned up to prevent stale drafts and ensure updates across scopes.

## v0.6.1

- Improve field resolution logic: Fields now pick the right one at the section level; handles ambiguities better
- Added helper for consistent field identity in both editors
- Fullscreen editor uses inline editor for clicks; normalizes field identity before loading
- Inline editor handles all clicks/double-clicks; added debug logging
- Hover overlays toggle a single active class; debug bypass included
- Better error handling and logging for routing failures
- Removed old hover/label CSS; overlay handles all hover effects
- Tests added for field identity and hover overlays; regression suite updated
- Removed all data-md-* compatibility reads and legacy view classes; now only data-mfe-* and mfe-state-* are used.
Unified runtime identity and state handling; added tests and checklist to lock in canonical naming.

## V0.6
- Unified editor routing. Inline and fullscreen now open through one deterministic path, fixing visibility glitches and removing duplicate dblclick. Editor state is canonical-first across hosts, so switching views is consistent.
- Breadcrumbs stay stable. Field context remains pinned while navigating parents.
- Draft retrieval logic improved.
- Fixed rare case where ~~strikethrough~~ showed raw markers after view switch.
- Sections with no direct body now show a **synthetic preview** built from their subsections. In plain words: if a section only contains `sub:*` blocks, the editor temporarily “fakes” section content so the preview isn’t empty. This preview is generated strictly from the current canonical markdown state, so it always reflects unsaved edits and never pulls stale cache data.
- Restored `Ctrl/Cmd + double click` inline launch by preventing fullscreen delegated dblclick capture from intercepting modified clicks.
- Fix breadcrumb reopening and stale unsaved changes prompts

## V0.5.7.3
- Fix thumbnail generation with EXIF orientation caching
- Fix PHP notice from indirect modification of overloaded `WireData` property (`exifOrientationCache`) by using explicit read/modify/write cache assignment.

## V0.5.7
- Fixed image thumbnail delivery**: Thumbnails now serve through ProcessWire cache using an endpoint.

## V0.5.6

- New **Document mode** with root editing and clearer scope boundaries.
  - Fullscreen and inline editors now share the same menu system and layout logic.
  - New Split view draggable divider.
  - Breadcrumbs redesigned for consistency and clearer navigation.
  - Toast notifications centralized into the window system.
  - Improved multilingual state handling.
  - Unified TipTap extensions across editor modes.

## V0.5.5
- Image picker is faster thanks to thumbnail caching.
- Picked images are now copied into ProcessWire assets, previewed with site URLs, and saved in markdown as relative paths.
- Language matching now follows ProcessWire language names, fixing wrong-language saves in multilingual pages.
- In split view, each editor keeps its own toolbar state (no more left/right active-button bleed).
- List markers are no longer rewritten unexpectedly when content mixes `-` and `*`.
- Added stronger single-line protection for restricted fields.

## V0.5.4
- Live preview now uses the current page language path directly, so updates no longer jump to the wrong language/root route.
- Fixed nested subsection preview updates: when some subsection keys are missing from rendered HTML, they are completed from canonical markdown content, so image updates patch correctly.

## V0.5.3
- Fixed multilingual fragment preview drift by switching to localized URL resolution: `page.url(language,http)` → `page.localHttpUrl(language)` → `pages.getPath(language)+host` → request `renderPath` fallback.
- Removed forced query-language override.

## V0.5.2
- Fixed marker persistence regression after save: active editor now rehydrates from canonical markdown, not fragment HTML.
- Field saves keep stripping field markers deterministically; section/subsection saves keep markers intact.
- Added regression coverage for repeated save/rehydrate marker behavior to prevent future regressions.

## V0.5.1
- Fixed the inline editor staying open when the user jumped to open another editor.
- Section preview now defaults to strict full-section replace rather than skipping (with deterministic safety checks).
- Fixed fragment graph parity by excluding `.fe-editable[data-mfe-source]` wrappers from mirror graph-key collection.
- Settings got simpler, and new safe parent replace toggle is now in the module UI.
- Fixed auto-wrap. Now scopes to the correct section/subsection host to avoid mis-wrapping repeated content.

## V0.5.0

Major change: preview system rewritten.

- Preview is now server-rendered via SSE instead of client-side HTML guessing.
- Added stable mount identity system so fragments patch reliably and never hit the wrong node.
- Compiler detects ambiguous mounts and reports them.
- Patch engine now applies updates parent-first to prevent nested double updates.
- Safe guards added:
  - won’t remove editable wrappers
  - won’t reshape layout if a key is missing
- Server and client now verify mount graph consistency and log mismatches.
- Fragment rendering has a fallback path if direct render fails.
- Markdown saving remains deterministic and untouched even with partial previews.


## V0.4.7

Foundation release for the new preview architecture.

- Preview switched from client-built HTML to server fragments.
- Added fragment endpoint used after saves.
- Preview updates now target only changed scopes instead of re-rendering whole zones.
- Removed old preview system that could break template markup.

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
