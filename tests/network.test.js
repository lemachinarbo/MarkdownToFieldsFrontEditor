import { NetworkError, ParseError, request } from "../src/network.js";

describe("network request", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("transport failures reject with NetworkError", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("offline")));

    await expect(
      request("/x", {
        method: "GET",
        headers: undefined,
        body: undefined,
        parse: "json",
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  test("HTTP non-2xx resolves with ok:false", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: "server" }),
      }),
    );

    await expect(
      request("/x", {
        method: "GET",
        headers: undefined,
        body: undefined,
        parse: "json",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 500,
      data: { message: "server" },
    });
  });

  test("invalid JSON rejects with ParseError", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("bad json")),
      }),
    );

    await expect(
      request("/x", {
        method: "GET",
        headers: undefined,
        body: undefined,
        parse: "json",
      }),
    ).rejects.toBeInstanceOf(ParseError);
  });

  test("timeout rejects with NetworkError", async () => {
    global.fetch = jest.fn((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });

    await expect(
      request("/x", {
        method: "GET",
        headers: undefined,
        body: undefined,
        parse: "json",
        timeout: 5,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
