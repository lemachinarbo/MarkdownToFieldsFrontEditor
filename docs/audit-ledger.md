### MTF-001 - CRITICAL: Unsanitized Fragment HTML Reaches Live DOM
* **Location:** `src/fullscreen-preview-sync.js` (Lines 101-116)
* **Failure Mode:** Datastar fragment payloads are written into `outerHTML` and `innerHTML` without any sanitization or schema gate. A malformed or compromised fragment response can inject executable markup directly into the page.
* **Impact:** Security risk, DOM takeover, and persistent preview corruption.
* **Required Fix:** Enforce a strict fragment sanitization boundary before any DOM write, and reject payloads containing disallowed tags or attributes instead of patching them.
* **Required Fixture:** Add a fragment-sync test that feeds a `datastar-patch-elements` payload containing `<script>` and inline event handlers and proves the patch is rejected or sanitized before DOM mutation.
* **Status:** Resolved

### MTF-002 - HIGH: Active Editor Can Rebind To Content The DOM Never Applied
* **Location:** `src/fullscreen-post-save-sync.js` (Lines 614-623, 739-760)
* **Failure Mode:** The code computes `appliedKeys` and `skippedKeys` from fragment results, but it still reseeds `setActiveMarkdownState()` and `primaryEditor.commands.setContent()` even when the active scoped key was skipped, missing, or never mounted. This creates a state split where the editor shows saved content while the preview DOM still shows stale content.
* **Impact:** Silent UI desynchronization and incorrect baseline for the next edit/save cycle.
* **Required Fix:** Gate active editor reseeding on an explicit successful apply for the active scoped key, and fail or defer reseeding when the active patch was skipped or unresolved.
* **Required Fixture:** Add a save-response test where the active key is present in `requestedKeys` but absent from `patchResult.applied`, and assert that neither active markdown state nor editor content is updated.
* **Status:** Resolved

### MTF-003 - HIGH: Save Drift Guard Ignores Frontmatter Mutations
* **Location:** `src/save-orchestration.js` (Lines 173-176)
* **Failure Mode:** `plannedHashesByStateId` is built from `state.getDraft()` only, which excludes document frontmatter. A frontmatter-only mutation after plan construction will not change the planned hash even though the real outbound save payload changed.
* **Impact:** Silent pre-network drift escapes the save guard and can commit unintended document metadata changes.
* **Required Fix:** Hash the exact canonical save payload for each state, including frontmatter, instead of hashing body draft only.
* **Required Fixture:** Add a save-plan test where the document body stays stable but frontmatter changes between plan construction and send, and assert the drift guard blocks the save.
* **Status:** Resolved

### MTF-004 - HIGH: Runtime Payload Hash Check Reuses Body-Only Draft
* **Location:** `src/editor-fullscreen.js` (Lines 4500-4500, 4977-4978)
* **Failure Mode:** The runtime check compares `plannedHash` against `hashStateIdentity(stateDraftMarkdown)`, where `stateDraftMarkdown` is only `state.getDraft()`. That means the preflight mismatch test duplicates the body-only blind spot and still cannot detect frontmatter drift before the POST.
* **Impact:** Wrong canonical document can be transmitted even though the save pipeline appears to have a drift check.
* **Required Fix:** Compare the planned hash against the same full outbound canonical markdown that will be posted and later committed.
* **Required Fixture:** Add an editor-fullscreen save test that mutates only frontmatter after plan creation and proves the preflight hash mismatch path is triggered.
* **Status:** Resolved

### MTF-005 - HIGH: Empty Language Values Collapse Distinct States Into One Key
* **Location:** `src/document-state.js` (Lines 184-185, 238-238)
* **Failure Mode:** `lang` is normalized with `normalizeText()` and accepted even when empty, then used directly in `sessionId|lang` state identifiers. Any caller that drops or blanks the language can merge multiple translation states into the same storage slot.
* **Impact:** Cross-language draft bleed, wrong-language saves, and non-deterministic state reuse.
* **Required Fix:** Reject empty language values at `DocumentState` construction and `getOrCreate`, and fail fast instead of generating a key with an empty language suffix.
* **Required Fixture:** Add document-state tests that call `new DocumentState(..., "")` and `getDocumentState(..., "")` and assert they throw before touching the store.
* **Status:** Resolved

### MTF-006 - MEDIUM: Fallback Save Path Silently Uses Raw Marker-Bearing Markdown On Projection Failure
* **Location:** `src/save-orchestration.js` (Lines 100-121)
* **Failure Mode:** When marker-bearing fallback input cannot be projected through `resolveCanonicalScopeSlice()` or `projectCanonicalSlice()`, the catch path returns raw `fallbackMarkdown`. That converts a projection invariant failure into a best-effort save input that may include structural markers or the wrong scope slice.
* **Impact:** Silent wrong-scope save input and harder-to-diagnose corruption when no live editor is mounted.
* **Required Fix:** Treat projection failure on marker-bearing fallback input as a blocked save boundary, not as permission to reuse the raw fallback string.
* **Required Fixture:** Add a save-orchestration test with malformed marker-bearing fallback markdown that forces projection failure and assert the save path rejects instead of returning raw fallback content.
* **Status:** Resolved

### MTF-007 - MEDIUM: Stale-Scope Event Fires Before DOM Patch Completion
* **Location:** `src/fullscreen-post-save-sync.js` (Lines 162-177)
* **Failure Mode:** The module dispatches `mfe:fragment-stale-scope` before queued fragment patches are processed. Event subscribers observing the DOM at event time will see pre-patch state and can make decisions against an incomplete tree.
* **Impact:** Ordering bugs, false stale-scope handling, and nondeterministic listener behavior.
* **Required Fix:** Emit the stale-scope event only after patch processing completes, or split it into explicit pre-patch and post-patch events with documented semantics.
* **Required Fixture:** Add a fragment-sync test with a listener that inspects the DOM during `mfe:fragment-stale-scope` and assert the event fires only after patch completion.
* **Status:** Open

### MTF-008 - MEDIUM: Raw Selectors From Fragment Payload Are Executed Without Validation
* **Location:** `src/fullscreen-post-save-sync.js` (Lines 214-220)
* **Failure Mode:** The fragment patch loop passes `patch.selector` straight into `document.querySelectorAll()` with no validation or exception boundary. An invalid or hostile selector can throw synchronously or cause broad unintended DOM targeting.
* **Impact:** Patch-cycle aborts, preview corruption, and widened trust surface for server-provided selectors.
* **Required Fix:** Validate selectors against the module's expected selector shape and reject invalid selector payloads before calling DOM query APIs.
* **Required Fixture:** Add a fragment-sync test that injects an invalid selector in a patch payload and asserts the cycle reports a controlled error instead of throwing from `querySelectorAll()`.
* **Status:** Open

### MTF-009 - MEDIUM: Identity Parsers Disagree On Three-Part `data-mfe` Paths
* **Location:** `src/identity-resolver.js` (Lines 59-65, 132-137)
* **Failure Mode:** `parseDataMfe()` interprets a three-part path as a `field` shape with `section/subsection/name`, while `resolveDataMfeCandidates()` resolves the same three-part path to a `subsection:` candidate. Different callers can derive different canonical meanings from the same authored `data-mfe` value.
* **Impact:** Wrong-key binding, unstable identity resolution across refactors, and patch targeting drift.
* **Required Fix:** Define one canonical interpretation for three-part paths and make all identity helpers share the same mapping rules.
* **Required Fixture:** Add an identity-resolver consistency test that feeds the same three-part `data-mfe` value through both helpers and asserts they resolve to the same canonical scope/key.
* **Status:** Open

### MTF-010 - LOW: Snapshot API Boundary Accepts Any Object-Shaped Success Payload
* **Location:** `src/snapshot-service.js` (Lines 15-25)
* **Failure Mode:** `assertApiResult()` treats any object with `status === 1` as valid and does not validate action-specific fields for snapshot list, diff, create, restore, or delete responses. Backend schema drift can therefore pass this boundary and fail later in callers.
* **Impact:** Silent contract drift and late-failing snapshot workflows.
* **Required Fix:** Validate response schema per snapshot action before returning data to callers.
* **Required Fixture:** Add snapshot-service tests for each API action that prove malformed `status: 1` payloads are rejected when required fields are missing.
* **Status:** Open