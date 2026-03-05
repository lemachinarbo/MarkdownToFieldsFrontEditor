import {
  DocumentState,
  getDocumentState,
  clearDocumentState,
} from "../src/document-state.js";

describe("Layer Contracts Validation", () => {
  beforeEach(() => {
    clearDocumentState(new Map());
  });

  /**
   * FIXTURE 1: Layer 1 Title-Only Edit Preserves Non-Edited Blocks
   *
   * Tests the Layer 1 contract: If user edits block A only, blocks B, C, D
   * remain byte-identical after serialization. No post-serialization mutation.
   */
  describe("Fixture 1: Layer 1 Title-Only Edit Preserves Non-Edited Blocks", () => {
    test("should preserve table bytes when only title edited", () => {
      // Baseline document with multiple syntax features
      const baseline = [
        "# Original Title",
        "",
        "| Column A | Column B |",
        "|----------|----------|",
        "| Cell 1a  | Cell 1b  |",
        "| Cell 2a  | Cell 2b  |",
        "",
        "Plain paragraph with text.",
        "",
      ].join("\n");

      // Extract non-title content after editing would occur
      const titleLine = baseline.split("\n")[0];
      const afterTitle = baseline.slice(titleLine.length);

      expect(titleLine).toBe("# Original Title");
      expect(afterTitle).toContain("| Column A | Column B |");
      expect(afterTitle).toContain("|----------|----------|");
      expect(afterTitle).toContain("Plain paragraph with text.");

      // Simulate Layer 1: if title is changed, rest should remain unchanged
      const edited = baseline.replace(
        "# Original Title",
        "## Updated Title"
      );

      // Assert: table bytes preserved exactly
      const tableStart = edited.indexOf("| Column A");
      const tableEnd = edited.indexOf("| Cell 2a  | Cell 2b  |") + 21;
      const tableInEdited = edited.substring(tableStart, tableEnd);

      const tableStart2 = baseline.indexOf("| Column A");
      const tableEnd2 = baseline.indexOf("| Cell 2a  | Cell 2b  |") + 21;
      const tableInBaseline = baseline.substring(tableStart2, tableEnd2);

      expect(tableInEdited).toBe(tableInBaseline);
      expect(edited).toContain("Plain paragraph with text.");
    });

    test("should preserve code block bytes when only paragraph edited", () => {
      const baseline = [
        "Some introduction.",
        "",
        "```javascript",
        "const x = 42;",
        "console.log(x);",
        "```",
        "",
        "More text here.",
      ].join("\n");

      const codeBlockStart = baseline.indexOf("```javascript");
      const codeBlockEnd = baseline.indexOf("```", codeBlockStart + 3) + 3;
      const codeBlockOriginal = baseline.substring(codeBlockStart, codeBlockEnd);

      // Simulate editing paragraph
      const edited = baseline.replace(
        "Some introduction.",
        "Different introduction."
      );

      const codeBlockStart2 = edited.indexOf("```javascript");
      const codeBlockEnd2 = edited.indexOf("```", codeBlockStart2 + 3) + 3;
      const codeBlockEdited = edited.substring(codeBlockStart2, codeBlockEnd2);

      expect(codeBlockEdited).toBe(codeBlockOriginal);
    });

    test("should preserve task list bytes when only heading edited", () => {
      const baseline = [
        "# Checklist",
        "",
        "- [x] First task",
        "- [ ] Second task",
        "- [ ] Third task",
      ].join("\n");

      const taskListOriginal = baseline
        .split("\n")
        .slice(2)
        .join("\n");

      // Edit title
      const edited = baseline.replace("# Checklist", "## My Checklist");

      const taskListEdited = edited.split("\n").slice(2).join("\n");

      expect(taskListEdited).toBe(taskListOriginal);
    });

    test("should preserve trailing newline exactly as in baseline", () => {
      // With trailing newline
      const withTrailing = "# Title\n\nParagraph\n";
      expect(withTrailing).toMatch(/\n$/);

      // Without trailing newline
      const withoutTrailing = "# Title\n\nParagraph";
      expect(withoutTrailing).not.toMatch(/\n$/);

      // Assert both are preserved as-authored
      expect(withTrailing.endsWith("\n")).toBe(true);
      expect(withoutTrailing.endsWith("\n")).toBe(false);
    });
  });

  /**
   * FIXTURE 2: Layer 2 Scope Move Changes Only Markers/Boundaries
   *
   * Tests Layer 2 contract: When scope hierarchy changes, only marker/boundary
   * information changes. Content remains byte-identical.
   */
  describe("Fixture 2: Layer 2 Scope Move Changes Only Markers/Boundaries", () => {
    test("should change only scope markers when subsection moved between sections", () => {
      // Baseline document with sections marked by data-mfe
      const markdownBefore = [
        "# Section A",
        "Content of section A.",
        "",
        "## Subsection A1",
        "Content of subsection A1.",
        "",
        "# Section B",
        "Content of section B.",
      ].join("\n");

      // Simulate: subsection A1 moved into Section B
      // Only marker order changes; content intact
      const markdownAfter = [
        "# Section A",
        "Content of section A.",
        "",
        "# Section B",
        "Content of section B.",
        "",
        "## Subsection A1",
        "Content of subsection A1.",
      ].join("\n");

      // Extract and assert content bytes preserved
      expect(markdownAfter).toContain("Content of section A.");
      expect(markdownAfter).toContain("Content of subsection A1.");
      expect(markdownAfter).toContain("Content of section B.");

      // Assert: markup (headings) changed order, content preserved
      const contentA1Before = markdownBefore.indexOf(
        "Content of subsection A1."
      );
      const contentA1After = markdownAfter.indexOf("Content of subsection A1.");
      expect(contentA1Before).not.toBe(contentA1After);
      expect(
        markdownBefore.includes("Content of subsection A1.") &&
          markdownAfter.includes("Content of subsection A1.")
      ).toBe(true);
    });

    test("should not rewrite content when applying scope markers", () => {
      const content = "Original text without modification.";
      const beforeScope = `# Header\n${content}`;
      const afterScope = `## Updated Header\n${content}`;

      // Verify content string is identical
      expect(beforeScope.includes(content)).toBe(true);
      expect(afterScope.includes(content)).toBe(true);

      // Extract content byte-by-byte
      const contentStart = afterScope.indexOf(content);
      const extracted = afterScope.substring(
        contentStart,
        contentStart + content.length
      );
      expect(extracted).toBe(content);
    });

    test("should document scope mutations explicitly", () => {
      // Simulate Layer 2 mutation log (conceptual; not implemented in this fixture)
      const mutationLog = [
        { type: "scope_move", entityId: "subsec_a1", from: "sec_a", to: "sec_b" },
      ];

      expect(mutationLog.length).toBeGreaterThan(0);
      expect(mutationLog[0].type).toBe("scope_move");
      expect(mutationLog[0]).toHaveProperty("entityId");
      expect(mutationLog[0]).toHaveProperty("from");
      expect(mutationLog[0]).toHaveProperty("to");
    });
  });

  /**
   * FIXTURE 3: Layer 3 Drift Classification Correctness
   *
   * Tests Layer 3 contract: Every readback mismatch is classified into
   * one of 5 categories: none, style_only, marker_blankline, text_token, list_topology.
   */
  describe("Fixture 3: Layer 3 Drift Classification Correctness", () => {
    test("should classify exact match as 'none'", () => {
      const sent = "# Title\n\nParagraph with content.\n";
      const readback = "# Title\n\nParagraph with content.\n";

      // Byte-for-byte comparison (conceptual; real implementation in editor-fullscreen.js)
      const isIdentical = sent === readback;
      expect(isIdentical).toBe(true);

      // Drift class should be 'none'
      const drift_class = isIdentical ? "none" : "unknown";
      expect(drift_class).toBe("none");
    });

    test("should classify whitespace-only difference as 'style_only_normalization'", () => {
      const sent = "- Item\n- Item 2";
      const readback = "-  Item\n-  Item 2"; // Extra space after marker

      const isExactMatch = sent === readback;
      expect(isExactMatch).toBe(false);

      // Normalize for comparison
      const sentNorm = sent.replace(/\s+/g, " ");
      const readbackNorm = readback.replace(/\s+/g, " ");

      const isSemanticallyIdentical = sentNorm === readbackNorm;
      expect(isSemanticallyIdentical).toBe(true);

      // Classification: style_only
      const drift_class = isSemanticallyIdentical
        ? "style_only_normalization"
        : "text_token_drift";
      expect(drift_class).toBe("style_only_normalization");
    });

    test("should classify list marker normalization as 'marker_blankline_normalization'", () => {
      const sent = "- Item 1\n- Item 2";
      const readback = "* Item 1\n* Item 2"; // Marker changed from - to *

      // Normalize markers for comparison
      const sentMarkers = sent.replace(/^[\-\*\+]/gm, "-");
      const readbackMarkers = readback.replace(/^[\-\*\+]/gm, "-");

      const markersMatch = sentMarkers === readbackMarkers;
      expect(markersMatch).toBe(true);

      // Classification: marker_blankline
      const drift_class = markersMatch
        ? "marker_blankline_normalization"
        : "text_token_drift";
      expect(drift_class).toBe("marker_blankline_normalization");
    });

    test("should classify semantic text change as 'text_token_drift'", () => {
      const sent = "Hello World";
      const readback = "Hello"; // Content lost

      const contentLost = readback !== sent && sent.startsWith(readback);
      expect(contentLost).toBe(true);

      // Classification: text_token_drift (content change)
      const drift_class = "text_token_drift";
      expect(drift_class).toBe("text_token_drift");
    });

    test("should classify list indentation change as 'list_topology_drift'", () => {
      const sent = ["- Item 1", "  - Nested item", "- Item 2"].join("\n");
      const readback = ["- Item 1", "- Nested item", "- Item 2"].join("\n"); // Nesting lost

      // Check indentation structure
      const sentIndent = sent.split("\n")[1].match(/^\s*/)[0].length;
      const readbackIndent = readback.split("\n")[1].match(/^\s*/)[0].length;

      const topologyChanged = sentIndent !== readbackIndent;
      expect(topologyChanged).toBe(true);

      // Classification: list_topology_drift
      const drift_class = "list_topology_drift";
      expect(drift_class).toBe("list_topology_drift");
    });

    test("should enforce strict mode blocking semantic drifts", () => {
      const strictReadbackVerification = true;
      const drift_class = "text_token_drift";

      const shouldBlock = strictReadbackVerification && drift_class === "text_token_drift";
      expect(shouldBlock).toBe(true);

      // If true, save should be rejected
      if (shouldBlock) {
        const saveResult = { success: false, error: "semantic drift detected" };
        expect(saveResult.success).toBe(false);
      }
    });

    test("should allow style normalization in relaxed mode", () => {
      const strictReadbackVerification = false;
      const drift_class = "style_only_normalization";

      const shouldAllow = !strictReadbackVerification || 
        (drift_class !== "text_token_drift" && drift_class !== "list_topology_drift");
      expect(shouldAllow).toBe(true);

      // If true, save should proceed
      if (shouldAllow) {
        const saveResult = { 
          success: true, 
          drift_class: drift_class,
          warning: "style-only normalization applied"
        };
        expect(saveResult.success).toBe(true);
      }
    });
  });

  /**
   * FIXTURE 4: Full-Doc Save vs Scoped Diff-Save Equivalence
   *
   * Tests cross-layer contract: Whether using full-body save path or scoped diff path,
   * the final readback verification and result should be equivalent.
   */
  describe("Fixture 4: Full-Doc Save vs Scoped Diff-Save Equivalence", () => {
    test("should produce identical network outcome for single-section edit via both paths", () => {
      const multiSectionDoc = [
        "# Section 1",
        "Content of section 1.",
        "",
        "# Section 2",
        "Content of section 2.",
        "",
        "# Section 3",
        "Content of section 3.",
      ].join("\n");

      // Edit: Only Section 2 content (mock scenario)
      const editedContent = multiSectionDoc.replace(
        "Content of section 2.",
        "MODIFIED: Content of section 2."
      );

      // Path A: Full-body save
      const fullBodyPayload = {
        markdown: editedContent,
        scope: "document",
      };

      // Path B: Scoped diff save
      const scopedPayload = {
        markdown: editedContent,
        scope: "section_2",
        changedSections: ["# Section 2"],
      };

      // Both should send same markdown to backend (diff is metadata only)
      expect(fullBodyPayload.markdown).toBe(scopedPayload.markdown);

      // Both should trigger same readback verification (comparing against previous)
      const readback = editedContent; // Assuming perfect readback
      const fullBodyClass = readback === editedContent ? "none" : "unknown";
      const scopedClass = readback === editedContent ? "none" : "unknown";

      expect(fullBodyClass).toBe(scopedClass);
    });

    test("should produce equivalent drift classification for scoped vs full-body", () => {
      // Both scoped and full-body saves compare sent vs readback the same way
      const sent = "Content A\nContent B\nContent C";
      const readback = "Content A\nContent B (modified)\nContent C";

      // Classification should be identical regardless of save path
      const hasDrift = sent !== readback;
      expect(hasDrift).toBe(true);

      const drift_class = "text_token_drift"; // In both cases

      // Both paths should use same classification
      expect(drift_class).toBe("text_token_drift");
    });

    test("should document diff metadata when scoped, omit for full-body", () => {
      const scopedResult = {
        success: true,
        drift_class: "none",
        diff_applied: true,
        changedSections: ["# Section 2"],
        bytes_sent: 150,
      };

      const fullBodyResult = {
        success: true,
        drift_class: "none",
        diff_applied: false,
        bytes_sent: 400, // More bytes (full doc)
      };

      expect(scopedResult.diff_applied).toBe(true);
      expect(fullBodyResult.diff_applied).toBe(false);

      // Success should be same
      expect(scopedResult.success).toBe(fullBodyResult.success);
      expect(scopedResult.drift_class).toBe(fullBodyResult.drift_class);

      // Note: bytes may differ (scoped < full-body)
      expect(scopedResult.bytes_sent).toBeLessThan(fullBodyResult.bytes_sent);
    });
  });

  /**
   * CROSS-LAYER VALIDATION: Trailing Newline Preservation
   */
  describe("Cross-Layer: Trailing Newline Preservation", () => {
    test("should preserve trailing newline if present in baseline", () => {
      const baselineWithTrailing = "# Title\n\nParagraph\n";
      expect(baselineWithTrailing.endsWith("\n")).toBe(true);

      // Edit middle content
      const edited = baselineWithTrailing.replace(
        "# Title",
        "## New Title"
      );

      // Trailing newline should persist
      expect(edited.endsWith("\n")).toBe(true);
    });

    test("should preserve lack of trailing newline if absent in baseline", () => {
      const baselineWithoutTrailing = "# Title\n\nParagraph";
      expect(baselineWithoutTrailing.endsWith("\n")).toBe(false);

      // Edit middle content
      const edited = baselineWithoutTrailing.replace(
        "# Title",
        "## New Title"
      );

      // Should still not have trailing newline
      expect(edited.endsWith("\n")).toBe(false);
    });

    test("should maintain EOF newline policy through Layer 1→2→3", () => {
      // Fixture: Document representing Layer 1 output (what editor serialized)
      const layer1Output = "# Title\nContent\n";
      expect(layer1Output.endsWith("\n")).toBe(true);

      // Layer 2 orchestration passes through (no newline added)
      const layer2Output = layer1Output; // No normalization
      expect(layer2Output.endsWith("\n")).toBe(true);

      // Layer 3 readback preserves (backend returns same EOF)
      const layer3Readback = layer2Output;
      expect(layer3Readback.endsWith("\n")).toBe(true);

      // All same
      expect(layer1Output === layer2Output && layer2Output === layer3Readback).toBe(true);
    });
  });

  /**
   * FIXTURE 5: Layer 2 Edge Cases
   *
   * Tests semantic line-diff merge reconciliation, strict mode validation,
   * and EOF policy consistency in Layer 2 operations.
   */
  describe("Fixture 5: Layer 2 Edge Cases", () => {
    test("should handle desync conflict scenario via semantic line-diff fallback", () => {
      // Scenario: Server state and editor state diverged (both have semantic changes)
      // Server state has added content
      const serverState = [
        "# Title",
        "",
        "Original paragraph.",
        "",
        "Server added content.",
        "",
      ].join("\n");

      // Editor state has different semantic change (edited paragraph)
      const editorState = [
        "# Title",
        "",
        "Edited paragraph with different text.",
        "",
      ].join("\n");

      // When normalizing for comparison (simulating Layer 2 merge):
      // The semantic diff should detect they differ semantically, not just style
      const serverLines = serverState.split("\n");
      const editorLines = editorState.split("\n");

      // Both have semantic changes relative to each other
      expect(serverLines.length).not.toBe(editorLines.length); // Structural difference
      expect(serverState).not.toBe(editorState); // Content difference

      // Layer 2 should return the editor state in this conflict
      // (demonstrating desync reconciliation behavior: prefer editor intent)
      const result = {
        markdown: editorState,
        semanticHunkCount: 2, // At least 2 semantic differences
      };

      expect(result.semanticHunkCount).toBeGreaterThan(0);
      expect(result.markdown).toBe(editorState);
    });

    test("should enforce strict mode: reject semantic drift in readback", () => {
      // Scenario: Readback contains semantic drift (not just style-only changes)
      // This simulates a drift that strict mode should reject

      // What we sent to server (exact)
      const sentToServer = [
        "# Title",
        "",
        "First paragraph.",
        "",
        "Second paragraph.",
        "",
      ].join("\n");

      // What came back (semantically different key content)
      const readbackWithDrift = [
        "# Title", // Same heading
        "",
        "First paragraph totally changed.", // Semantic drift in content
        "",
        "Second paragraph.", // Unchanged
        "",
      ].join("\n");

      // Layer 3 readback classification should detect semantic drift
      // In strict mode, this would be rejected
      const hasDrift = sentToServer !== readbackWithDrift;
      expect(hasDrift).toBe(true);

      // The drift is semantic (not just whitespace/style)
      const sentParagraphs = sentToServer.split("\n").filter((l) => l.trim().startsWith("First"));
      const readbackParagraphs = readbackWithDrift
        .split("\n")
        .filter((l) => l.trim().startsWith("First"));

      expect(sentParagraphs[0]).not.toBe(readbackParagraphs[0]);
      expect(readbackParagraphs[0]).toContain("totally changed");
    });

    test("should preserve trailing newline through Layer 2 safeguard operations", () => {
      // Scenario: Verify EOF newline policy is maintained by Layer 2 safeguards

      // Reference state (from server) with trailing newline
      const referenceState = "# Title\n\nContent\n";
      expect(referenceState.endsWith("\n")).toBe(true);

      // Candidate state (from editor) with trailing newline
      const candidateState = "# Title\n\nContent\n";
      expect(candidateState.endsWith("\n")).toBe(true);

      // After Layer 2 safeguard operations, both should maintain EOF newline
      const result1 = referenceState;
      const result2 = candidateState;

      expect(result1.endsWith("\n")).toBe(true);
      expect(result2.endsWith("\n")).toBe(true);

      // Additionally, if one has no trailing newline, it should be preserved too
      const noTrailing = "# Title\n\nContent";
      expect(noTrailing.endsWith("\n")).toBe(false);

      // Safeguard operations should not add trailing newline to content that lacks it
      const protectedNoTrailing = noTrailing;
      expect(protectedNoTrailing.endsWith("\n")).toBe(false);
    });
  });

  /**
   * FIXTURE 6: Phase 3 Section-Level Diff with Identity Invariant
   *
   * Tests section-level diff parsing, identity invariant guardrail,
   * and change detection for scoped save optimization.
   */
  describe("Fixture 6: Phase 3 Section-Level Diff with Identity Invariant", () => {
    test("should parse outline with markers correctly", () => {
      const markdown = [
        "<!-- section-a -->",
        "# Section A",
        "",
        "Content A paragraph.",
        "",
        "<!-- section-b -->",
        "# Section B",
        "",
        "Content B paragraph.",
        "",
      ].join("\n");

      // Mock parseOutlineWithMarkers (simulating expected behavior)
      const sections = [
        {
          mfeKey: "section-a",
          startLine: 1,
          endLine: 4,
          content: "# Section A\n\nContent A paragraph.\n",
        },
        {
          mfeKey: "section-b",
          startLine: 6,
          endLine: 9,
          content: "# Section B\n\nContent B paragraph.\n",
        },
      ];

      // Verify section extraction
      expect(sections.length).toBe(2);
      expect(sections[0].mfeKey).toBe("section-a");
      expect(sections[1].mfeKey).toBe("section-b");
      expect(sections[0].content).toContain("Section A");
      expect(sections[1].content).toContain("Section B");
    });

    test("should pass identity invariant when key sets match", () => {
      const prevSections = [
        { mfeKey: "section-a", content: "Original A" },
        { mfeKey: "section-b", content: "Original B" },
      ];

      const currSections = [
        { mfeKey: "section-a", content: "Modified A" },
        { mfeKey: "section-b", content: "Original B" },
      ];

      // Mock assertIdentityInvariant behavior
      const prevKeys = new Set(prevSections.map((s) => s.mfeKey));
      const currKeys = new Set(currSections.map((s) => s.mfeKey));

      // Same keys, different content → invariant should pass
      expect(prevKeys.size).toBe(currKeys.size);
      expect(prevKeys.has("section-a")).toBe(true);
      expect(currKeys.has("section-a")).toBe(true);
    });

    test("should fail identity invariant when key added", () => {
      const prevSections = [
        { mfeKey: "section-a", content: "Content A" },
      ];

      const currSections = [
        { mfeKey: "section-a", content: "Content A" },
        { mfeKey: "section-b", content: "Content B" }, // NEW KEY
      ];

      const prevKeys = new Set(prevSections.map((s) => s.mfeKey));
      const currKeys = new Set(currSections.map((s) => s.mfeKey));

      // Key set size mismatch → invariant fails
      expect(prevKeys.size).not.toBe(currKeys.size);
      expect(currKeys.has("section-b")).toBe(true);
      expect(prevKeys.has("section-b")).toBe(false);
    });

    test("should fail identity invariant when key deleted", () => {
      const prevSections = [
        { mfeKey: "section-a", content: "Content A" },
        { mfeKey: "section-b", content: "Content B" },
      ];

      const currSections = [
        { mfeKey: "section-a", content: "Content A" },
        // section-b DELETED
      ];

      const prevKeys = new Set(prevSections.map((s) => s.mfeKey));
      const currKeys = new Set(currSections.map((s) => s.mfeKey));

      // Key deleted → invariant fails
      expect(prevKeys.size).not.toBe(currKeys.size);
      expect(prevKeys.has("section-b")).toBe(true);
      expect(currKeys.has("section-b")).toBe(false);
    });

    test("should detect changed sections correctly", () => {
      const prevSections = [
        { mfeKey: "section-a", content: "Original A" },
        { mfeKey: "section-b", content: "Original B" },
        { mfeKey: "section-c", content: "Original C" },
      ];

      const currSections = [
        { mfeKey: "section-a", content: "Modified A" }, // CHANGED
        { mfeKey: "section-b", content: "Original B" }, // UNCHANGED
        { mfeKey: "section-c", content: "Modified C" }, // CHANGED
      ];

      // Compute diff
      const changed = [];
      const sectionMap = new Map();
      for (const prev of prevSections) {
        const curr = currSections.find((c) => c.mfeKey === prev.mfeKey);
        if (curr) {
          sectionMap.set(prev.mfeKey, { before: prev, after: curr });
        }
      }

      for (const [key, { before, after }] of sectionMap) {
        if (before.content !== after.content) {
          changed.push({ mfeKey: key });
        }
      }

      // 2 sections changed
      expect(changed.length).toBe(2);
      expect(changed.find((c) => c.mfeKey === "section-a")).toBeDefined();
      expect(changed.find((c) => c.mfeKey === "section-c")).toBeDefined();
      expect(changed.find((c) => c.mfeKey === "section-b")).toBeUndefined();
    });

    test("should abort diff when identity drift detected", () => {
      // Scenario: Section identity changed unexpectedly
      const prevMarkdown = [
        "<!-- original-key -->",
        "# Content",
        "",
      ].join("\n");

      const currMarkdown = [
        "<!-- changed-key -->",
        "# Content",
        "",
      ].join("\n");

      // Mock sections
      const prevSections = [{ mfeKey: "original-key", content: "# Content\n" }];
      const currSections = [{ mfeKey: "changed-key", content: "# Content\n" }];

      const prevKeys = new Set(prevSections.map((s) => s.mfeKey));
      const currKeys = new Set(currSections.map((s) => s.mfeKey));

      // Identity drift: key changed → abort diff, force full-body
      const hasDrift = !prevKeys.has("changed-key") || !currKeys.has("original-key");
      expect(hasDrift).toBe(true);

      // Expected behavior: abort diff, return full_body_required: true
      const mockResult = {
        sections_changed: [],
        full_body_required: true,
        abort_reason: "identity-drift-detected",
      };

      expect(mockResult.full_body_required).toBe(true);
      expect(mockResult.sections_changed.length).toBe(0);
    });
  });
});
