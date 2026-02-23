# Copilot Instructions for MarkdownToFieldsFrontEditor

## Project Overview

This is the front-end editor for [MarkdownToFields](https://github.com/lemachinarbo/MarkdownToFields), designed for ProcessWire CMS. It enables in-place editing of markdown-tagged content zones, supporting both fullscreen and inline editing, live preview, and multilanguage workflows. The editor is tightly coupled with the MarkdownToFields backend and is not a standalone module.

## Architecture & Key Concepts

- **Single Source of Truth:** All content comes from a markdown document. The editor never mutates the original markdown except via explicit user edits.
- **Scopes:** Editing is scoped to document, section, subsection, or field. Scoping only affects the UI focus, not the underlying content.
- **Views:** Multiple views (Raw, Rich, Outline, Map) control how content is displayed, never how it is stored.
- **Context:** Editing can be inline (WYSIWYG overlay) or fullscreen modal. Context only changes the editing surface.
- **Live Preview:** Updates are reflected instantly, with special logic for nested editable zones to ensure safe updates and prevent layout breakage.
- **Identity Resolution:** Editable zones are identified by `data-mfe` attributes. Canonical keys are stamped as `data-mfe-key` for runtime patching and network sync.

## Developer Workflows

- **Build:** Use `ddev npm install` to install dependencies. Build steps are handled by Vite (`vite.config.js`).
- **Test:** Run all tests with `ddev npm test -- tests`. Update Jest snapshots with `ddev npm test -- -u`.
- **Debug:** Use browser console helpers:
  - `window.MarkdownFrontEditor.recompile()` to restamp mount graph
  - `window.MarkdownFrontEditor.watch()` to enable auto-recompile
  - `window.MarkdownFrontEditor.unwatch()` to disable watch mode
- **Module Integration:** Requires ProcessWire + MarkdownToFields. Editors need `page-edit-front` permission.

## Project-Specific Patterns

- **Editable Zone Markup:**
  - Use `data-mfe="fieldname"` for editable zones.
  - For nested fields, prefer full path: `data-mfe="section/field"`.
  - Use `data-mfe-source` for mirrored content blocks.
- **Toolbar Customization:** Toolbar buttons are configured in module settings as a comma-separated list.
- **Safe Parent Replacement:** Parent block replacement in live preview is guarded by checks for unsaved changes and open editors.
- **Diagnostics:** Watch for log messages like `mfe_missing`, `FRAGMENTS_GRAPH_MISMATCH`, and `FRAGMENTS_STAMP_WARN` for troubleshooting.

## Key Files & Directories

- `src/` — All editor logic (core, extensions, toolbar, shell, etc.)
- `assets/` — CSS for different editor contexts
- `tests/` — Jest test suites and snapshots
- `MarkdownToFieldsFrontEditor.module.php` — ProcessWire module entry point
- `README.md` — Full documentation and usage examples

## External Integrations

- **ProcessWire CMS** (backend)
- **MarkdownToFields** (content tagging and scoping)
- **Vite** (build tooling)
- **Jest** (testing)

---

For any code changes, preserve the markdown-first, non-destructive editing philosophy. When in doubt, consult the README or existing test cases for canonical behaviors.

# ProcessWire Module Coding Contract

You are assisting with ProcessWire module development.

Mantra:

- You’re coding for a ProcessWire module.
- Keep it simple. Trust the framework.
- No enterprise patterns, no abstractions, no defensive over-engineering.
- Prefer clear, boring, readable code over clever code.
- Use native ProcessWire APIs and conventions.
- Avoid smart magic, DSLs, service layers, or unnecessary indirection.
- If something can be done in one obvious way, do it that way

Assume the following as hard constraints, not preferences:

## Architecture & intent

- This is a _module_, not an application.
- ProcessWire already provides lifecycle, safety, permissions, and IO.
- Trust the framework, trust processwire API
- Do not reimplement Processwire API
- Always look for existing API methods before adding new ones. If you dont know them ask or check the docs.
- Do not re-implement framework responsibilities.
- APIs > behavior. Data exposure > helper logic.
- Refactors must be behavior-preserving. Do not change semantics, output, side effects, or data shape unless explicitly instructed.

## Code style

- Prefer boring, explicit, linear code.
- One obvious way > flexible abstractions.
- No enterprise patterns: no services, factories, managers, adapters, DTOs.
- No magic helpers, no DSLs, no reflection hacks.
- Minimal indirection. If a function can be inline, inline it.

## Error handling

- Use `try/catch` **only** at real system boundaries:
  - external input
  - persistence
  - framework calls that are documented to throw

- Never catch exceptions just to “be safe”.
- Never swallow exceptions silently.
- If failure is unrecoverable, let it fail loudly.

## Mutability rules

- Parsed data is canonical and immutable after creation.
- No post-parse fixing, patching, or mutation.
- If data must be transformed, do it _before_ object creation.
- Projection helpers are allowed only if:
  - they are pure
  - they do not recompute or invent data
  - they do not mutate originals

## Fallback Policy

Do not add defensive fallbacks inside deterministic logic.
Do not turn deterministic systems into probabilistic ones.

## Layered rule

- **Core logic** → strict. No fallbacks. Throw on invalid state or missing required data.
- **Boundary layer** → tolerant. Fallbacks allowed for external uncertainty (IO, network, user input).
- **UI layer** → user-friendly. Convert errors into messages, never silence them.

If a condition indicates a bug, fail fast.
If a condition can happen in normal operation, handle gracefully.

## Logging

- Log only when something _meaningful changes_.
- Never log:
  - function entry
  - configuration
  - no-ops
  - early exits

- One log per actual mutation, maximum.

## Templates

- Templates are dumb.
- No helpers required to “fix” data for templates.
- If templates need logic, the data model is wrong.

## When proposing changes

- Default to the smallest possible change.
- Prefer documentation over behavior changes.
- Prefer explicit opt-in helpers over automatic behavior.
- Avoid adding new public methods unless they expose data, not behavior.

## Tone

- Be direct.
- No cheerleading.
- No summaries unless explicitly requested.
- If something is over-engineered, say so plainly.
