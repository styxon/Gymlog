/**
 * The device side of the usage events: a queue in AsyncStorage and a
 * fire-and-forget flush. Configured by EXPO_PUBLIC_ANALYTICS_URL; without it
 * every call is a no-op, which is the fourth variable in the family that
 * turns its feature off silently (see the env notes) — and for analytics,
 * silently off is the correct failure mode.
 *
 * Offline-first like everything else: track() writes to the queue and never
 * blocks or throws into the caller; a flush drains the queue when the network
 * cooperates and puts the batch back when it does not. Losing events to a
 * dead zone is acceptable; losing a workout save to analytics would not be,
 * which is why nothing here is awaited on any user path.
 *
 * The reader's switch (Settings → Usage statistics, 2026-09-04) reaches this
 * module through setUsageStatisticsEnabled. Nothing is sent until the switch
 * has been read from the stored preferences, so a reader who turned it off
 * never has a batch slip out during startup; turning it off also forgets the
 * queue and the install id, so re-enabling starts as a new install.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  AnalyticsEvent,
  AnalyticsEventName,
  AnalyticsEventProps,
  appendToQueue,
  isFinalRefusal,
  isValidEvent,
  takeBatch,
} from '../../lib/analytics';
import {
  ANALYTICS_FLUSH_PACING,
  EMPTY_PACING,
  notePacingOutcome,
  notePacingSent,
  pacingWaitMs,
  type PacingState,
} from '../../lib/requestPacing';
import { appVersionHeaders, noteServerAnswer } from '../appUpdate/appUpdateSignal';

const ANALYTICS_URL = (process.env.EXPO_PUBLIC_ANALYTICS_URL ?? '').trim();
const STORAGE_KEY = '@vinha/analytics/v1';
/**
 * Urgent events raised before the queue was in memory (hunt 3, 2026-10-03).
 *
 * A fatal error while the app's modules are still loading cannot go through
 * the queue: loading it is an await, and the process dies first. This key is
 * written without reading anything, so the write is issued in the same tick;
 * the next launch's loadState folds it into the queue and removes it.
 */
const CRASH_KEY = '@vinha/analytics/crash';
/** Small waits batch a burst of steps into one request. */
const FLUSH_DELAY_MS = 5000;

interface StoredState {
  installId: string;
  queue: AnalyticsEvent[];
}

let memory: StoredState | null = null;
/**
 * This launch's urgent events that found no queue in memory. The whole list is
 * rewritten under CRASH_KEY each time, because appending would need a read. A
 * crash loop that dies before the queue loads therefore keeps the newest
 * launch's events, not every launch's; once a launch gets as far as loadState
 * the key is drained and the loop's next crash is queued normally.
 */
let earlyEvents: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
/**
 * When batches left and how the last ones fared (lib/requestPacing). Whatever
 * raises events - however often - at most ANALYTICS_FLUSH_PACING's budget of
 * requests leaves the phone, and a server that is failing is not asked again
 * every five seconds for as long as the reader keeps tapping.
 */
let pacing: PacingState = EMPTY_PACING;
/**
 * null until App.tsx has read the preference: events raised before that are
 * queued, and dropped if the answer turns out to be no. Only an explicit
 * `true` lets a batch leave.
 */
let enabled: boolean | null = null;

/**
 * Read through a function on purpose: the compiler narrows a module-level
 * `let` after an `if` and keeps the narrowing across an await, so a second
 * direct comparison after the await is reported as impossible — and the
 * whole point of the second check is that the switch may have moved.
 */
function switchedOff(): boolean {
  return enabled === false;
}

function randomUuid(): string {
  // Math.random is enough: this id needs to be unique-ish, not secret.
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${((Math.random() * 4) | 8).toString(16)}${hex(3)}-${hex(12)}`;
}

/**
 * The stored state, or null once the switch is off. The switch is re-read
 * after every await in this module: a call that started while the answer was
 * unknown must not be the thing that writes the key back after the off path
 * removed it.
 */
async function loadState(): Promise<StoredState | null> {
  if (switchedOff()) {
    return null;
  }
  if (memory) {
    return memory;
  }
  let loaded: StoredState | null = null;
  let early: AnalyticsEvent[] = [];
  try {
    const rawCrash = await AsyncStorage.getItem(CRASH_KEY);
    const parsedCrash = rawCrash ? (JSON.parse(rawCrash) as unknown) : [];
    early = Array.isArray(parsedCrash) ? parsedCrash.filter(isValidEvent) : [];
  } catch {
    // Unreadable crash events are not worth anything more than the queue is.
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredState>;
      if (typeof parsed.installId === 'string' && Array.isArray(parsed.queue)) {
        loaded = { installId: parsed.installId, queue: parsed.queue.filter(isValidEvent) };
      }
    }
  } catch {
    // A corrupt queue is not worth crashing over; start over.
  }
  // The switch may have flipped during the read, and a second caller may
  // have finished its own read first — either way this one yields.
  if (switchedOff()) {
    return null;
  }
  if (memory) {
    return memory;
  }
  const state: StoredState = loaded ?? { installId: randomUuid(), queue: [] };
  memory = state;
  // The key holds this launch's early events too unless one was raised after
  // the read above; the in-process list covers that gap. From here on an
  // urgent event finds `memory` and takes the ordinary path.
  const seen = new Set(early.map((event) => JSON.stringify(event)));
  for (const event of earlyEvents) {
    if (!seen.has(JSON.stringify(event))) {
      early.push(event);
    }
  }
  earlyEvents = [];
  for (const event of early) {
    state.queue = appendToQueue(state.queue, event);
  }
  if (!loaded || early.length > 0) {
    // The crash key goes only once the queue that now holds its events has
    // been written: a failed write keeps it for the next launch.
    if ((await persist()) && !switchedOff()) {
      try {
        await AsyncStorage.removeItem(CRASH_KEY);
      } catch {
        // A leftover is folded in again next launch, as a duplicate at worst.
      }
    }
  }
  return state;
}

async function persist(): Promise<boolean> {
  if (!memory || switchedOff()) {
    return false;
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    return true;
  } catch {
    // Full disk loses analytics, not the app.
    return false;
  }
}

async function flush(): Promise<void> {
  if (flushing || !ANALYTICS_URL || enabled !== true) {
    return;
  }
  const state = await loadState();
  if (!state || state.queue.length === 0) {
    return;
  }
  flushing = true;
  const batch = takeBatch(state.queue);
  pacing = notePacingSent(pacing, ANALYTICS_FLUSH_PACING, Date.now());
  let settled = false;
  try {
    const response = await fetch(ANALYTICS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...appVersionHeaders() },
      body: JSON.stringify({ installId: state.installId, sentAt: new Date().toISOString(), events: batch }),
    });
    const body = response.ok ? null : ((await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null);
    if (!response.ok) {
      noteServerAnswer(response.status, body);
    }
    // Sent, or refused for good: either way this batch leaves the queue. A
    // final refusal (a 400: the server will say the same tomorrow) kept at the
    // head was retried forever, and no event behind it ever left the phone.
    // What stays queued is what a later try can fix: no network, a 5xx, a rate
    // limit, "update the app" (lib/analytics isFinalRefusal) — and an answer
    // that is not our server's own JSON (a captive portal's 403 says nothing
    // about this batch).
    const ownRefusal = body !== null && body.ok === false && typeof body.error === 'string';
    if (response.ok || (ownRefusal && isFinalRefusal(response.status))) {
      settled = true;
      pacing = notePacingOutcome(pacing, true, Date.now());
      state.queue = state.queue.slice(batch.length);
      await persist();
      if (state.queue.length > 0) {
        scheduleFlush();
      }
    }
  } catch {
    // Offline. The queue holds; the next foreground tries again.
  } finally {
    // A batch the server took or refused for good is an answer; anything
    // else - no network, a 5xx, a rate limit - is a failure the next try waits out.
    if (!settled) {
      pacing = notePacingOutcome(pacing, false, Date.now());
    }
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, Math.max(FLUSH_DELAY_MS, pacingWaitMs(pacing, ANALYTICS_FLUSH_PACING, Date.now())));
}

/**
 * Record one event. Never awaited by callers, never throws into them, and a
 * build without the URL queues nothing at all — no ghost queue growing on
 * installs that will never send it. A reader who switched statistics off
 * queues nothing either.
 */
export function trackEvent(
  name: AnalyticsEventName,
  props?: AnalyticsEventProps,
  options?: { urgent?: boolean },
): void {
  if (!ANALYTICS_URL || enabled === false) {
    return;
  }
  // The process may be about to die (a fatal JS error): no await before the
  // write is issued, or the microtask that would issue it may never run.
  // With the queue in memory — any crash after the first moments of a launch
  // (app_open loads it) — the queue is written. Before that there is no queue
  // to write, and loading it is an await the process may not survive, so the
  // event goes under its own key with no read first (CRASH_KEY), and the next
  // launch folds it in. In both cases the write is only *issued* here: whether
  // the phone finishes it before the process ends is not something JavaScript
  // can promise.
  if (options?.urgent) {
    try {
      const event: AnalyticsEvent = { name, at: new Date().toISOString(), ...(props ? { props } : {}) };
      if (isValidEvent(event)) {
        if (memory) {
          memory.queue = appendToQueue(memory.queue, event);
          void persist();
        } else {
          earlyEvents = appendToQueue(earlyEvents, event);
          void AsyncStorage.setItem(CRASH_KEY, JSON.stringify(earlyEvents)).catch(() => undefined);
        }
      }
    } catch {
      // Reporting a crash must not become the next one.
    }
    return;
  }
  void (async () => {
    try {
      const state = await loadState();
      // Null means the switch went off while the state was loading.
      if (!state) {
        return;
      }
      const event: AnalyticsEvent = { name, at: new Date().toISOString(), ...(props ? { props } : {}) };
      if (!isValidEvent(event)) {
        return;
      }
      state.queue = appendToQueue(state.queue, event);
      await persist();
      scheduleFlush();
    } catch {
      // Analytics must never cost the user anything.
    }
  })();
}

/**
 * Apply the reader's switch. Off clears the queue and forgets the install id,
 * so nothing waits to be sent later and nothing ties a future yes to the
 * past; on lets whatever queued while the answer was unknown go out.
 */
export function setUsageStatisticsEnabled(next: boolean): void {
  enabled = next;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!next) {
    memory = null;
    earlyEvents = [];
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    void AsyncStorage.removeItem(CRASH_KEY).catch(() => undefined);
    return;
  }
  if (!ANALYTICS_URL) {
    return;
  }
  void loadState()
    .then((state) => {
      if (state && state.queue.length > 0) {
        scheduleFlush();
      }
    })
    .catch(() => undefined);
}

/** Whether this build reports usage at all — the settings screen states it. */
export function isAnalyticsConfigured(): boolean {
  return ANALYTICS_URL.length > 0;
}
