# Editor architecture contract

## Axes

- **Scope**: what slice of canonical markdown is edited (`document`, `section`, `subsection`, `field`).
- **View**: how the scope is represented (`rich`, and future `raw`, `outline`, `tree`).
- **Host**: where interaction runs (`inline`, `fullscreen`).

## Module mapping

- **Scope core (pure)**
  - `src/session-resolver.js`
  - `src/sync-by-key.js`
  - `src/draft-utils.js`
  - `src/editor-core.js`
- **View layer**
  - `src/editor-tiptap-extensions.js`
  - `src/document-boundary-extension.js`
  - `src/editor-toolbar.js`
  - `src/editor-toolbar-renderer.js`
  - `src/field-constraints-extension.js`
- **Host orchestration**
  - `src/editor-inline.js`
  - `src/editor-fullscreen.js`
  - `src/host-router.js`
- **Shell ownership adapters**
  - `src/inline-shell.js`
  - `src/fullscreen-shell.js`

## Non-negotiable invariants

- Markdown is canonical and never mutated heuristically.
- Identity boundaries are deterministic (`scope.key`-based routing).
- Drafts are keyed by `scope.key` in active flows.
- View never changes scope/persistence routing.
- Host never changes parser/identity semantics.
- No direct host-to-host imports.
- Body class and shell attributes are mutated only via shell adapters.

## Public host APIs

- `window.MarkdownFrontEditor`
  - `openForElement(target)`
  - `close()`
  - `isOpen()`
- `window.MarkdownFrontEditorInline`
  - `close(options)`
  - `isOpen()`

## Contract tests

- `tests/behavior-lock-regression.test.js`
- `tests/host-router-contract.test.js`
- `tests/inline-shell-contract.test.js`
- `tests/fullscreen-shell-contract.test.js`

These tests lock deterministic routing and prevent coupling regressions.
