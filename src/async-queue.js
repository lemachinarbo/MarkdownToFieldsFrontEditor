const lockChains = new Map();

export function withLock(name, task) {
  if (!name) {
    throw new Error("[mfe] withLock requires a lock name.");
  }
  if (typeof task !== "function") {
    throw new Error("[mfe] withLock requires a task function.");
  }

  const lockName = String(name);
  const previous = lockChains.get(lockName) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => task());

  lockChains.set(lockName, current);
  current
    .finally(() => {
      if (lockChains.get(lockName) === current) {
        lockChains.delete(lockName);
      }
    })
    .catch(() => undefined);

  return current;
}

export function createLock(name) {
  return (task) => withLock(name, task);
}

export function runSerial(name, task) {
  return withLock(name, task);
}

// Deterministic async boundary for post-action work that only needs microtask ordering.
export function defer(task) {
  return Promise.resolve().then(() => {
    if (typeof task !== "function") return undefined;
    return task();
  });
}

// Deterministic UI scheduling boundary for focus/layout work after paint.
export function afterNextPaint(task) {
  return new Promise((resolve, reject) => {
    const runTask = () => {
      defer(() => {
        if (typeof task !== "function") return undefined;
        return task();
      })
        .then(resolve)
        .catch(reject);
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => runTask());
      return;
    }

    runTask();
  });
}
