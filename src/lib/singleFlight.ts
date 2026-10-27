/**
 * Lets one run of an async action be in progress at a time. A second trigger
 * while it runs is ignored (resolves undefined) instead of starting another;
 * the flag is released when the run settles, however it settles.
 *
 * Used for the store restore: two taps would ask the store twice and write the
 * purchase record twice.
 */
interface SingleFlight {
  readonly busy: boolean;
  run<T>(action: () => Promise<T>): Promise<T | undefined>;
}

export function createSingleFlight(): SingleFlight {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run<T>(action: () => Promise<T>): Promise<T | undefined> {
      if (busy) {
        return undefined;
      }
      busy = true;
      try {
        return await action();
      } finally {
        busy = false;
      }
    },
  };
}
