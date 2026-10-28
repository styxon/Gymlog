const path = require('node:path');

/**
 * Just enough React to run one custom hook under Node.
 *
 * No renderer is installed, and the account hook's bugs were all about order
 * — what an upload does after sign-out, what a timer does after a failure —
 * which a source-level guard can only describe. This runs the compiled hook:
 * state, refs, memoised callbacks and effects with their cleanups, re-rendered
 * by the test the way a parent would re-render it. Callbacks close over the
 * render that made them, exactly as they do on the phone.
 */
function createHookRuntime() {
  let slots = [];
  let cursor = 0;
  let queued = [];
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { current: initial };
      }
      return slots[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      const slot = slots[index];
      if (slot && same(slot.deps, deps)) {
        return slot.value;
      }
      const value = factory();
      slots[index] = { value, deps };
      return value;
    },
    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const slot = slots[index];
      if (slot && deps && same(slot.deps, deps)) {
        return;
      }
      queued.push({ index, effect, deps, cleanup: slot ? slot.cleanup : undefined });
    },
  };

  return {
    react,
    render(hook, props) {
      cursor = 0;
      queued = [];
      const result = hook(props);
      for (const item of queued) {
        if (typeof item.cleanup === 'function') {
          item.cleanup();
        }
        slots[item.index] = { deps: item.deps, cleanup: item.effect() };
      }
      return result;
    },
    unmount() {
      for (const slot of slots) {
        if (slot && typeof slot.cleanup === 'function') {
          slot.cleanup();
        }
      }
      slots = [];
    },
  };
}

/** Timers the test moves by hand. */
function createClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    setTimeout(callback, ms) {
      sequence += 1;
      timers.set(sequence, { at: now + (ms ?? 0), callback });
      return sequence;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

/**
 * Requires a compiled module with some of its dependencies replaced.
 * `stubs` maps a specifier (as the module writes it) to its fake exports.
 * The cache is put back afterwards; the returned exports keep the fakes.
 */
function requireWithStubs(modulePath, stubs) {
  const from = { paths: [path.dirname(modulePath)] };
  const saved = new Map();
  const put = (file, entry) => {
    if (!saved.has(file)) {
      saved.set(file, require.cache[file]);
    }
    if (entry) {
      require.cache[file] = entry;
    } else {
      delete require.cache[file];
    }
  };
  for (const [specifier, exports] of Object.entries(stubs)) {
    const file = specifier.startsWith('.') ? require.resolve(path.join(path.dirname(modulePath), specifier)) : require.resolve(specifier, from);
    put(file, { id: file, filename: file, loaded: true, exports });
  }
  put(require.resolve(modulePath), null);
  try {
    return require(modulePath);
  } finally {
    for (const [file, entry] of saved) {
      if (entry) {
        require.cache[file] = entry;
      } else {
        delete require.cache[file];
      }
    }
  }
}

/** A promise the test resolves when it wants the awaiting code to go on. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets every queued promise callback run. */
const flush = () => new Promise((done) => setImmediate(done));

module.exports = { createClock, createHookRuntime, deferred, flush, requireWithStubs };
