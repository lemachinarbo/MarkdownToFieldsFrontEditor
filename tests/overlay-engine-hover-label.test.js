/** @jest-environment jsdom */

import { createOverlayEngine } from "../src/overlay-engine.js";

describe("overlay engine hover label activation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.className = "";
  });

  test("toggles hover-active class when overlay is shown and hidden", () => {
    const engine = createOverlayEngine({ debugLabels: false });
    engine.init();

    engine.showBox({ left: 10, top: 20, right: 110, bottom: 80 });
    expect(document.body.classList.contains("mfe-state-hover-active")).toBe(
      true,
    );

    engine.hide();
    expect(document.body.classList.contains("mfe-state-hover-active")).toBe(
      false,
    );
  });

  test("showEdge also activates hover-active class", () => {
    const engine = createOverlayEngine({ debugLabels: false });
    engine.init();

    engine.showEdge({ left: 0, top: 0, right: 100, bottom: 1 });
    expect(document.body.classList.contains("mfe-state-hover-active")).toBe(
      true,
    );

    engine.hide();
    expect(document.body.classList.contains("mfe-state-hover-active")).toBe(
      false,
    );
  });

  test("does not activate overlay in debug labels mode", () => {
    const engine = createOverlayEngine({ debugLabels: true });
    engine.init();
    document.body.classList.add("mfe-debug-labels");

    engine.showBox({ left: 10, top: 20, right: 110, bottom: 80 });
    expect(document.body.classList.contains("mfe-state-hover-active")).toBe(
      false,
    );

    engine.showEdge({ left: 0, top: 0, right: 100, bottom: 1 });
    expect(document.body.classList.contains("mfe-state-hover-active")).toBe(
      false,
    );
  });
});
