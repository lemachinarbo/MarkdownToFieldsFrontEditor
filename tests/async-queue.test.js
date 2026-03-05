import { createLock, runSerial, withLock } from "../src/async-queue.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("async queue", () => {
  async function flushMicrotasks(count = 6) {
    for (let i = 0; i < count; i += 1) {
      await Promise.resolve();
    }
  }

  test("withLock executes tasks serially for the same lock", async () => {
    const events = [];
    const first = createDeferred();
    const second = createDeferred();

    const runFirst = withLock("doc", async () => {
      events.push("first:start");
      await first.promise;
      events.push("first:end");
      return "A";
    });

    const runSecond = withLock("doc", async () => {
      events.push("second:start");
      await second.promise;
      events.push("second:end");
      return "B";
    });

    await flushMicrotasks();
    expect(events).toEqual(["first:start"]);

    first.resolve();
    await flushMicrotasks();
    expect(events).toEqual(["first:start", "first:end", "second:start"]);

    second.resolve();
    await expect(runFirst).resolves.toBe("A");
    await expect(runSecond).resolves.toBe("B");
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("rejections do not block subsequent tasks on the same lock", async () => {
    const events = [];
    await expect(
      withLock("save", async () => {
        events.push("first");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(
      withLock("save", async () => {
        events.push("second");
        return 2;
      }),
    ).resolves.toBe(2);

    expect(events).toEqual(["first", "second"]);
  });

  test("different lock names run independently", async () => {
    const events = [];
    const a = createDeferred();
    const b = createDeferred();

    const runA = withLock("A", async () => {
      events.push("A:start");
      await a.promise;
      events.push("A:end");
    });
    const runB = withLock("B", async () => {
      events.push("B:start");
      await b.promise;
      events.push("B:end");
    });

    await flushMicrotasks();
    expect(events).toEqual(["A:start", "B:start"]);

    b.resolve();
    await flushMicrotasks();
    expect(events).toEqual(["A:start", "B:start", "B:end"]);

    a.resolve();
    await runA;
    await runB;
    expect(events).toEqual(["A:start", "B:start", "B:end", "A:end"]);
  });

  test("createLock and runSerial delegate to named queue", async () => {
    const lock = createLock("x");
    const values = [];

    await lock(async () => values.push(1));
    await runSerial("x", async () => values.push(2));

    expect(values).toEqual([1, 2]);
  });
});
