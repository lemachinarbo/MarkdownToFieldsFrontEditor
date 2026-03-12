import {
  buildScopeMutationContext,
  resolveNonReferenceScopeAuthorityForMutation,
  resolveReferenceScopeAuthorityForMutation,
  resolveScopeAuthorityForMutation,
  stampRuntimeProjectionIdentity,
  validateRuntimeProjectionForScopeContext,
} from "../src/canonical-edit-session.js";
import {
  projectCanonicalSlice,
  resolveCanonicalScopeSlice,
} from "../src/canonical-scope-session.js";
import { createScopeSession } from "../src/scope-session.js";
import { applyScopedEdit } from "../src/mutation-plan.js";
import { parseStructuralDocument } from "../src/structural-document.js";

const CANONICAL = [
  "<!-- section:hero -->",
  "",
  "<!-- title -->",
  "# The Urban <br>Farm",
  "",
  "<!-- intro... -->",
  "We grow food and ideas.",
  "",
  "<!-- section:body -->",
  "",
  "<!-- predictable -->",
  "Every harvest stays **predictable**.",
].join("\n");

function buildProjection(scopeMeta, canonicalBody = CANONICAL) {
  const scopeSlice = resolveCanonicalScopeSlice(canonicalBody, scopeMeta);
  const projection = projectCanonicalSlice(scopeSlice);
  return {
    scopeSlice,
    projection: stampRuntimeProjectionIdentity(projection, {
      stateId: "session:stable|en",
      scopeMeta,
      protectedSpans: scopeSlice.protectedSpans,
    }),
  };
}

describe("runtime projection authority", () => {
  test("reference scope authority rejects missing explicit scope meta even when fallback exists", () => {
    const authority = resolveReferenceScopeAuthorityForMutation({
      incomingScopeKind: "field",
      fallbackScopeKind: "document",
    });

    expect(authority.ok).toBe(false);
    expect(authority.reason).toBe("missing-explicit-scope-meta");
  });

  test("reference scope authority rejects incoming scope mismatches", () => {
    const authority = resolveReferenceScopeAuthorityForMutation({
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      },
      incomingScopeKind: "section",
    });

    expect(authority.ok).toBe(false);
    expect(authority.reason).toBe("incoming-scope-mismatch");
  });

  test("reference scope authority accepts matching scope context", () => {
    const authority = resolveReferenceScopeAuthorityForMutation({
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      },
      incomingScopeKind: "field",
    });

    expect(authority.ok).toBe(true);
    expect(authority.currentScopeKind).toBe("field");
    expect(authority.scopeMeta).toMatchObject({
      scopeKind: "field",
      section: "hero",
      name: "title",
    });
  });

  test("non-reference scope authority still allows fallback scope for compatibility", () => {
    const authority = resolveNonReferenceScopeAuthorityForMutation({
      incomingScopeKind: "document",
      fallbackScopeKind: "document",
    });

    expect(authority.ok).toBe(true);
    expect(authority.usedFallbackScope).toBe(true);
    expect(authority.currentScopeKind).toBe("document");
  });

  test("legacy scope authority alias remains permissive for non-reference callers", () => {
    const authority = resolveScopeAuthorityForMutation({
      incomingScopeKind: "document",
      fallbackScopeKind: "document",
    });

    expect(authority.ok).toBe(true);
    expect(authority.usedFallbackScope).toBe(true);
  });

  test("stale projection with correct state id but wrong scope key is rejected", () => {
    const fieldMeta = {
      scopeKind: "field",
      section: "hero",
      subsection: "",
      name: "title",
    };
    const sectionMeta = {
      scopeKind: "section",
      section: "hero",
      subsection: "",
      name: "hero",
    };
    const { projection: fieldProjection } = buildProjection(fieldMeta);
    const validation = validateRuntimeProjectionForScopeContext({
      runtimeProjection: fieldProjection,
      stateId: "session:stable|en",
      lang: "en",
      scopeMeta: sectionMeta,
      protectedSpans: resolveCanonicalScopeSlice(CANONICAL, sectionMeta)
        .protectedSpans,
    });

    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe("scope-key-mismatch");
  });

  test("projection with matching scope key but wrong fingerprint is rejected", () => {
    const scopeMeta = {
      scopeKind: "section",
      section: "hero",
      subsection: "",
      name: "hero",
    };
    const { scopeSlice, projection } = buildProjection(scopeMeta);
    const tampered = stampRuntimeProjectionIdentity(projection, {
      stateId: "session:stable|en",
      scopeMeta,
      protectedSpans: scopeSlice.protectedSpans,
      protectedSpanFingerprint: "tampered:fingerprint",
    });
    const validation = validateRuntimeProjectionForScopeContext({
      runtimeProjection: tampered,
      stateId: "session:stable|en",
      lang: "en",
      scopeMeta,
      protectedSpans: scopeSlice.protectedSpans,
    });

    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe("protected-span-fingerprint-mismatch");
  });

  test("matching projection is accepted only as an optimization", () => {
    const scopeMeta = {
      scopeKind: "section",
      section: "hero",
      subsection: "",
      name: "hero",
    };
    const { scopeSlice, projection } = buildProjection(scopeMeta);
    const validation = validateRuntimeProjectionForScopeContext({
      runtimeProjection: projection,
      stateId: "session:stable|en",
      lang: "en",
      scopeMeta,
      protectedSpans: scopeSlice.protectedSpans,
    });

    expect(validation.ok).toBe(true);
    expect(validation.runtimeProjection.projectionMeta.scopeKey).toBe(
      "section:hero",
    );
  });

  test("dirty roundtrip across field, section, document, and field keeps canonical body stable", () => {
    const scopes = [
      {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
        edit: "# The Urban <br>Farm v2",
      },
      {
        scopeKind: "section",
        section: "hero",
        subsection: "",
        name: "hero",
        edit: "# The Urban <br>Farm v2\n\nWe grow food and ideas. Safely.",
      },
      {
        scopeKind: "document",
        section: "",
        subsection: "",
        name: "document",
        edit:
          "# The Urban <br>Farm v2\n\nWe grow food and ideas. Safely.\n\nEvery harvest stays **predictable** forever.",
      },
      {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
        edit: "# The Urban <br>Farm v3",
      },
    ];

    let canonicalBody = CANONICAL;
    for (const scopeMeta of scopes) {
      const scopeSlice = resolveCanonicalScopeSlice(canonicalBody, scopeMeta);
      const projection = stampRuntimeProjectionIdentity(
        projectCanonicalSlice(scopeSlice),
        {
          stateId: "session:stable|en",
          scopeMeta,
          protectedSpans: scopeSlice.protectedSpans,
        },
      );
      const context = buildScopeMutationContext({
        stateId: "session:stable|en",
        lang: "en",
        scopeMeta,
        protectedSpans: scopeSlice.protectedSpans,
      });
      const validation = validateRuntimeProjectionForScopeContext({
        runtimeProjection: projection,
        stateId: context.stateId,
        lang: context.lang,
        scopeMeta: context,
        scopeKey: context.scopeKey,
        protectedSpans: scopeSlice.protectedSpans,
        structuralFingerprint: context.structuralFingerprint,
      });

      expect(validation.ok).toBe(true);

      const result = applyScopedEdit({
        session: createScopeSession({
          stateId: "session:stable|en",
          lang: "en",
          scopeMeta,
        }),
        structuralDocument: parseStructuralDocument(canonicalBody),
        editorContent: scopeMeta.edit,
        runtimeProjection: validation.runtimeProjection,
      });
      expect(result.ok).toBe(true);
      canonicalBody = result.canonicalBody;
    }

    expect(canonicalBody).toContain("# The Urban <br>Farm v3");
    expect(canonicalBody).toContain(
      "Every harvest stays **predictable** forever.",
    );
    expect(canonicalBody).toContain("<!-- intro... -->");
  });

  test("scope context remains explicit even when validation fails", () => {
    const scopeMeta = {
      scopeKind: "field",
      section: "hero",
      subsection: "",
      name: "title",
    };
    const { scopeSlice, projection } = buildProjection(scopeMeta);
    const validation = validateRuntimeProjectionForScopeContext({
      runtimeProjection: stampRuntimeProjectionIdentity(projection, {
        stateId: "session:other|en",
        scopeMeta,
        protectedSpans: scopeSlice.protectedSpans,
      }),
      stateId: "session:stable|en",
      lang: "en",
      scopeMeta,
      protectedSpans: scopeSlice.protectedSpans,
    });

    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe("state-id-mismatch");
    expect(validation.expectedContext.scopeKey).toBe("field:hero:title");
  });
});
