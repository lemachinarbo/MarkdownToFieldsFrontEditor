export function createEventRegistry() {
  const registrations = new Set();

  function register(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== "function") {
      return () => {};
    }

    target.addEventListener(type, listener, options);
    const entry = { target, type, listener, options };
    registrations.add(entry);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      target.removeEventListener(type, listener, options);
      registrations.delete(entry);
    };
  }

  function disposeAll() {
    const current = Array.from(registrations);
    current.forEach((entry) => {
      entry.target.removeEventListener(
        entry.type,
        entry.listener,
        entry.options,
      );
      registrations.delete(entry);
    });
  }

  function createScope(_name = "") {
    const disposers = new Set();

    function registerScoped(target, type, listener, options) {
      const dispose = register(target, type, listener, options);
      disposers.add(dispose);
      return () => {
        if (!disposers.has(dispose)) return;
        disposers.delete(dispose);
        dispose();
      };
    }

    function disposeScope() {
      const current = Array.from(disposers);
      current.forEach((dispose) => dispose());
      disposers.clear();
    }

    return {
      register: registerScoped,
      disposeAll: disposeScope,
    };
  }

  return {
    register,
    disposeAll,
    createScope,
  };
}
