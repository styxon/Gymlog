/**
 * Hooks the JavaScript runtime's two last-resort error paths into the reporter.
 *
 * Imported first by index.ts, so the handlers are in place before the rest of
 * the app's modules are evaluated.
 *
 * What a fatal error can and cannot promise. React Native's default handler
 * ends the process shortly after our handler returns. Ours runs first and
 * puts the report on the analytics queue with the write already issued (see
 * trackEvent's `urgent`), and the report is sent on the NEXT launch, when the
 * queue is read back. What is guaranteed: the write is handed to the phone
 * before this handler returns. What is not: that the phone finishes it before
 * the process dies (it usually does — the window is milliseconds against a
 * small write — but JavaScript cannot wait to find out), nor that it happens
 * at all for a crash in the first moments of a launch, before the queue has
 * been read into memory. A fatal error is never sent over the network at the
 * moment it happens.
 *
 * Every global is probed with typeof before use: the test runner and the web
 * build have no ErrorUtils and no Hermes, and must not crash on that.
 */
import { isDevelopmentBuild, reportAppError } from './errorReporter';

interface ErrorUtilsLike {
  getGlobalHandler?: () => unknown;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

interface HermesInternalLike {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, error: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
}

interface RuntimeScope {
  ErrorUtils?: ErrorUtilsLike;
  HermesInternal?: HermesInternalLike;
}

interface InstallOptions {
  /** Where the globals live; the test passes a fake. */
  scope?: RuntimeScope;
  report?: typeof reportAppError;
  /** A development build installs nothing: the red box and Metro's own tracker stay in charge. */
  development?: boolean;
}

let installed = false;

export function installErrorReporting(options: InstallOptions = {}): void {
  const scope = options.scope ?? (globalThis as unknown as RuntimeScope);
  const report = options.report ?? reportAppError;
  if (installed || (options.development ?? isDevelopmentBuild())) {
    return;
  }
  installed = true;

  try {
    const errorUtils = scope.ErrorUtils;
    if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
      const previous = typeof errorUtils.getGlobalHandler === 'function' ? errorUtils.getGlobalHandler() : null;
      errorUtils.setGlobalHandler((error, isFatal) => {
        try {
          report(isFatal ? 'js_fatal' : 'js_error', error, isFatal ? { urgent: true } : undefined);
        } catch {
          // Never let the report stop the original handler.
        }
        if (typeof previous === 'function') {
          (previous as (error: unknown, isFatal?: boolean) => void)(error, isFatal);
        }
      });
    }
  } catch {
    // A runtime that refuses the handler keeps the one it has.
  }

  try {
    const hermes = scope.HermesInternal;
    if (hermes && typeof hermes.enablePromiseRejectionTracker === 'function') {
      hermes.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_id, error) => report('unhandled_rejection', error),
        onHandled: () => undefined,
      });
    }
  } catch {
    // Not every Hermes build exposes the tracker; then there is nothing to hook.
  }
}

/** Lets a test install more than once; the app installs once, at startup. */
export function resetInstallForTests(): void {
  installed = false;
}

// The side effect index.ts imports this file for.
installErrorReporting();
