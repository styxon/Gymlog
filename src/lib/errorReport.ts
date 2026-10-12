/**
 * What an error report may say — and, as important, what it may not.
 *
 * Production failures used to be invisible: a reader whose app crashed on the
 * way to saving a workout uninstalled it, and nothing on our side ever knew.
 * Reports travel the same anonymous pipe as the usage events (lib/analytics),
 * under the same switch (Settings → Usage statistics), to our own server and
 * nowhere else. No third-party crash service.
 *
 * The rule that keeps that pipe honest: a report carries WHERE the code failed,
 * never WHAT it was holding. Exactly these fields exist:
 *
 *   app_error         kind, name, signature, frames, screen, appVersion, platform
 *   operation_failed  op, code
 *
 * There is no message field. An error message is free text the code wrote
 * while it held the reader's data — an exercise name in a "cannot find X", an
 * email in a failed sign-in — and a filter that removes "the personal parts"
 * of free text is a promise nobody can keep. So it is not collected, and the
 * validators below refuse a report that has one (an unknown key rejects the
 * whole event, as everywhere in lib/analytics).
 *
 * Pure: the stack text is parsed here, the sending is features/errorReporting.
 */
import type { AppRoute } from '../navigation/routes';

/** How the failure reached us. */
export const APP_ERROR_KINDS = ['js_fatal', 'js_error', 'render', 'unhandled_rejection'] as const;
export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

/** The operations whose failure the reader would feel as "it did not work". */
export const FAILED_OPERATIONS = [
  'workout_save',
  'backup_upload',
  'backup_restore',
  'database_load',
  'workout_load',
  'account_delete',
  'sign_in',
] as const;
export type FailedOperation = (typeof FAILED_OPERATIONS)[number];

/**
 * The short codes the app and its server already speak. Anything else is
 * UNKNOWN: a code that is not in this list never leaves the phone, so a new
 * server answer cannot smuggle text out through it.
 */
export const OPERATION_CODES = [
  'NETWORK',
  'STORE_UNAVAILABLE',
  'SERVER_ERROR',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INVALID_TOKEN',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'STORAGE_FAILED',
  'QUOTA',
  'UNKNOWN',
] as const;
export type OperationCode = (typeof OPERATION_CODES)[number];

export const ERROR_PLATFORMS = ['android', 'ios', 'unknown'] as const;
export type ErrorPlatform = (typeof ERROR_PLATFORMS)[number];

export interface AppErrorProps {
  kind: AppErrorKind;
  /** The error's class name (TypeError, RangeError…), or `NonError` for a thrown string. */
  name: string;
  /** Stable short hash of the name and the top frames: the same bug groups together. */
  signature: string;
  /** At most five `file.js:line:col` entries — bundle name only, no path, no text. */
  frames: string[];
  /** A route key from the closed set below, or `unknown`. */
  screen: string;
  appVersion: string;
  platform: ErrorPlatform;
}

export interface OperationFailedProps {
  op: FailedOperation;
  code: OperationCode;
}

export const MAX_ERROR_NAME_LENGTH = 40;
export const MAX_ERROR_FRAMES = 5;
const MAX_FRAME_LENGTH = 64;
const MAX_VERSION_LENGTH = 24;

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * Every screen key an AppRoute can have. A Record over the union, so adding a
 * route without listing it here is a compile error — the set stays closed and
 * complete without anyone remembering to update a second list.
 */
const ROUTE_SCREENS: Record<AppRoute['screen'], true> = {
  ai_chat: true,
  analysis: true,
  bodyweight: true,
  cardio: true,
  catalog: true,
  collection: true,
  dashboard: true,
  detail: true,
  edit_profile: true,
  empty: true,
  export_plan: true,
  goalFlow: true,
  guided: true,
  history: true,
  learn: true,
  legal: true,
  list: true,
  membership_end: true,
  milestones: true,
  my_data: true,
  notifications: true,
  plans: true,
  premium: true,
  premium_unlock: true,
  program: true,
  programDay: true,
  programs_home: true,
  session: true,
  settings: true,
  setup: true,
  subscription: true,
  summary: true,
  template: true,
  training_break: true,
  training_plan: true,
};

const ROUTE_TABS: Record<AppRoute['tab'], true> = { home: true, workout: true, progress: true, profile: true };

/** Not routes: the setup flow before the app proper, and "no idea". */
const SPECIAL_SCREENS = ['onboarding', 'unknown'] as const;

/** `tab/screen`, or `unknown` when the route is not one the app knows. */
export function screenKeyForRoute(route: { tab: string; screen: string } | null | undefined): string {
  if (!route) {
    return 'unknown';
  }
  const key = `${route.tab}/${route.screen}`;
  return isValidScreenKey(key) ? key : 'unknown';
}

export function isValidScreenKey(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if ((SPECIAL_SCREENS as readonly string[]).includes(value)) {
    return true;
  }
  const parts = value.split('/');
  return (
    parts.length === 2 &&
    Object.prototype.hasOwnProperty.call(ROUTE_TABS, parts[0]) &&
    Object.prototype.hasOwnProperty.call(ROUTE_SCREENS, parts[1])
  );
}

// ---------------------------------------------------------------------------
// Names, stacks, signatures
// ---------------------------------------------------------------------------

const ERROR_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The engine's own error classes, by name, for an error from another realm. */
const BUILT_IN_ERROR_NAMES = [
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
];

/**
 * The error's class name. Only an actual Error gives one: `name` on any other
 * object is whatever the code that built it wrote — `{ name: 'Santeri' }` —
 * so a plain object, a string, a number or nothing at all is `NonError`, its
 * content exactly the free text this module refuses. (An object from another
 * realm that carries one of the engine's own class names is that class.)
 * Of an Error, only an identifier-shaped, short name is kept; anything else
 * is plain `Error`.
 */
export function errorNameOf(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name;
    return typeof name === 'string' && name.length <= MAX_ERROR_NAME_LENGTH && ERROR_NAME_PATTERN.test(name)
      ? name
      : 'Error';
  }
  if (error !== null && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && BUILT_IN_ERROR_NAMES.includes(name)) {
      return name;
    }
  }
  return 'NonError';
}

/** A bundle or a source file by name — a domain or an address in front of `:1:2` is not one. */
const FRAME_FILE_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:bundle|jsbundle|js|hbc|bytecode|map|ts|tsx|mjs|cjs)$/;
const FRAME_PATTERN = /^[A-Za-z0-9_.-]{1,40}:\d{1,9}:\d{1,9}$/;

/** `path/or/url/index.android.bundle?x=y` → `index.android.bundle`, or null. */
function frameFile(raw: string): string | null {
  let file = raw.trim().replace(/^address at\s+/, '');
  // A dev-server URL carries its query after `?` or `&`; a fragment after `#`.
  file = file.split(/[?&#]/)[0].replace(/[\\/]+$/, '');
  const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  return FRAME_FILE_PATTERN.test(base) && base.length <= 40 ? base : null;
}

/** One stack line to `file:line:col`, or null when it is not a code location. */
function parseFrameLine(line: string): string | null {
  // Hermes / V8:   "    at fn (address at index.android.bundle:1:2345)"
  //                "    at fn (http://host:8081/index.bundle?platform=android:12:34)"
  //                "    at http://host:8081/index.bundle?platform=android:12:34"
  // JavaScriptCore: "fn@/var/.../main.jsbundle:123:45"  "@main.jsbundle:1:2"
  let location: RegExpExecArray | null = null;
  if (/^\s*at\s/.test(line)) {
    location = /^\s*at\s+(?:.*?\s\()?(.+):(\d+):(\d+)\)?\s*$/.exec(line);
  } else if (line.includes('@')) {
    // The name in front of the @ is a function name — one token, or one of
    // JSC's own "global code" kind — never a sentence. A message line such as
    // "Error: user john@secret.js:3:4" has a colon and spaces there and is
    // not a frame; only lines of the stack proper are.
    location = /^(?:(?:global|eval|module|program) code|[A-Za-z0-9_$.<>?/-]*)@(.+):(\d+):(\d+)\s*$/.exec(line);
  }
  if (!location) {
    return null;
  }
  const file = frameFile(location[1]);
  if (!file) {
    return null;
  }
  const frame = `${file}:${location[2]}:${location[3]}`;
  return FRAME_PATTERN.test(frame) && frame.length <= MAX_FRAME_LENGTH ? frame : null;
}

/**
 * The code locations of a stack — bundle file, line, column — and nothing else.
 *
 * Function names are left out too (a minified one says nothing, and an
 * unminified one is more text to vouch for), as is everything that is not a
 * location: the message lines at the top of a Hermes stack, `native` frames,
 * `[native code]`. A line must look like a stack frame in one of the engines'
 * formats AND name a file that looks like a bundle; free text that merely
 * ends in `:1:2` fails the second test.
 */
export function parseStackFrames(stack: unknown, limit: number = MAX_ERROR_FRAMES): string[] {
  if (typeof stack !== 'string' || stack.length === 0) {
    return [];
  }
  const frames: string[] = [];
  for (const line of stack.slice(0, 20000).split(/\r?\n/)) {
    const frame = parseFrameLine(line);
    if (frame) {
      frames.push(frame);
      if (frames.length >= Math.min(limit, MAX_ERROR_FRAMES)) {
        break;
      }
    }
  }
  return frames;
}

/**
 * A short stable hash (cyrb53, 53 bits as 14 hex digits). Not a security
 * hash: it only has to put one bug under one name and a different bug under
 * another, with no crypto module on the phone.
 */
function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

/** How many of the top frames name the bug; deeper ones vary with who called. */
const SIGNATURE_FRAMES = 3;

/** The same bug in the same build hashes the same; a different one does not. */
export function errorSignature(name: string, frames: readonly string[]): string {
  return shortHash([name, ...frames.slice(0, SIGNATURE_FRAMES)].join('|'));
}

function isValidSignature(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8,16}$/.test(value);
}

// ---------------------------------------------------------------------------
// Building and validating
// ---------------------------------------------------------------------------

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

function isValidAppVersionLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VERSION_LENGTH && VERSION_PATTERN.test(value);
}

/**
 * The report for one thrown value. Reads `name` and `stack` and nothing else
 * from it — `message` is never touched, so it cannot leak by a later edit
 * that forgets to filter it.
 */
export function buildAppErrorProps(input: {
  kind: AppErrorKind;
  error: unknown;
  screen: string;
  appVersion: string | null | undefined;
  platform: string | null | undefined;
}): AppErrorProps {
  const name = errorNameOf(input.error);
  // Only an error's own stack: a plain object's `stack` is whatever it was given.
  const stack = name !== 'NonError' ? (input.error as { stack?: unknown }).stack : undefined;
  const frames = parseStackFrames(stack);
  return {
    kind: input.kind,
    name,
    signature: errorSignature(name, frames),
    frames,
    screen: isValidScreenKey(input.screen) ? input.screen : 'unknown',
    appVersion: isValidAppVersionLabel(input.appVersion) ? input.appVersion : 'unknown',
    platform: (ERROR_PLATFORMS as readonly string[]).includes(input.platform ?? '')
      ? (input.platform as ErrorPlatform)
      : 'unknown',
  };
}

const APP_ERROR_KEYS = ['kind', 'name', 'signature', 'frames', 'screen', 'appVersion', 'platform'];

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Every field present, every field in its closed shape, and no field besides. */
export function isValidAppErrorProps(value: unknown): value is AppErrorProps {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const props = value as Record<string, unknown>;
  if (!hasExactlyKeys(props, APP_ERROR_KEYS)) {
    return false;
  }
  return (
    (APP_ERROR_KINDS as readonly string[]).includes(props.kind as string) &&
    typeof props.name === 'string' &&
    props.name.length <= MAX_ERROR_NAME_LENGTH &&
    ERROR_NAME_PATTERN.test(props.name) &&
    isValidSignature(props.signature) &&
    Array.isArray(props.frames) &&
    props.frames.length <= MAX_ERROR_FRAMES &&
    props.frames.every(
      (frame) => typeof frame === 'string' && frame.length <= MAX_FRAME_LENGTH && FRAME_PATTERN.test(frame),
    ) &&
    isValidScreenKey(props.screen) &&
    isValidAppVersionLabel(props.appVersion) &&
    (ERROR_PLATFORMS as readonly string[]).includes(props.platform as string)
  );
}

export function isValidOperationFailedProps(value: unknown): value is OperationFailedProps {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const props = value as Record<string, unknown>;
  return (
    hasExactlyKeys(props, ['op', 'code']) &&
    (FAILED_OPERATIONS as readonly string[]).includes(props.op as string) &&
    (OPERATION_CODES as readonly string[]).includes(props.code as string)
  );
}

/**
 * Outcomes that are a known state of the account, not a fault: a sign-in that
 * ended because the session was revoked or ran out. The reader signs in
 * again; counting it would bury the failures that are bugs.
 */
export function isExpectedOperationOutcome(op: FailedOperation, code: OperationCode): boolean {
  return op === 'sign_in' && (code === 'SESSION_REVOKED' || code === 'SESSION_EXPIRED');
}

/**
 * The closed code for whatever an operation failed with: the server's own
 * answer string (`NETWORK`, `HTTP_503`, `STORE_UNAVAILABLE`…) or a thrown
 * error from the phone's storage. Only the code chosen leaves; the text it was
 * chosen from stays here.
 */
export function operationFailureCode(source: unknown): OperationCode {
  let text = '';
  if (typeof source === 'string') {
    text = source;
  } else if (source && typeof source === 'object') {
    const candidate = source as { code?: unknown; message?: unknown; name?: unknown };
    text = [candidate.code, candidate.name, candidate.message]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
  }
  if ((OPERATION_CODES as readonly string[]).includes(text)) {
    return text as OperationCode;
  }
  const upper = text.slice(0, 400).toUpperCase();
  if (/\bHTTP_5\d\d\b/.test(upper)) {
    return 'SERVER_ERROR';
  }
  if (/\bHTTP_413\b/.test(upper)) {
    return 'PAYLOAD_TOO_LARGE';
  }
  if (/\bHTTP_429\b/.test(upper)) {
    return 'RATE_LIMITED';
  }
  if (/\bHTTP_40[13]\b/.test(upper)) {
    return 'INVALID_TOKEN';
  }
  if (/DISK IS FULL|SQLITE_FULL|ENOSPC|QUOTA|NO SPACE|ROW TOO BIG|CURSORWINDOW/.test(upper)) {
    return 'QUOTA';
  }
  if (/NETWORK|TIMEOUT|ABORT|OFFLINE|FETCH FAILED/.test(upper)) {
    return 'NETWORK';
  }
  if (/ASYNCSTORAGE|SQLITE|\bIO ?ERROR|\bEIO\b|DATABASE IS LOCKED|DATABASE_LOCKED|STORAGE/.test(upper)) {
    return 'STORAGE_FAILED';
  }
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Per launch: a crash loop or an offline phone must not write the queue full. */
export const MAX_APP_ERRORS_PER_LAUNCH = 10;
export const MAX_OPERATION_FAILURES_PER_LAUNCH = 20;

export interface ErrorBudget {
  appErrors: number;
  operations: number;
  signatures: readonly string[];
  operationKeys: readonly string[];
}

export function emptyErrorBudget(): ErrorBudget {
  return { appErrors: 0, operations: 0, signatures: [], operationKeys: [] };
}

/**
 * Whether one more app error may be sent this launch. The same signature is
 * sent once however often it recurs (a render loop would otherwise be the
 * whole budget), and ten distinct ones are the most a launch can report.
 */
export function admitAppError(
  budget: ErrorBudget,
  signature: string,
): { budget: ErrorBudget; admitted: boolean } {
  if (budget.signatures.includes(signature) || budget.appErrors >= MAX_APP_ERRORS_PER_LAUNCH) {
    return { budget, admitted: false };
  }
  return {
    budget: { ...budget, appErrors: budget.appErrors + 1, signatures: [...budget.signatures, signature] },
    admitted: true,
  };
}

/**
 * The same for a failed operation. One per op and code per launch — an
 * offline phone failing its backup every eight seconds is one finding, not
 * the whole budget — and twenty in all.
 */
export function admitOperationFailure(
  budget: ErrorBudget,
  op: FailedOperation,
  code: OperationCode,
): { budget: ErrorBudget; admitted: boolean } {
  const key = `${op}:${code}`;
  if (budget.operationKeys.includes(key) || budget.operations >= MAX_OPERATION_FAILURES_PER_LAUNCH) {
    return { budget, admitted: false };
  }
  return {
    budget: { ...budget, operations: budget.operations + 1, operationKeys: [...budget.operationKeys, key] },
    admitted: true,
  };
}
