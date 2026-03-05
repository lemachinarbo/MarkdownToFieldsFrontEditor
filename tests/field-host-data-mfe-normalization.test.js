/** @jest-environment jsdom */

import { normalizeFieldHostIdentity } from "../src/editor-shared-helpers.js";

describe("normalizeFieldHostIdentity", () => {
  afterEach(() => {
    delete window.MarkdownFrontEditorConfig;
    jest.restoreAllMocks();
  });

  test("normalizes all field host identities and writes metadata", () => {
    document.body.innerHTML = [
      '<div class="fe-editable" data-mfe-scope="field" data-mfe-name="title" data-mfe-section="hero"></div>',
      '<div class="fe-editable" data-mfe-scope="field" data-mfe-name="title" data-mfe-section="methods" data-mfe-subsection="top"></div>',
      '<div class="fe-editable" data-mfe-scope="field" data-mfe-name="intro" data-mfe="field:legacy/wrong"></div>',
      '<div class="fe-editable" data-mfe-scope="section" data-mfe-name="hero"></div>',
    ].join("");

    const changed = normalizeFieldHostIdentity(document);

    const nodes = Array.from(document.querySelectorAll(".fe-editable"));
    expect(changed).toBe(3);
    expect(nodes[0].getAttribute("data-mfe")).toBe("field:hero/title");
    expect(nodes[0].getAttribute("data-mfe-key")).toBe("field:hero:title");
    expect(nodes[0].getAttribute("data-mfe-origin")).toBe("auto");
    expect(nodes[1].getAttribute("data-mfe")).toBe("field:methods/top/title");
    expect(nodes[1].getAttribute("data-mfe-key")).toBe(
      "subsection:methods:top:title",
    );
    expect(nodes[1].getAttribute("data-mfe-origin")).toBe("auto");
    expect(nodes[2].getAttribute("data-mfe")).toBe("field:intro");
    expect(nodes[2].getAttribute("data-mfe-key")).toBe("field:intro");
    expect(nodes[2].getAttribute("data-mfe-origin")).toBe("manual");
    expect(nodes[3].getAttribute("data-mfe")).toBeNull();
  });

  test("warns in debug mode when manual data-mfe is rewritten", () => {
    window.MarkdownFrontEditorConfig = { debug: true };
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML =
      '<div class="fe-editable" data-mfe-scope="field" data-mfe-name="intro" data-mfe-section="hero" data-mfe="field:legacy/wrong"></div>';

    normalizeFieldHostIdentity(document);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, payload] = warnSpy.mock.calls[0];
    expect(message).toBe("[mfe:host-identity] manual data-mfe rewritten");
    expect(payload.previous).toBe("field:legacy/wrong");
    expect(payload.normalized).toBe("field:hero/intro");
  });

  test("does not warn when debug is false or missing", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML =
      '<div class="fe-editable" data-mfe-scope="field" data-mfe-name="intro" data-mfe-section="hero" data-mfe="field:legacy/wrong"></div>';
    window.MarkdownFrontEditorConfig = { debug: false };
    normalizeFieldHostIdentity(document);

    delete window.MarkdownFrontEditorConfig;
    normalizeFieldHostIdentity(document);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("normalizes dynamically added field hosts on subsequent pass", () => {
    document.body.innerHTML =
      '<div class="fe-editable" data-mfe-scope="field" data-mfe-name="title" data-mfe-section="hero"></div>';

    expect(normalizeFieldHostIdentity(document)).toBe(1);

    const dynamic = document.createElement("div");
    dynamic.className = "fe-editable";
    dynamic.setAttribute("data-mfe-scope", "field");
    dynamic.setAttribute("data-mfe-name", "subtitle");
    dynamic.setAttribute("data-mfe-section", "hero");
    document.body.appendChild(dynamic);

    const changed = normalizeFieldHostIdentity(document);
    expect(changed).toBe(1);
    expect(dynamic.getAttribute("data-mfe")).toBe("field:hero/subtitle");
    expect(dynamic.getAttribute("data-mfe-key")).toBe("field:hero:subtitle");
  });
});
