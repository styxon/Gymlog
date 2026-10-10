/**
 * The shape of a cloud backup — built here, parsed here, and nowhere else.
 *
 * The payload is the two AsyncStorage stores that matter: the app database
 * (minus the exercise library, which is regenerated on every load exactly as
 * the local save path strips it) and the workout history. The active session
 * is deliberately not backed up: a mid-workout snapshot restored onto another
 * phone is a workout the reader is not doing.
 *
 * Restore goes through the same normalizers as a local load, so a backup from
 * an older app version is handled the way an older local database is — with
 * defaults, not a crash.
 */
import { laterLegalAcceptance } from './legalAcceptance';
import { Gzip, gunzipSync, gzipSync, strFromU8 } from 'fflate';

import type { AppDatabase, AppPreferences } from '../types/models';
import type { WorkoutHistoryStore } from '../features/workout/workoutTypes';
import { ONBOARDING_PLAN_PREFIX, reconcileRunningSet } from './activeProgramSet';
import { reconcileCompletionDismissals } from './programCompletion';
import { isWorkoutInProgress } from './activeWorkout';
import { base64ToBytes, bytesToBase64 } from './base64';
import { DEVICE_ONLY_PREFERENCE_FIELDS, keepDeviceEntitlement } from './proEntitlement';
import { countAuthoredPrograms } from './programSlots';
import { utf8Encode } from './utf8';

export const ACCOUNT_BACKUP_VERSION = 1;

/**
 * Above this many characters of JSON, the upload is compressed.
 *
 * The endpoint caps a request body (4 MB, under Vercel's 4.5 MB), and the
 * history grows about 8 KB a session with nothing trimmed — plain JSON stopped
 * fitting at roughly 250 sessions under the old 2 MB cap, after which every
 * backup failed. Training logs are the same keys over and over and gzip to a
 * tenth of their size or less, so a compressed backup fits thousands of
 * sessions.
 *
 * Below the threshold the body stays plain JSON, exactly as before: every
 * build that can restore a backup today can still restore those.
 */
export const ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS = 1_000_000;

/** The one encoding a compressed backup uses. */
export const ACCOUNT_BACKUP_ENCODING = 'gzip-base64';

interface CompressedAccountBackup {
  encoding: typeof ACCOUNT_BACKUP_ENCODING;
  data: string;
}

export interface AccountBackupPayload {
  version: typeof ACCOUNT_BACKUP_VERSION;
  exportedAt: string;
  database: Omit<AppDatabase, 'exerciseLibrary'>;
  workoutHistory: WorkoutHistoryStore;
}

/** What one side of the restore question holds, counted the same way on both sides. */
export interface BackupContents {
  workoutCount: number;
  cardioCount: number;
  customProgramCount: number;
  /**
   * Catalog programmes taken up (a plan and no template row of their own), so
   * a phone whose only programme is an adopted one does not read as having none.
   */
  readyProgramCount: number;
  bodyweightCount: number;
  measurementCount: number;
  /**
   * What the reader wrote themselves, with no workout behind it: the lifts
   * they taught the name book, strength targets, goals told to the coach.
   * Counted so the question can show them (hasLocalDataWorthKeeping keeps them).
   */
  nameBookCount: number;
  strengthGoalCount: number;
  coachGoalCount: number;
}

/** What the restore dialog says, so the reader knows what they are accepting. */
export interface AccountBackupSummary extends BackupContents {
  exportedAt: string;
}

export function buildAccountBackupPayload(
  database: AppDatabase,
  workoutHistory: WorkoutHistoryStore,
  exportedAt: string,
): AccountBackupPayload {
  const { exerciseLibrary: _stripped, ...rest } = database;
  return {
    version: ACCOUNT_BACKUP_VERSION,
    exportedAt,
    // The coach-log deletes this phone still owes are its own errand, and
    // their labels are what the delete route asks for: they do not leave the
    // phone in a backup. A restore keeps the device's list either way
    // (DEVICE_ONLY_PREFERENCE_FIELDS).
    database: { ...rest, preferences: { ...rest.preferences, pendingAiLogDeletions: [] } },
    workoutHistory,
  };
}

/**
 * Whether a server response is a backup this app can restore. Shape-checks
 * only what this module itself relies on; field-level repair belongs to the
 * normalizers the restore path already runs.
 */
export function parseAccountBackupPayload(raw: unknown): AccountBackupPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Partial<AccountBackupPayload>;
  if (candidate.version !== ACCOUNT_BACKUP_VERSION) {
    return null;
  }
  if (typeof candidate.exportedAt !== 'string' || !candidate.exportedAt) {
    return null;
  }
  if (!candidate.database || typeof candidate.database !== 'object') {
    return null;
  }
  if (!candidate.workoutHistory || typeof candidate.workoutHistory !== 'object') {
    return null;
  }
  return candidate as AccountBackupPayload;
}

/** The request body for an upload: plain JSON, or its compressed envelope once it is large. */
export function encodeAccountBackupBody(payload: AccountBackupPayload): string {
  const json = JSON.stringify(payload);
  if (json.length <= ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS) {
    return json;
  }
  const envelope: CompressedAccountBackup = {
    encoding: ACCOUNT_BACKUP_ENCODING,
    // Not fflate's strToU8: its no-TextEncoder fallback mangles emoji (lib/utf8).
    data: bytesToBase64(gzipSync(utf8Encode(json), { level: 6 })),
  };
  return JSON.stringify(envelope);
}

/**
 * How much one stretch of the async encoder works before it gives the thread
 * back: 64 K characters of JSON per slice, two slices per stretch. Measured with
 * node --jitless (the nearest stand-in for Hermes' interpreter), gzip costs
 * about 200 ms a megabyte, so a stretch is about 25 ms. The one-shot call it
 * replaces held the thread for 0.6 s at 3 MB and 1.3 s at 6 MB, on the Home or
 * completion screen, eight seconds after the last change.
 */
export const ACCOUNT_BACKUP_SLICE_CHARS = 65_536;
export const ACCOUNT_BACKUP_SLICES_PER_STRETCH = 2;

/** Bytes per base64 slice; a multiple of three, so only the last one is padded. */
const BASE64_SLICE_BYTES = 3 * 32_768;

/**
 * `encodeAccountBackupBody` that lets the UI run in between.
 *
 * The result decodes to the same payload and has the same envelope, so the
 * server and `decodeAccountBackupBody` are untouched; only the compressed
 * bytes may differ from gzipSync's (streamed blocks), by a fraction of a
 * percent. The lib stays pure by taking the yield as a parameter: the caller
 * passes a macrotask yield, the tests pass a spy.
 *
 * The JSON is taken whole before the first yield, so what is sent is one
 * snapshot of the payload however long the encode is spread over.
 */
export async function encodeAccountBackupBodyAsync(
  payload: AccountBackupPayload,
  yieldToUi: () => Promise<void>,
): Promise<string> {
  const json = JSON.stringify(payload);
  if (json.length <= ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS) {
    return json;
  }
  let sinceYield = 0;
  const stretchDone = async () => {
    sinceYield += 1;
    if (sinceYield >= ACCOUNT_BACKUP_SLICES_PER_STRETCH) {
      sinceYield = 0;
      await yieldToUi();
    }
  };

  const parts: Uint8Array[] = [];
  const gzip = new Gzip({ level: 6 }, (chunk) => {
    parts.push(chunk);
  });
  for (let start = 0; start < json.length; ) {
    let end = Math.min(start + ACCOUNT_BACKUP_SLICE_CHARS, json.length);
    // A cut between the halves of a surrogate pair would encode each half as
    // U+FFFD; move it back so the bytes equal those of the whole string.
    if (end < json.length && isHighSurrogateUnit(json.charCodeAt(end - 1))) {
      end -= 1;
    }
    gzip.push(utf8Encode(json.slice(start, end)), end >= json.length);
    start = end;
    await stretchDone();
  }

  let size = 0;
  for (const part of parts) {
    size += part.length;
  }
  const packed = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    packed.set(part, offset);
    offset += part.length;
  }
  const pieces: string[] = [];
  for (let start = 0; start < packed.length; start += BASE64_SLICE_BYTES) {
    pieces.push(bytesToBase64(packed.subarray(start, start + BASE64_SLICE_BYTES)));
    await stretchDone();
  }
  const envelope: CompressedAccountBackup = { encoding: ACCOUNT_BACKUP_ENCODING, data: pieces.join('') };
  return JSON.stringify(envelope);
}

function isHighSurrogateUnit(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * What the server handed back, unwrapped when it is a compressed envelope.
 *
 * Anything else passes through untouched for `parseAccountBackupPayload` to
 * judge. An envelope that does not decompress to JSON comes back as null, so
 * it is refused like any other wrong-shaped download rather than thrown.
 */
export function decodeAccountBackupBody(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || (raw as { encoding?: unknown }).encoding !== ACCOUNT_BACKUP_ENCODING) {
    return raw;
  }
  const data = (raw as { data?: unknown }).data;
  if (typeof data !== 'string') {
    return null;
  }
  const bytes = base64ToBytes(data);
  if (!bytes) {
    return null;
  }
  try {
    return JSON.parse(strFromU8(gunzipSync(bytes)));
  } catch {
    return null;
  }
}

export function countBackupContents(
  database: Partial<
    Pick<
      AppDatabase,
      'workoutSessions' | 'cardioSessions' | 'bodyweightEntries' | 'measurementEntries' | 'workoutTemplates' | 'workoutPlans' | 'exerciseNameBook'
    >
  > & { preferences?: Partial<Pick<AppPreferences, 'strengthGoals' | 'coachGoals'>> | null },
): BackupContents {
  const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);
  const templates = Array.isArray(database.workoutTemplates) ? database.workoutTemplates : [];
  const templateIds = new Set(templates.map((template) => template.id));
  const readyIds = new Set<string>();
  for (const plan of Array.isArray(database.workoutPlans) ? database.workoutPlans : []) {
    if (!plan || typeof plan.id !== 'string' || plan.id.startsWith(ONBOARDING_PLAN_PREFIX)) {
      continue;
    }
    for (const entry of Array.isArray(plan.entries) ? plan.entries : []) {
      if (typeof entry?.workoutTemplateId === 'string' && !templateIds.has(entry.workoutTemplateId)) {
        readyIds.add(entry.workoutTemplateId);
      }
    }
  }
  return {
    workoutCount: count(database.workoutSessions),
    cardioCount: count(database.cardioSessions),
    // Authored programmes only. Every freestyle workout leaves a template
    // behind, and the dialog counted each one as a programme: a reader with
    // one plan and forty free workouts was told the backup held 41.
    customProgramCount: countAuthoredPrograms(templates),
    readyProgramCount: readyIds.size,
    bodyweightCount: count(database.bodyweightEntries),
    measurementCount: count(database.measurementEntries),
    nameBookCount: count(database.exerciseNameBook),
    strengthGoalCount: count(database.preferences?.strengthGoals),
    coachGoalCount: count(database.preferences?.coachGoals),
  };
}

export function describeAccountBackup(payload: AccountBackupPayload): AccountBackupSummary {
  return { exportedAt: payload.exportedAt, ...countBackupContents(payload.database as Partial<AppDatabase>) };
}

/**
 * What the restore-or-keep question shows: both sides, counted alike, so the
 * reader is not choosing between a number and a blank. Counting only this
 * phone's workouts made a phone of two hundred weigh-ins read "0 workouts",
 * and "Restore backup" look free.
 *
 * `workoutInProgress`: a restore puts away a workout or run that is still
 * going, so it is named too.
 *
 * `keepingLocalShrinksCloud` is the automatic backup's own line
 * (backupWouldShrink). Past it, "Use the data on this phone" is asked a
 * second time, naming what the cloud copy holds — one tap used to replace a
 * full history with a phone that had just been set up.
 */
export interface RestoreChoiceSummary {
  cloud: AccountBackupSummary;
  local: BackupContents & { workoutInProgress: boolean };
  keepingLocalShrinksCloud: boolean;
  /**
   * The phone's data was logged while another Google account was signed in
   * (uploadNeedsConsent). The question then says so, offers the reader's own
   * backup first, and always asks twice before that backup is replaced
   * (user decision, 2026-09-28).
   */
  localFromOtherAccount: boolean;
}

export function describeRestoreChoice(
  payload: AccountBackupPayload,
  local: AppDatabase,
  liveSession: boolean,
  localHistory: WorkoutHistoryStore,
  localFromOtherAccount = false,
): RestoreChoiceSummary {
  return {
    cloud: describeAccountBackup(payload),
    local: { ...countBackupContents(local), workoutInProgress: liveSession },
    keepingLocalShrinksCloud: backupWouldShrink(
      countBackup(local, localHistory),
      countBackup(payload.database, payload.workoutHistory),
    ),
    localFromOtherAccount,
  };
}

/**
 * Whether the player holds a workout that a restore would put away.
 *
 * A restore replaces the player's store with the backup's history and nothing
 * else (WorkoutProvider.restoreHistoryFromBackup), so a guided session, a run
 * and a free workout's board all go. This asked about the first two only:
 * a free workout left open when the app closed (#162 keeps it across that)
 * was thrown out by the next sign-in — without a word on an otherwise empty
 * phone, and without its "in progress" line in the question on any other
 * (persistence audit, 2026-09-20).
 *
 * A guided session held as 'completed' is a finished one waiting for its summary to clear it, saved
 * already: not a workout in progress, the same answer every other caller gets (isWorkoutInProgress).
 * Counted, it put "This phone has a workout in progress" in the restore question over a workout
 * that is in History already (bug hunt 2026-10-03). Its saved row still counts as data worth keeping.
 */
export function hasWorkoutInProgress(player: {
  activeSession: { status?: string } | null | undefined;
  activeCardio: unknown;
  freestyleDraft: unknown;
}): boolean {
  return isWorkoutInProgress(player.activeSession) || player.activeCardio != null || player.freestyleDraft != null;
}

/**
 * Whether a template is the programme setup wrote and nobody has touched
 * since: onboarding's own plan points at it, and its `updatedAt` never moved
 * (the same test findReplaceableOnboardingTemplateId uses).
 */
function isUntouchedOnboardingTemplate(
  template: AppDatabase['workoutTemplates'][number],
  planIds: ReadonlySet<string>,
): boolean {
  return (
    template.origin !== 'freestyle' &&
    template.createdAt === template.updatedAt &&
    planIds.has(`${ONBOARDING_PLAN_PREFIX}${template.id}`)
  );
}

/**
 * Whether the device has anything a restore would overwrite. A fresh install
 * restores without asking; a device with logged work gets the choice.
 *
 * What setup writes by itself is not logged work. A new phone is set up
 * before anyone thinks of signing in, and setup leaves a programme and the
 * weigh-in from its About form behind — so every new phone was asked
 * restore-or-keep, and "Use the data on this phone" replaced a year of
 * history with those two things (user decision 2026-09-17: such a phone
 * counts as empty). An edited programme, a second weigh-in, or one whose
 * weight is not setup's number is the reader's own, and asks.
 *
 * So does a workout or run in progress (`liveSession`). A restore replaces
 * the player's store and puts the live session away; once a setup-only phone
 * counted as empty, signing in mid-workout threw that workout out unasked.
 */
/**
 * Whether the first backup of an account needs the reader's yes.
 *
 * An account with no cloud copy takes this phone's data as its first backup.
 * That is right for the person who logged it; it is wrong when the phone was
 * last signed in to another account, because sign-out keeps the data and the
 * account now signing in may be someone else's. The previous account's whole
 * log went to the new one with "backed up" on screen (break round,
 * 2026-09-28; user decision: ask). The same account signing back in, or a
 * phone never signed in before, is not asked.
 *
 * `signedOutSubs` is every account signed out of since the data was last
 * settled: one of them other than this one is enough to ask, because the
 * phone may hold that account's workouts beside this one's.
 */
/**
 * Whether everything logged on this phone is already in an account's own
 * cloud copy — workouts, runs, weigh-ins and measurements, by id.
 *
 * Then the phone holds nothing of anyone else, whoever signed out last. A
 * reader's own log that another account had adopted ("use the phone's data")
 * was flagged "another account's data" when its owner signed back in
 * (third break round, 2026-09-28): the signed-out list says who LEFT, not
 * whose the rows are, and the rows answer that better when there is a copy
 * to compare with.
 */
export function phoneDataIsInCopy(
  local: AppDatabase,
  copy: Partial<AppDatabase> | null | undefined,
  liveSession = false,
): boolean {
  // A workout in progress is in no copy, and programmes and plans are what
  // "worth keeping" also counts: compared on the logged rows alone, a phone
  // whose only foreign data was another account's programme passed as the
  // reader's own (review of the third-round fix, 2026-09-28).
  if (!copy || liveSession) {
    return false;
  }
  const idsOf = (rows: ReadonlyArray<{ id?: unknown }> | undefined) =>
    new Set((Array.isArray(rows) ? rows : []).map((row) => row?.id).filter((id): id is string => typeof id === 'string'));
  const pairs: Array<[ReadonlyArray<{ id?: unknown }> | undefined, ReadonlyArray<{ id?: unknown }> | undefined]> = [
    [local.workoutSessions, copy.workoutSessions],
    [local.cardioSessions, copy.cardioSessions],
    [local.bodyweightEntries, copy.bodyweightEntries],
    [local.measurementEntries, copy.measurementEntries],
    [local.workoutTemplates, copy.workoutTemplates],
    [local.workoutPlans, copy.workoutPlans],
  ];
  return pairs.every(([mine, theirs]) => {
    const inCopy = idsOf(theirs);
    return [...idsOf(mine)].every((id) => inCopy.has(id));
  });
}

/** The shape of a "Delete account" request id: 128 random bits as hex (x-delete-request-id). */
export function isDeleteRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/**
 * How a "Delete account" retry that met an ended session reads (the server's
 * 401 SESSION_REVOKED). 'done': this phone's own delete went through, its
 * answer lost. 'ended': the account was deleted by someone else.
 *
 * The revocation marker carries the id of the request that wrote it, and the
 * answer hands it back; the phone's own id settles it. An answer without an id
 * (a server from before) leaves the old guess: a pending record means this
 * phone sent one.
 */
export function revokedDeleteOutcome(input: {
  pendingBefore: boolean;
  ownRequestId: string;
  answerRequestId: string | null | undefined;
}): 'done' | 'ended' {
  if (typeof input.answerRequestId === 'string' && input.answerRequestId) {
    return input.answerRequestId === input.ownRequestId ? 'done' : 'ended';
  }
  // This server answered that its marker names no request: another phone, or
  // an app too old to send one, deleted the account. Not this phone's.
  if (input.answerRequestId === null) {
    return 'ended';
  }
  return input.pendingBefore ? 'done' : 'ended';
}

/**
 * Whether a cloud copy that refused this phone's upload is this phone's own
 * work, so the upload may be retried onto it without asking anyone.
 *
 * Only when the copy is exactly what this phone sent or confirmed: its
 * fingerprint (accountBackupFingerprint of the whole payload — settings, the
 * name book, programmes and plans included, device-only fields left out) is one
 * of the `inFlightFingerprints` kept before each request, whose answer may never
 * have come back, or is the last confirmed upload's (`lastBackupFingerprint`).
 *
 * An earlier version also took a copy that held nothing this phone lacked. That
 * cannot tell this phone catching up from another phone having deleted a row,
 * dropped a programme or changed a setting — the counts it leaned on lag a copy
 * behind after a lost answer, and settings and the name book were never in them
 * (review of 1a30bc80, 2026-10-03). Anything else is another phone's copy and
 * is asked about.
 */
export function isCopyPhonesOwnWork(input: {
  inFlightFingerprints: readonly string[];
  lastBackupFingerprint?: string | null;
  copy: AccountBackupPayload;
}): boolean {
  const known = [...input.inFlightFingerprints, ...(input.lastBackupFingerprint ? [input.lastBackupFingerprint] : [])];
  return (
    known.length > 0 &&
    known.includes(accountBackupFingerprint(input.copy.database as AppDatabase, input.copy.workoutHistory))
  );
}

export function uploadNeedsConsent(input: {
  signedOutSubs: readonly string[];
  sub: string;
  localWorthKeeping: boolean;
}): boolean {
  return input.localWorthKeeping && input.signedOutSubs.some((signedOut) => signedOut !== input.sub);
}

export function hasLocalDataWorthKeeping(database: AppDatabase, liveSession = false): boolean {
  if (
    liveSession ||
    database.workoutSessions.length > 0 ||
    database.cardioSessions.length > 0 ||
    // Measurements are logged by hand like the rest; a phone holding only
    // those was overwritten on sign-in without being asked.
    database.measurementEntries.length > 0
  ) {
    return true;
  }
  // Setup's own plan is onboarding's. Any other plan is a programme the
  // reader took up: adopting a ready programme writes a plan and no
  // template, so this is the only place it shows, and a phone running one
  // was restored over unasked. The running set is read through the plans:
  // an id with no plan behind it is not a programme — every fresh install
  // carries the seed's `plan_push_pull_legs` that way.
  const plans = database.workoutPlans ?? [];
  if (plans.some((plan) => !plan.id.startsWith(ONBOARDING_PLAN_PREFIX))) {
    return true;
  }
  const planIds = new Set(plans.map((plan) => plan.id));
  if (database.workoutTemplates.some((template) => !isUntouchedOnboardingTemplate(template, planIds))) {
    return true;
  }
  // What the reader wrote themselves, with nothing logged beside it: the
  // lifts they taught the name book, a strength target, a goal told to the
  // coach. Setup writes none of these (the seed's lists are empty), and a
  // restore replaces all three with the backup's.
  if (
    (database.exerciseNameBook ?? []).length > 0 ||
    (database.preferences?.strengthGoals ?? []).length > 0 ||
    (database.preferences?.coachGoals ?? []).length > 0
  ) {
    return true;
  }
  const setupWeight = database.preferences?.setupCurrentWeightKg ?? null;
  const weighIns = database.bodyweightEntries;
  if (weighIns.length > 1 || (weighIns.length === 1 && weighIns[0].weight !== setupWeight)) {
    return true;
  }
  return false;
}

/**
 * Preferences that are this phone's answer to a privacy question, and so are
 * not taken from a backup: whether usage statistics leave the phone, whether
 * the coach may keep a copy of what it is asked, and the label those copies
 * carry. A restore replaced them with whatever the other phone had said — a
 * reader who had switched statistics off on this phone found them on again,
 * and a "no" to the coach log became a "yes" nobody gave here.
 *
 * The consents default to no, so this phone's answer is the safe one. Usage
 * statistics default to yes: a new phone has "said" yes only because nobody
 * asked it, and taking its value turned the old phone's "no" into a yes. For
 * that one, either side's no wins.
 */
export const DEVICE_PRIVACY_PREFERENCE_FIELDS = [
  'usageStatisticsEnabled',
  'aiLogId',
  'aiLogChatConsent',
  'aiLogComposerConsent',
  'aiLogPhotoConsent',
] as const;

type DevicePrivacyField = (typeof DEVICE_PRIVACY_PREFERENCE_FIELDS)[number];

export function keepDevicePrivacyChoices<T extends Pick<AppPreferences, DevicePrivacyField>>(
  restored: T,
  device: Pick<AppPreferences, DevicePrivacyField>,
): T {
  const kept = { ...restored };
  for (const field of DEVICE_PRIVACY_PREFERENCE_FIELDS) {
    (kept as Record<string, unknown>)[field] = device[field];
  }
  kept.usageStatisticsEnabled = restored.usageStatisticsEnabled !== false && device.usageStatisticsEnabled !== false;
  return kept;
}

/**
 * The preferences a restore commits: the backup's, minus what belongs to
 * this phone (entitlement and meters, privacy answers), with the running set
 * made to agree with the backup's plans the way a load does it — the restore
 * normalized the backup but skipped that step, so a backup from before
 * activateOnboardingPlan restored with the cap undercounting by one, and a
 * backup carrying the seed's phantom plan id restored it (reconcileRunningSet).
 */
export function preferencesForRestore(
  restored: AppPreferences,
  device: AppPreferences,
  plans: ReadonlyArray<{ id: string; entries: ReadonlyArray<unknown> }>,
): AppPreferences {
  const kept = keepDevicePrivacyChoices(keepDeviceEntitlement(restored, device), device);
  // And the completion dismissals the same way: a backup from before PR #350
  // carries answers for plans it no longer holds (hunt 10, #19).
  return reconcileCompletionDismissals(
    reconcileRunningSet(
      { ...kept, legalAcceptance: laterLegalAcceptance(device.legalAcceptance, restored.legalAcceptance) },
      plans,
    ),
    plans,
  );
}

/**
 * A cheap summary of everything a backup carries, which changes when the
 * reader changes anything worth backing up.
 *
 * The automatic backup used to watch five counts, so a corrected workout, an
 * edited programme, a name taught to the book, a goal or a setting never
 * reached the cloud copy. The whole payload is megabytes, so it is not
 * serialized for this: the collections that are only ever added to or
 * removed from (exercise logs, a programme's exercise rows — which move with
 * their template's `updatedAt` — and the player's history) are counted, and
 * the small ones are hashed in full.
 *
 * Meters and privacy answers are left out: they are not restored anyway, and
 * each coach question would otherwise upload the whole history again.
 */
export function accountBackupFingerprint(database: AppDatabase, history: WorkoutHistoryStore): string {
  const hash = createHash();
  const preferences: Record<string, unknown> = { ...database.preferences };
  for (const field of [...DEVICE_ONLY_PREFERENCE_FIELDS, ...DEVICE_PRIVACY_PREFERENCE_FIELDS]) {
    delete preferences[field];
  }
  hash.add(JSON.stringify(preferences));
  hash.add(JSON.stringify(database.exerciseNameBook ?? null));
  hash.add(JSON.stringify(database.workoutPlans ?? null));
  hash.add(JSON.stringify(database.bodyweightEntries ?? null));
  hash.add(JSON.stringify(database.measurementEntries ?? null));
  hash.add(JSON.stringify(database.cardioSessions ?? null));
  for (const template of database.workoutTemplates ?? []) {
    hash.add(`${template.id}|${template.updatedAt}|${template.name}|${template.origin}`);
  }
  // A saved workout is edited in its name, notes and feel, and its sets are
  // written again when a finished board is finished once more (a merge replaces
  // the stored logs under new ids, and the totals with them).
  for (const session of database.workoutSessions ?? []) {
    hash.add(
      `${session.id}|${session.workoutNameSnapshot}|${session.sessionNotes ?? ''}|${session.feel ?? ''}|` +
        `${session.setsCompleted}|${session.totalVolumeKg}|${session.performedAt}|${session.durationMinutes}`,
    );
  }
  // Each log by its id and what is in it: counting them alone missed a set added
  // to a lift that already had logs.
  for (const log of database.exerciseLogs ?? []) {
    let volume = 0;
    for (const set of log.sets ?? []) {
      volume += (Number(set.weight) || 0) * (Number(set.reps) || 0);
    }
    hash.add(`${log.id}|${log.sets?.length ?? 0}|${volume}`);
  }
  const newest = history.sessions?.[0];
  hash.add(
    [
      database.exerciseTemplates?.length ?? 0,
      database.exerciseLogs?.length ?? 0,
      history.sessions?.length ?? 0,
      newest ? `${newest.sessionId}@${newest.performedAt}` : '',
      Object.keys(history.slotHistory ?? {}).length,
      history.lastSelectedTemplateId ?? '',
    ].join('|'),
  );
  return hash.digest();
}

/** cyrb53, fed piece by piece so no multi-megabyte string is ever built. */
function createHash() {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const feed = (code: number) => {
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  };
  return {
    add(text: string) {
      for (let index = 0; index < text.length; index += 1) {
        feed(text.charCodeAt(index));
      }
      // A separator, so ["ab", "c"] and ["a", "bc"] differ.
      feed(0x1f);
    },
    digest(): string {
      let a = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
      a ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      let b = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
      b ^= Math.imul(a ^ (a >>> 13), 3266489909);
      return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
    },
  };
}

/**
 * How much of the log a database holds, for the shrink guard: workouts,
 * cardio, bodyweight, measurements and programmes. Missing arrays (an old
 * backup) count as none.
 */
export function countBackupItems(
  database: Partial<Pick<AppDatabase, 'workoutSessions' | 'cardioSessions' | 'bodyweightEntries' | 'measurementEntries' | 'workoutTemplates'>>,
): number {
  return (
    (database.workoutSessions?.length ?? 0) +
    (database.cardioSessions?.length ?? 0) +
    (database.bodyweightEntries?.length ?? 0) +
    (database.measurementEntries?.length ?? 0) +
    (database.workoutTemplates?.length ?? 0)
  );
}

/**
 * How much of the workout history a copy holds: the sessions the player
 * remembers and every set it remembers per slot — where each lift's "last
 * time", its prefills and its progression are read from. Anything that is not
 * a list counts as none (an old or odd backup).
 */
export function countHistoryItems(history: unknown): number {
  if (!history || typeof history !== 'object') {
    return 0;
  }
  const { sessions, slotHistory } = history as { sessions?: unknown; slotHistory?: unknown };
  let count = Array.isArray(sessions) ? sessions.length : 0;
  if (slotHistory && typeof slotHistory === 'object') {
    for (const entries of Object.values(slotHistory)) {
      count += Array.isArray(entries) ? entries.length : 0;
    }
  }
  return count;
}

/** How much one copy holds, store by store. */
export interface BackupCounts {
  /** countBackupItems of the database. */
  itemCount: number;
  /** countHistoryItems of the workout history. */
  historyCount: number;
}

export function countBackup(
  database: Parameters<typeof countBackupItems>[0],
  history: unknown,
): BackupCounts {
  return { itemCount: countBackupItems(database), historyCount: countHistoryItems(history) };
}

/** The same counts, as the stored account keeps them. */
export function syncCounts(counts: BackupCounts): Pick<BackupSyncState, 'lastBackupItemCount' | 'lastBackupHistoryCount'> {
  return { lastBackupItemCount: counts.itemCount, lastBackupHistoryCount: counts.historyCount };
}

/**
 * Whether replacing `cloud` with `local` would lose most of either store.
 *
 * Each store is judged on its own because each is set aside on its own. The
 * workout store's loader puts an unreadable bundle away and opens on an empty
 * history while the database is whole, and the guard counted the database
 * only: eight seconds later the automatic backup uploaded that empty history
 * over the only copy left of it (persistence audit, 2026-09-20). A sum of the
 * two would not have caught it either — a year of weigh-ins outweighs the
 * history it would be losing.
 */
export function backupWouldShrink(
  local: BackupCounts,
  cloud: { itemCount: number | null; historyCount: number | null },
): boolean {
  return (
    autoBackupWouldShrinkLog(local.itemCount, cloud.itemCount) ||
    autoBackupWouldShrinkLog(local.historyCount, cloud.historyCount)
  );
}

/**
 * Whether an automatic backup would replace a cloud copy holding far more of
 * the log than this phone does.
 *
 * The automatic backup fires on any change. A phone whose database
 * was set aside as unreadable opens empty and still signed in; the reader
 * redoes setup or logs one workout, and eight seconds later the one full copy
 * left was replaced by that. Less than half of a copy of at least three
 * things is not a reader tidying their history — the automatic path stops,
 * and "Back up now" stays the reader's own decision.
 *
 * Counted over everything the backup watches (countBackupItems), not workouts
 * alone: a reader with two workouts and a year of weigh-ins was never
 * protected by a workout count (PR #119 review). One store's count at a time:
 * backupWouldShrink applies it to each.
 */
export function autoBackupWouldShrinkLog(localItemCount: number, lastBackupItemCount: number | null): boolean {
  if (lastBackupItemCount === null || lastBackupItemCount < 3) {
    return false;
  }
  return localItemCount * 2 < lastBackupItemCount;
}

/** What this phone knows about the cloud copy (its stored account). */
export interface BackupSyncState {
  lastBackupAt: string | null;
  lastBackupItemCount: number | null;
  /** countHistoryItems of the copy; null for an account stored before it was kept. */
  lastBackupHistoryCount: number | null;
  /** Set by "Delete cloud backup"; only the reader's own backup lifts it. */
  autoBackupPaused: boolean;
  /**
   * The version of the cloud copy this phone last wrote or restored — the
   * copy an upload names, and the only one the server lets it replace. Null
   * when unknown (see isCloudCopyThisPhones).
   */
  cloudVersion: string | null;
}

/**
 * What the cloud holds, as far as Reset's dialog needs to say it.
 * - 'none': nothing of this phone's data. Backups are held and no copy was
 *   written or restored: after "Delete cloud backup", a copy deleted elsewhere,
 *   or "Not now" on uploading to a different account. Every place that holds
 *   backups (useAccountBackup: copyWasDeleted, the sign-in and unattended
 *   consent holds, deleteRemoteBackup) clears the backup time with it, and
 *   every place that lifts the hold (a backup, a restore) sets one.
 * - 'behind': a copy older than the phone.
 * - 'current': a copy that holds everything, or no account to ask about.
 */
export type CloudCopyState = 'behind' | 'current' | 'none';

/**
 * `phoneFingerprint` is a function because it walks the whole history, which
 * the held states do not need.
 */
export function cloudCopyState(
  sync: Pick<BackupSyncState, 'autoBackupPaused' | 'lastBackupAt'> & { lastBackupFingerprint: string | null },
  phoneFingerprint: () => string,
): CloudCopyState {
  // Held backups with no backup time: no copy. Held with one (the unattended
  // upload waiting for a yes keeps the time of the copy that is there): a copy
  // exists, and what it holds is the fingerprint's to say, not the hold's.
  if (sync.autoBackupPaused && !sync.lastBackupAt) {
    return 'none';
  }
  return sync.lastBackupFingerprint !== phoneFingerprint() ? 'behind' : 'current';
}

/**
 * The Reset dialog's text. A signed-in reader is told what signing in again
 * will give back: everything, the older copy, or nothing.
 */
export function resetDialogMessageKey(
  signedIn: boolean,
  copy: CloudCopyState,
):
  | 'settings.resetDialog.message'
  | 'settings.resetDialog.message.signedIn'
  | 'settings.resetDialog.message.signedInBehind'
  | 'settings.resetDialog.message.signedInNoCopy' {
  if (!signedIn) {
    return 'settings.resetDialog.message';
  }
  return copy === 'behind'
    ? 'settings.resetDialog.message.signedInBehind'
    : copy === 'none'
      ? 'settings.resetDialog.message.signedInNoCopy'
      : 'settings.resetDialog.message.signedIn';
}

/**
 * What a backup does before it touches the network: stay out, read the cloud
 * copy first, or upload.
 *
 * "Back up now" used to upload without either check, so a phone whose
 * database had been set aside as unreadable — open, empty, still signed in —
 * replaced the one good copy with nothing when the reader pressed it to be
 * safe. Now a shrinking upload reads the copy first and, from there, asks
 * (decideAfterLook). The automatic backup does not ask, so it stays out.
 */
export function planBackup(input: {
  interactive: boolean;
  sync: BackupSyncState;
  local: BackupCounts;
}): 'skip' | 'look' | 'upload' {
  const { interactive, sync, local } = input;
  if (!interactive && sync.autoBackupPaused) {
    // The reader deleted the cloud copy. Writing it back eight seconds after
    // the next weigh-in would undo that without a word.
    return 'skip';
  }
  if (!sync.lastBackupAt || sync.lastBackupItemCount === null || sync.lastBackupHistoryCount === null) {
    // Never synced (what is there has not been seen), or synced before the
    // size of the copy was kept (nothing to compare against). An account
    // from before the history was counted looks once, and learns it.
    return 'look';
  }
  if (backupWouldShrink(local, { itemCount: sync.lastBackupItemCount, historyCount: sync.lastBackupHistoryCount })) {
    return interactive ? 'look' : 'skip';
  }
  if (!sync.cloudVersion) {
    // An upload names the copy it replaces, and a copy this phone has not
    // read cannot be named: an account from before versions reads it once
    // (server audit, 2026-09-21).
    return 'look';
  }
  return 'upload';
}

export type BackupLookResult = ({ kind: 'backup' } & BackupCounts) | { kind: 'none' } | { kind: 'unreachable' };

/**
 * Whether the copy the cloud holds is the one this phone last wrote or
 * restored — a copy it may replace without asking anyone.
 *
 * Two phones on one account used to take turns overwriting the one copy, the
 * older data winning whenever its phone wrote last (server audit,
 * 2026-09-21). Versions settle it when both sides have one. An account stored
 * before versions has none, and adopting whatever its first look found would
 * be that same overwrite once more — so it recognizes its own copy the two
 * ways it can: a restore kept the copy's `exportedAt` as the backup time, and
 * an upload kept the fingerprint of what it sent.
 */
export function isCloudCopyThisPhones(
  sync: Pick<BackupSyncState, 'cloudVersion' | 'lastBackupAt'> & {
    lastBackupFingerprint: string | null;
    /** What the uploads last sent were made of, kept before each request (see isCopyPhonesOwnWork). */
    uploadInFlightFingerprints?: readonly string[];
  },
  remote: { version: string | null; payload: AccountBackupPayload },
): boolean {
  // An upload whose answer never came back may have landed, and then the
  // versions differ although the copy is this phone's own.
  if (
    sync.uploadInFlightFingerprints?.length &&
    sync.uploadInFlightFingerprints.includes(
      accountBackupFingerprint(remote.payload.database as AppDatabase, remote.payload.workoutHistory),
    )
  ) {
    return true;
  }
  if (sync.cloudVersion !== null && remote.version !== null) {
    return sync.cloudVersion === remote.version;
  }
  if (sync.lastBackupAt !== null && remote.payload.exportedAt === sync.lastBackupAt) {
    return true;
  }
  return (
    sync.lastBackupFingerprint !== null &&
    accountBackupFingerprint(remote.payload.database as AppDatabase, remote.payload.workoutHistory) ===
      sync.lastBackupFingerprint
  );
}

/**
 * What a backup does once it has read the cloud copy.
 *
 * - 'settle': never synced and the reader is here — sign-in's own question.
 * - 'ask': this upload would shrink the copy, or the copy is not the one this
 *   phone last wrote or restored (`unseen`) — the restore-or-keep question.
 * - 'hold': shrinking, unattended — keep the copy and remember its size.
 * - 'gone': synced before, and there is no copy now — it was deleted elsewhere.
 * - 'upload', or 'fail' when nothing may be written.
 *
 * Unattended, a phone that has never synced uploads only onto a confirmed
 * "no backup"; a copy it has not seen is not overwritten by nobody's decision.
 * The same holds for a phone that has synced and finds another phone's copy.
 */
export function decideAfterLook(input: {
  interactive: boolean;
  neverSynced: boolean;
  remote: BackupLookResult;
  local: BackupCounts;
  /** The copy found is not the one this phone last wrote or restored (isCloudCopyThisPhones). */
  unseen?: boolean;
}): 'settle' | 'ask' | 'hold' | 'upload' | 'gone' | 'fail' {
  const { interactive, neverSynced, remote, local, unseen = false } = input;
  if (neverSynced) {
    if (interactive) {
      return 'settle';
    }
    return remote.kind === 'none' ? 'upload' : 'fail';
  }
  if (remote.kind === 'unreachable') {
    return 'fail';
  }
  if (remote.kind === 'none') {
    // This phone has backed up (or restored) and the copy is gone: deleted on
    // the web page or from another phone, never by this one (its own delete
    // forgets the backup time). Uploaded now, the whole history came back as a
    // first backup without a word (bug hunt 5, 2026-10-03). The reader is told,
    // and asked before a new copy is made.
    return 'gone';
  }
  if (remote.kind === 'backup' && unseen) {
    // Another phone wrote it. Replacing it is the reader's decision, with
    // both sides counted in front of them, and nobody's while they are away.
    return interactive ? 'ask' : 'fail';
  }
  if (remote.kind === 'backup' && backupWouldShrink(local, remote)) {
    return interactive ? 'ask' : 'hold';
  }
  return 'upload';
}
