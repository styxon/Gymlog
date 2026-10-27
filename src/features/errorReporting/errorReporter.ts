/**
 * The device side of the error reports: which screen the reader is on, the
 * launch's budget, and the one door every report goes through.
 *
 * Reports are usage events (lib/analytics) and so share everything the usage
 * events have: our own server only, the reader's Settings → Usage statistics
 * switch (off queues nothing), the same queue and retention. What a report may
 * say is lib/errorReport; this file only fills it in and hands it over.
 *
 * Nothing here may throw into the caller or report on itself: a failure while
 * reporting a failure is swallowed, and a report raised from inside a report
 * is dropped, so this can never be the thing that crashes the app.
 */
import {
  admitAppError,
  admitOperationFailure,
  buildAppErrorProps,
  emptyErrorBudget,
  isExpectedOperationOutcome,
  operationFailureCode,
  screenKeyForRoute,
  type AppErrorKind,
  type ErrorBudget,
  type FailedOperation,
} from '../../lib/errorReport';
import { trackEvent } from '../analytics/analyticsClient';
import { currentAppPlatform, currentAppVersion } from '../appUpdate/appUpdateSignal';

let budget: ErrorBudget = emptyErrorBudget();
let screen = 'unknown';
let reporting = false;

/**
 * A development build's errors are the red box's business, and a hot reload is
 * not a failure worth counting: nothing is reported from one. `__DEV__` is
 * undefined outside the app (the test runner), where reporting is on.
 */
export function isDevelopmentBuild(): boolean {
  return (globalThis as { __DEV__?: unknown }).__DEV__ === true;
}

/**
 * What the shell is drawing right now: the setup flow, or the route's own key
 * (lib/errorReport screenKeyForRoute). Set while the app renders, not in an
 * effect after it: an error thrown by the screen being drawn must name that
 * screen, not the one it replaced.
 */
export function noteRenderedScreen(onboardingActive: boolean, route: { tab: string; screen: string }): void {
  screen = onboardingActive ? 'onboarding' : screenKeyForRoute(route);
}

/** Forget the budget: a new launch. Exposed for tests; the app never calls it. */
export function resetErrorReportBudget(): void {
  budget = emptyErrorBudget();
  reporting = false;
}

/**
 * Report a thrown value. `urgent` is for a fatal error: the write is issued
 * before this returns, because the process may end right after (see trackEvent).
 */
export function reportAppError(kind: AppErrorKind, error: unknown, options?: { urgent?: boolean }): void {
  if (reporting || isDevelopmentBuild()) {
    return;
  }
  reporting = true;
  try {
    const props = buildAppErrorProps({
      kind,
      error,
      screen,
      appVersion: currentAppVersion(),
      platform: currentAppPlatform(),
    });
    const admitted = admitAppError(budget, props.signature);
    budget = admitted.budget;
    if (admitted.admitted) {
      trackEvent('app_error', props, options);
    }
  } catch {
    // Swallowed on purpose; see the header.
  } finally {
    reporting = false;
  }
}

/**
 * Report that an operation failed. `source` is whatever the failure was: the
 * server's answer string, or a thrown error; only the closed code it maps to
 * is kept (lib/errorReport operationFailureCode).
 */
export function reportOperationFailed(op: FailedOperation, source?: unknown): void {
  if (reporting || isDevelopmentBuild()) {
    return;
  }
  reporting = true;
  try {
    const code = operationFailureCode(source);
    if (isExpectedOperationOutcome(op, code)) {
      // A known account state (a sign-in that ended), not a fault.
      return;
    }
    const admitted = admitOperationFailure(budget, op, code);
    budget = admitted.budget;
    if (admitted.admitted) {
      trackEvent('operation_failed', { op, code });
    }
  } catch {
    // Swallowed on purpose; see the header.
  } finally {
    reporting = false;
  }
}
