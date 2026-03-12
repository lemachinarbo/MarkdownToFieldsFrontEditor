# Boundary Authority Stabilization Note

This note defines the stabilization model for scope rebinding, boundary authority,
and save ownership in the fullscreen editor pipeline.

## Authority Model

### Canonical

- One canonical body exists per `(sessionId, language)`.
- The canonical body lives in `DocumentState` draft/persisted body fields.
- Canonical structure means marker graph, marker identities, and in-scope byte ranges.

### Derived

- Scope slices are derived from the canonical body.
- Canonical projections are derived from scope slices:
  - `displayText`
  - `segmentMap`
  - protected spans
  - deterministic editable boundaries
- Outbound scoped payloads are derived from the canonical body after mutation.

### Cached

- Runtime projection is cached on the mounted editor/plugin.
- Runtime projection cache includes:
  - boundary doc positions
  - mapped runtime boundaries
  - marker anchors
  - projection handshake metadata
  - projection identity fingerprint

### Disposable

- Runtime projection is disposable.
- Runtime projection must be discarded when it does not match the current:
  - `stateId`
  - `scopeKey`
  - protected-span fingerprint
- Runtime projection created before scope rebind is not authoritative.

### Allowed To Survive Scope Rebind

- Canonical `DocumentState`
- Session/language identity
- Dirty canonical draft
- A newly recomputed projection for the rebound scope

### Not Allowed To Survive Scope Rebind

- Previous-scope runtime boundaries
- Previous-scope marker anchors
- Previous-scope projection trust flags
- Any save/edit authority inferred from previous ambient scope

## Edit And Save Authority

### Edit Operations May Read As Authority

- canonical body from `DocumentState`
- explicit scope mutation context
- validated runtime projection only after identity and fingerprint checks

### Save Operations May Read As Authority

- canonical body from `DocumentState`
- explicit scope mutation context
- validated runtime projection only for display-to-canonical unprojection

### Edit/Save Operations Must Not Read As Authority

- ambient global scope alone
- stale editor plugin projection
- breadcrumb UI state
- preview DOM state
- prior callback parameters from deprecated save paths

## Invariants

- One canonical body per `(session, language)`.
- Every mutation/save path carries explicit scope context.
- Runtime projection is disposable and never authoritative over canonical structure.
- Scope rebind must deterministically rebuild runtime projection from canonical projection.
- Save must use one trusted fullscreen pipeline only.
- Runtime projection trust requires identity match, not just presence.
- Preview sync must consume canonical mutation output, never raw editor-local assumptions.

## Failure Model

### Stale Projection

- The editor holds runtime boundaries from an old scope or session binding.

### Mismatched Projection Attached To Correct State

- The projection matches `stateId` but not the current scope or structural fingerprint.

### Dirty Edit During Scope Rebind

- Mutation starts while projection/session lock replacement is in progress.

### Save Using Wrong Scope Context

- Save derives scope from ambient globals instead of the explicit mutation context.

### Preview Sync From Stale Mutation Result

- DOM patch consumes a mutation result not tied to the current canonical session/scope.

## Operational Rules

- Fullscreen is the reference path for deterministic markdown preservation.
- Inline remains non-reference until it is aligned with the same authority model.
- If current behavior is ambiguous and violates these invariants, the invariant wins.

## Current Enforcement Status

- Runtime projection trust now requires:
  - `stateId`
  - `scopeKey`
  - protected-span count
  - protected-span fingerprint
- Fullscreen mutation entry points now carry explicit scope context and reject
  mismatched scope payloads before canonical mutation.
- Fullscreen helper-level mutation and scope-read paths now use explicit scope
  in the reference flow; permissive fallback helpers remain non-reference only.
- Fullscreen save ownership is fixed to `saveAllEditors()`.
- The legacy fullscreen `onSave` callback shape remains only as a compatibility
  parameter on `window.MarkdownFrontEditor.edit(...)`; it is ignored in favor of
  the canonical save pipeline.
- Same-editor scope rebind now eagerly revokes runtime projection authority
  before the next canonical projection is seeded.
- Runtime projection trust transitions are now explicitly logged as
  `MFE_RUNTIME_PROJECTION_AUTHORITY_TRANSITION` so revoke/reseed/rebuild is
  auditable without treating runtime projection as structural authority.
- The same authority transitions are now browser-verifiable through
  `window.__MFE_RUNTIME_AUTHORITY_TRACE__`, which is populated from the same
  lifecycle instrumentation used for internal doc-state auditing.
- Fullscreen discard/close teardown now clears runtime projection/session caches
  for every state in the active fullscreen session before editor destruction.
- Remaining fallback:
  - helper-level reads can still derive scope from ambient UI state when called
    outside the fullscreen reference mutation/save path.

### Projection authority lifecycle proof

The fullscreen reference pipeline exposes runtime projection authority
transitions for verification in end-to-end tests.

These transitions confirm that:

- scope rebind revokes prior runtime projection authority
- discard/close clears runtime projection/session caches
- reopen reseeds deterministic projection from canonical state

The runtime projection layer remains a rebuildable cache over the canonical
`DocumentState`, never the source of truth.

With save-path centralization, explicit scope authority, runtime projection
validation, and browser-verifiable lifecycle proof all in place, the fullscreen
reference pipeline is considered proven.

## Inline Status

- Inline is currently a non-reference path.
- Fullscreen remains the architectural proof path for:
  - canonical mutation authority
  - centralized save behavior
  - runtime projection validation
  - deterministic readback verification
- Inline still differs in important ways:
  - it saves through its own `saveAllDrafts()` / `saveBatch()` path
  - it calls backend persistence directly per field
  - it calls `DocumentState.markSaved()` locally after inline save/open sync
  - it does not use fullscreen scope-session locks or runtime projection authority
- Minimum future alignment steps for inline:
  - route inline save through the same canonical commit authority as fullscreen
  - require explicit scope context for inline mutation/save decisions
  - replace inline-local save finalization with canonical save results
  - treat inline runtime/editor state as disposable, never structural authority
