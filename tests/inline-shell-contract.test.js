import {
  setInlineShellOpen,
  setInlineDebugShell,
  setInlineLabelStyle,
  isInlineShellOpen,
} from "../src/inline-shell.js";

describe("Inline shell contract", () => {
  afterEach(() => {
    delete global.document;
  });

  test("toggles inline shell class", () => {
    const add = jest.fn();
    const remove = jest.fn();
    global.document = {
      body: {
        classList: { add, remove, contains: jest.fn(() => true) },
      },
    };

    setInlineShellOpen(true);
    setInlineShellOpen(false);

    expect(add).toHaveBeenCalledWith("mfe-state-inline-open");
    expect(remove).toHaveBeenCalledWith("mfe-state-inline-open");
  });

  test("applies inline debug shell classes", () => {
    const add = jest.fn();
    global.document = { body: { classList: { add } } };

    setInlineDebugShell({ showSections: true, showLabels: true });

    expect(add).toHaveBeenCalledWith("mfe-debug-sections");
    expect(add).toHaveBeenCalledWith("mfe-debug-labels");
  });

  test("sets label style attribute", () => {
    const setAttribute = jest.fn();
    global.document = { body: { setAttribute } };

    setInlineLabelStyle("outside");

    expect(setAttribute).toHaveBeenCalledWith(
      "data-mfe-label-style",
      "outside",
    );
  });

  test("reports inline shell open state", () => {
    global.document = {
      body: {
        classList: { contains: jest.fn(() => true) },
      },
    };

    expect(isInlineShellOpen()).toBe(true);
  });
});
