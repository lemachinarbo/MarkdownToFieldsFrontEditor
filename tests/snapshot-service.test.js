import {
  listSnapshots,
  createSnapshot,
  getSnapshotDiff,
  checkExternalChange,
  restoreSnapshot,
  deleteSnapshot,
} from "../src/snapshot-service.js";

jest.mock("../src/network.js", () => ({
  request: jest.fn(),
}));
jest.mock("../src/editor-core.js", () => ({
  getSaveUrl: () => "/?markdownFrontEditorSave=1",
  fetchCsrfToken: async () => ({ name: "_token", value: "test" }),
}));

import { request } from "../src/network.js";

function okResult(data) {
  return { ok: true, status: 200, data };
}

describe("snapshot-service boundary validation", () => {
  beforeEach(() => {
    request.mockReset();
  });

  test("listSnapshots rejects status:1 payload missing snapshots field", async () => {
    request.mockResolvedValue(okResult({ status: 1 }));
    await expect(listSnapshots({ pageId: 1, lang: "en" })).rejects.toThrow(
      /snapshots/i,
    );
  });

  test("listSnapshots accepts valid payload with snapshots array", async () => {
    request.mockResolvedValue(okResult({ status: 1, snapshots: [] }));
    const result = await listSnapshots({ pageId: 1, lang: "en" });
    expect(Array.isArray(result.snapshots)).toBe(true);
  });

  test("getSnapshotDiff rejects status:1 payload missing diff field", async () => {
    request.mockResolvedValue(okResult({ status: 1 }));
    await expect(
      getSnapshotDiff({ pageId: 1, lang: "en", snapshotId: "abc" }),
    ).rejects.toThrow(/diff/i);
  });

  test("getSnapshotDiff accepts valid payload with diff string", async () => {
    request.mockResolvedValue(okResult({ status: 1, diff: "- old\n+ new" }));
    const result = await getSnapshotDiff({
      pageId: 1,
      lang: "en",
      snapshotId: "abc",
    });
    expect(typeof result.diff).toBe("string");
  });

  test("checkExternalChange rejects status:1 payload missing changed field", async () => {
    request.mockResolvedValue(okResult({ status: 1, currentHash: "abc123" }));
    await expect(
      checkExternalChange({ pageId: 1, lang: "en", knownHash: "abc123" }),
    ).rejects.toThrow(/changed/i);
  });

  test("checkExternalChange accepts valid payload with changed and currentHash", async () => {
    request.mockResolvedValue(
      okResult({ status: 1, changed: false, currentHash: "abc123" }),
    );
    const result = await checkExternalChange({
      pageId: 1,
      lang: "en",
      knownHash: "abc123",
    });
    expect(result).toHaveProperty("changed");
    expect(result).toHaveProperty("currentHash");
  });

  test("restoreSnapshot rejects status:1 payload missing documentMarkdownB64 field", async () => {
    request.mockResolvedValue(okResult({ status: 1 }));
    await expect(
      restoreSnapshot({ pageId: 1, lang: "en", snapshotId: "abc" }),
    ).rejects.toThrow(/documentMarkdownB64/i);
  });

  test("restoreSnapshot accepts valid payload with documentMarkdownB64", async () => {
    request.mockResolvedValue(
      okResult({ status: 1, documentMarkdownB64: "dGVzdA==" }),
    );
    const result = await restoreSnapshot({
      pageId: 1,
      lang: "en",
      snapshotId: "abc",
    });
    expect(typeof result.documentMarkdownB64).toBe("string");
  });

  test("deleteSnapshot passes with status:1 and no required fields", async () => {
    request.mockResolvedValue(okResult({ status: 1 }));
    await expect(
      deleteSnapshot({ pageId: 1, lang: "en", snapshotId: "abc" }),
    ).resolves.toBeDefined();
  });

  test("createSnapshot passes with status:1 and optional suppressed field absent", async () => {
    request.mockResolvedValue(okResult({ status: 1 }));
    await expect(
      createSnapshot({
        pageId: 1,
        lang: "en",
        eventType: "manual",
        snapshotState: "persisted",
      }),
    ).resolves.toBeDefined();
  });
});
