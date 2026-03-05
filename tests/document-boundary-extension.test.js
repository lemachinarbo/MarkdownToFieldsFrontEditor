import { mapEditableBoundariesWithTransaction } from "../src/document-boundary-extension.js";

describe("document boundary projection mapping", () => {
  test("maps editable boundaries through transaction mapping for insertions", () => {
    const tr = {
      mapping: {
        map(position, assoc) {
          if (assoc !== 1) return position;
          return position >= 23 ? position + 1 : position;
        },
      },
    };

    const mapped = mapEditableBoundariesWithTransaction([0, 1, 23], tr, 185);
    expect(mapped).toEqual([0, 1, 24]);
  });
});
