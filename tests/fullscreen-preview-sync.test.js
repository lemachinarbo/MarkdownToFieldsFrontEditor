/** @jest-environment jsdom */

import { applyDatastarPatchToNodes } from "../src/fullscreen-preview-sync.js";

describe("fullscreen preview sync fragment boundary", () => {
  test("rejects fragment payloads with script tags and inline event handlers before DOM mutation", () => {
    document.body.innerHTML = '<div id="target"><span>safe</span></div>';
    const target = document.getElementById("target");
    const hostileHtml =
      '<div id="target"><script>alert(1)</script><button onclick="alert(2)">Click</button></div>';

    expect(() =>
      applyDatastarPatchToNodes({
        nodes: [target],
        mode: "inner",
        elements: hostileHtml,
        cycleId: 7,
      }),
    ).toThrow(/disallowed|unsafe|sanitize/i);

    expect(target.innerHTML).toBe("<span>safe</span>");
    expect(target.getAttribute("data-mfe-last-patch")).toBeNull();
    expect(document.body.querySelector("script")).toBeNull();
    expect(document.body.querySelector("[onclick]")).toBeNull();
  });
});
