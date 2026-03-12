# Test Coverage Matrix

This matrix records which suites are primary regression evidence for stabilization
and which suites are advisory only.

## Strong

- `tests/mutation-plan-v2.test.js`
  - Canonical scoped mutation engine, marker topology, boundary preservation.
- `tests/canonical-scope-session.test.js`
  - Canonical projection, protected span roundtrip, deterministic boundaries.
- `tests/runtime-projection-authority.test.js`
  - Explicit scope authority, runtime projection identity/fingerprint validation,
    deterministic scope roundtrip invariants.
- `tests/e2e/document-save-roundtrip.spec.js`
  - Fullscreen scope/save workflows, scope rebound, dirty lens behavior, readback.
  - High-value cases currently relied on for stabilization:
    - `dirty field to section to document to field rebound saves without remount drift`
    - `rapid dirty scope switching still saves through canonical pipeline`
    - `split dirty scope oscillation saves through the fullscreen canonical pipeline`
    - `same-editor field rebind preserves dirty canonical draft before save`
    - `discard after dirty field rebind clears runtime tracking and reopens cleanly`
    - `projection authority lifecycle survives rebind discard and reopen`

## Medium

- `tests/document-state-regressions.test.js`
  - Session lock and mutation-path regressions.
- `tests/save-orchestration.test.js`
  - Save plan ordering and fallback helper behavior.
- `tests/document-state-session-contract.test.js`
  - State identity reuse across scope navigation.

## Low-Signal / Advisory

- `tests/layer-contracts.test.js`
  - Useful conceptual checks, but not strong behavioral regression proof.
- `tests/future.breadcrumb-valve.test.js`
  - Source-shape and identity intent checks, not runtime proof.
- `tests/future.identity-invariant.test.js`
  - Identity intent checks with limited integration depth.
- `tests/future.state-authority.test.js`
  - Useful invariant direction, but narrow runtime surface.
- `tests/document-boundary-extension.test.js`
  - Too narrow to represent runtime projection authority on its own.

## Stabilization Gaps To Fill

- Inline save-path unification with the fullscreen authority model.
- Explicit-scope enforcement for helper-level reads outside fullscreen.
- Corrupted runtime projection recovery coverage at browser level.
- Split-view dirty rebound coverage across primary/secondary language editors.
- Coverage matrix expansion from suite-level to per-test mapping for the most
  critical Playwright workflows.
