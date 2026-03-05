import {
  setFullscreenShellOpen,
  setDocumentModeShellOpen,
} from "../src/fullscreen-shell.js";

describe("Fullscreen shell contract", () => {
  afterEach(() => {
    delete global.document;
  });

  test("enables fullscreen class", () => {
    const add = jest.fn();
    const remove = jest.fn();
    global.document = { body: { classList: { add, remove } } };

    setFullscreenShellOpen(true);

    expect(add).toHaveBeenCalledWith("mfe-state-fullscreen-open");
    expect(remove).not.toHaveBeenCalled();
  });

  test("disables fullscreen class", () => {
    const add = jest.fn();
    const remove = jest.fn();
    global.document = { body: { classList: { add, remove } } };

    setFullscreenShellOpen(false);

    expect(remove).toHaveBeenCalledWith("mfe-state-fullscreen-open");
    expect(add).not.toHaveBeenCalled();
  });

  test("is a safe no-op without document body", () => {
    expect(() => setFullscreenShellOpen(true)).not.toThrow();
    global.document = {};
    expect(() => setFullscreenShellOpen(false)).not.toThrow();
  });

  test("enables document mode class", () => {
    const add = jest.fn();
    const remove = jest.fn();
    global.document = { body: { classList: { add, remove } } };

    setDocumentModeShellOpen(true);

    expect(add).toHaveBeenCalledWith("mfe-state-document-mode");
    expect(remove).not.toHaveBeenCalled();
  });

  test("disables document mode class", () => {
    const add = jest.fn();
    const remove = jest.fn();
    global.document = { body: { classList: { add, remove } } };

    setDocumentModeShellOpen(false);

    expect(remove).toHaveBeenCalledWith("mfe-state-document-mode");
    expect(add).not.toHaveBeenCalled();
  });
});
