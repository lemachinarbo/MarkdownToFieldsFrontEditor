# Architecture: Markdown-First Pipeline (Simple)

## 1) Core idea

Outside an editing session, the persisted Markdown file is the source of truth.

During editing, MFE keeps **one canonical `DocumentState` draft per language** as the authoritative mutable state.

Everything else is a view of that same document:
- scope view (field/subsection/section/document)
- editor view (rich)
- preview fragments on the page
- runtime projection inside the editor

No scope creates a second document.

## 2) Main runtime pieces

- **DocumentState** (`src/document-state.js`)
  - Holds the language draft and persisted body.
  - Tracks frontmatter separately and recomposes on save.
  - Emits state lifecycle (`STATE_OPENED`, `STATE_UPDATED`, `STATE_SAVED`, etc).

- **Scope Session** (`src/scope-session.js`)
  - Locks a state to one active scope key.
  - Save/edit is blocked if scope session does not match.

- **Canonical Scope Session** (`src/canonical-scope-session.js`)
  - Resolves the canonical slice for current scope.
  - Splits slice into protected marker spans + editable content.
  - Projects canonical slice to editor display and unprojects back.

- **Boundary Extension** (`src/document-boundary-extension.js`)
  - Keeps runtime editable boundaries in the editor.
  - Maps boundaries through transactions.

- **Mutation Plan** (`src/mutation-plan.js`)
  - The single mutation engine (`applyScopedEdit`) for scoped edits.
  - Used during live edits and save commit.

## 3) Open flow (what happens when editor opens)

1. Load markdown payload for language.
2. Split frontmatter/body.
3. Get or create the canonical `DocumentState` for `(sessionId + language)`.
4. Rebind scope (field/subsection/section/document) on that same state.
5. Resolve canonical scope slice.
6. Project slice to display text for TipTap.
7. Seed boundary projection and run seed normalization handshake.

Result: editor starts from canonical markdown, not from ad-hoc HTML.

## 4) Edit flow (user typing)

1. Editor update accepted only from human input source.
2. Current scope meta is resolved from active scope.
3. `applyMarkdownToState` routes to `applyScopeSlice`.
4. `applyScopeSlice` calls `applyScopedEdit`.
5. The mutation engine rewrites only the allowed canonical range.
6. Leak checks ensure no out-of-scope byte mutation.
7. `DocumentState.setDraft` stores new canonical body.
8. Status goes to **Draft**.

Result: scope edits still mutate one canonical body.

## 5) Save flow (deterministic commit path)

1. Build save plan from dirty language states.
2. Validate scope-session lock (must match current scope).
3. Re-run the mutation engine for commit input.
4. Run invariants before network:
   - marker graph safety
   - marker boundary adjacency safety
   - changed ranges inside expected scope range
5. Build outbound markdown payload.
6. Persist via backend.
7. Read back persisted markdown.
8. Classify readback diff (`src/markdown-layer3-readback.js`).
9. Accept commit only when readback is accepted (current strict class is `exact`).
10. `markSaved` updates persisted/draft and status becomes **Saved** (or **No changes** if applicable).

Result: save is centralized and guarded, not a best-effort patch.

## 6) Preview sync flow

After save, frontend fragments are refreshed by key.

When parent replacement is risky (nested editable descendants), MFE uses safe partial patching instead of unsafe full replacement.

Result: live preview tries to stay structurally safe.

## 7) Deterministic vs non-deterministic

### Deterministic (inside MFE)

- Single canonical draft per `(session, language)`.
- Scope is a lens, not a copy.
- One mutation path (`applyScopedEdit`) for scoped rewriting.
- Scope-session lock prevents cross-scope accidental writes.
- Pre-commit invariants are explicit and centralized.
- Readback verification gate before final mark-saved.

### Non-deterministic / external

- Backend may normalize line endings (CRLF/LF) or formatting.
- DOM/layout context can force safe preview fallback behavior.
- Browser/editor transaction timing is runtime-dependent.

MFE treats these as external variability and validates readback explicitly.

## 8) Fallback policy

- No legacy alternate save pipeline is used as main path.
- If runtime boundaries become untrusted, boundaries are recomputed deterministically from projection data.
- If preview full replacement is unsafe, fallback is safe partial fragment patch.
- If readback fails classification, commit is blocked and draft remains dirty.

## 9) Multi-language and split

- Each language has its own `DocumentState`.
- Scope/helpers (like outline) are shared UX controls.
- Editing/saving data is still per-language state.
- Split view shows two language states side by side without merging them.

## 10) Inline vs fullscreen

- **Fullscreen** is the strict canonical pipeline described above and the reference implementation.
- **Inline** is intentionally limited and remains a non-reference path.

### Fullscreen status

The fullscreen reference pipeline is **PROVEN**:
- one canonical save pipeline (`saveAllEditors`)
- explicit scope authority end-to-end
- canonical `DocumentState` as the only structural authority
- runtime projection as a rebuildable cache, never the source of truth
- deterministic revoke/reseed behavior across rebind, discard, and reopen
- browser-verifiable runtime projection authority transitions

If you are validating deterministic markdown preservation behavior, fullscreen is the reference path.


---

# the Dream

- One markdown source of truth per language (DocumentState + canonical body).
- Scope as lens (no state fork; rebinds same state).
- Deterministic scoped mutation path (`applyScopedEdit`) for edit/save.
- Save safety gates (scope-session match, range leak checks, marker/boundary checks).
- Readback verification before markSaved.
- Draft/No changes/Saved status lifecycle is implemented. (*Partially fulfilled / remaining gaps*)
- “Preserve exactly as user wrote” is very strong; still affected by external normalizers (*backend CRLF/LF and some markdown style normalization edge cases*).
- Inline host is intentionally limited and not as strict as fullscreen pipeline.
- Map mode is still WIP (as README says).
- E2E coverage is still light compared to the size of the pipeline (many unit tests, few browser E2E scenarios).
