- **File:** `src/snapshot-service.js` (line 30)
- **Severity:** critical
- **Category:** Functional Bug
- **Description:** The `validateSnapshotResponse` function checks `typeof response !== 'object'` to return false early. However, `typeof null === 'object'` is true in JavaScript. If `response === null`, the first check passes (does not return), and the code proceeds to line 31 where it attempts to access `response.key` on null, causing a TypeError.
- **Failure Mode:** When `fetchSnapshot` receives a `null` response from network, the validation throws `Cannot read property 'key' of null` instead of returning false and throwing the intended "Invalid snapshot response" error.

---

- **File:** `tests/document-state-core.test.js` (line 137)
- **Severity:** high
- **Category:** Functional Bug
- **Description:** The test uses `this.name` in the expected value, where `this` refers to the test context object, not the `DocumentState` instance. The state object's name is `'test'` (line 133), but the assertion compares against `this.name` from the test suite, which is undefined.
- **Failure Mode:** The test fails with a mismatch: expected `{ name: undefined }` but state emits `{ name: 'test' }`. The test passes accidentally only if `undefined` happens to be falsy-equivalent in the mock, but the assertion is incorrect.

---

- **File:** `src/editor-fullscreen.js` (line 72)
- **Severity:** high
- **Category:** Silent Failure
- **Description:** The fallback `resolveIdentity(editorEl) || resolveIdentity(container)` silently attempts secondary resolution without logging or propagating the failure. If the primary element lacks proper identity markers, the editor proceeds with a potentially incorrect or undefined key from the container, masking misconfiguration.
- **Failure Mode:** If `editorEl` lacks `data-mfe` or `data-mfe-key`, the editor silently tries `container` instead. If both fail, `key` becomes null, and line 75's check `if (!key) return;` exits silently without error or user feedback, leaving the session in an invalid state.

---

- **File:** `src/fullscreen-post-save-sync.js` (lines 4–10)
- **Severity:** high
- **Category:** Security
- **Description:** The HTML sanitization patterns use string-based regex that check for literal tag syntax (e.g., `/<script[\s\S]*?>/i`). These patterns can be bypassed by HTML entities (e.g., `&#60;script&#62;`), Unicode escapes (e.g., `\x3cscript\x3e`), or case variations in attribute names. The sanitized fragment is then injected into the DOM via `target.innerHTML = fragment`.
- **Failure Mode:** An attacker can inject `&#60;script&#62;alert(1)&#60;/script&#62;` into a fragment, bypass the regex check, and have the HTML entity decoded and executed when set as `innerHTML`, resulting in XSS.

---

- **File:** `src/identity-resolver.js` (line 12)
- **Severity:** medium
- **Category:** DRY / Dead Code
- **Description:** The expression `parts.length === 3 ? parts.join('/') : mfe` splits `mfe` by `/`, then unconditionally returns `mfe` (either by rejoining 3 parts or returning as-is). This always returns the original `mfe` string unchanged. The split-rejoin branch is dead code and the conditional is misleading given the comment claims special handling for three-part paths.
- **Failure Mode:** No runtime failure, but the code is confusing and suggests incomplete refactoring. The intent (if any) of the three-part check is not implemented.
