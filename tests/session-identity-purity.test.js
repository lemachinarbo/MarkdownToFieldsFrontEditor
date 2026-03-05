import fs from "node:fs";
import path from "node:path";

import {
  buildSessionStateId,
  resolveRequestedOriginKey,
  resolveSessionOriginFieldKey,
  resolveSessionIdentityEnvelope,
  buildTranslationHydrationKey,
  isScopeRebasedOrigin,
} from "../src/session-identity.js";

const ROOT = path.resolve(process.cwd());
const SESSION_IDENTITY_PATH = path.join(ROOT, "src/session-identity.js");

describe("session-identity purity", () => {
  test("module does not reference DOM or editor runtime", () => {
    const source = fs.readFileSync(SESSION_IDENTITY_PATH, "utf8");
    expect(source).not.toMatch(/\bwindow\b/);
    expect(source).not.toMatch(/\bdocument\b/);
    expect(source).not.toMatch(/\bElement\b/);
    expect(source).not.toMatch(/@tiptap|Editor/);
  });

  test("buildSessionStateId is deterministic", () => {
    const first = buildSessionStateId("123", "field:hero:title");
    const second = buildSessionStateId("123", "field:hero:title");
    expect(first).toBe(second);
    expect(first.startsWith("123:s")).toBe(true);
  });

  test("resolveRequestedOriginKey uses explicit precedence", () => {
    expect(
      resolveRequestedOriginKey({
        rawOriginKey: "raw:key",
        originKey: "origin:key",
        fieldId: "field:id",
      }),
    ).toBe("raw:key");
    expect(
      resolveRequestedOriginKey({ originKey: "origin:key", fieldId: "f" }),
    ).toBe("origin:key");
    expect(resolveRequestedOriginKey({ fieldId: "field:id" })).toBe("field:id");
    expect(
      resolveRequestedOriginKey({}, { fallbackFieldId: "fallback:id" }),
    ).toBe("fallback:id");
  });

  test("resolveSessionOriginFieldKey preserves origin only for stable session", () => {
    const payload = { originKey: "new:origin" };
    const preserved = resolveSessionOriginFieldKey(payload, {
      pageId: "1",
      activeSessionStateId: "session:1",
      activePageId: "1",
      activeOriginFieldKey: "active:origin",
      requestedOriginKey: "new:origin",
    });
    expect(preserved).toBe("active:origin");

    const plain = resolveSessionOriginFieldKey(payload, {
      pageId: "1",
      activeSessionStateId: "",
      activePageId: "1",
      activeOriginFieldKey: "active:origin",
      requestedOriginKey: "new:origin",
    });
    expect(plain).toBe("new:origin");
  });

  test("isScopeRebasedOrigin detects same-tail rebases", () => {
    expect(
      isScopeRebasedOrigin("1:field:hero:title", "1:section:hero:title"),
    ).toBe(true);
    expect(
      isScopeRebasedOrigin("1:field:hero:title", "1:field:hero:intro"),
    ).toBe(false);
  });

  test("resolveSessionIdentityEnvelope reuses active same-page session", () => {
    const envelope = resolveSessionIdentityEnvelope(
      {
        pageId: "1",
        fieldId: "1:section::hero",
        originKey: "1:section::hero",
      },
      {
        activeSessionStateId: "session:stable",
        activePageId: "1",
        activeOriginFieldKey: "field:hero:title",
      },
    );

    expect(envelope.originFieldKey).toBe("field:hero:title");
    expect(envelope.sessionStateId).toBe("session:stable");
  });

  test("buildTranslationHydrationKey prefers session identity", () => {
    expect(
      buildTranslationHydrationKey({ sessionStateId: "session:stable" }),
    ).toBe("session:stable");
    expect(
      buildTranslationHydrationKey({
        originKey: "field:hero:title",
        pageId: "1",
        scope: "field",
      }),
    ).toBe("");
  });

  test("session identity does not depend on navigation source hints", () => {
    const payload = {
      pageId: "1",
      fieldId: "1:field:hero:title",
      originKey: "1:field:hero:title",
    };

    const breadcrumbLike = resolveSessionIdentityEnvelope(payload, {
      activeSessionStateId: "session:stable",
      activePageId: "1",
      activeOriginFieldKey: "field:hero:title",
      preserveActiveOrigin: true,
    });

    const normalFlow = resolveSessionIdentityEnvelope(payload, {
      activeSessionStateId: "session:stable",
      activePageId: "1",
      activeOriginFieldKey: "field:hero:title",
      preserveActiveOrigin: false,
    });

    expect(breadcrumbLike.sessionStateId).toBe(normalFlow.sessionStateId);
    expect(breadcrumbLike.originFieldKey).toBe(normalFlow.originFieldKey);
  });
});
