const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * No bug in the app may call our server in an unbounded loop.
 *
 * Since 2026-10-09 the Vercel team is on Pro with on-demand billing, so a
 * client that asks again and again no longer hits a Hobby cap - it runs up a
 * bill. A request can be bounded in many ways (a tap, a launch, a quiet pause,
 * a batch, a retry limit, a pacing budget), but only if someone decided which,
 * and a new call site is exactly where nobody has yet.
 *
 * This suite is the decision, written down. Every place in `src/`, `App.tsx`
 * and `index.ts` that sends a request to our server is listed below with what
 * triggers it and what stops it from firing again and again. A call site that
 * is not on the list fails the build with a message asking its author to
 * state the bound; so does a caller of one, an entry whose code is gone, a
 * stated bound whose marker was removed from the source, and a request made
 * from inside an effect or an interval that the list does not acknowledge.
 *
 * What is NOT scanned, on purpose: third parties (Google sign-in, RevenueCat,
 * the exercise images on cdn.jsdelivr.net - Anthropic is only ever called by
 * api/ai-coach.ts, never by the app), and `Linking.openURL` hand-offs, which
 * open a page in the system browser on a tap.
 *
 * The check runs on a map of file name -> text, so the tests at the bottom can
 * feed it a doctored copy of the tree: a guard that cannot fail proves nothing.
 */

const ROOT = path.join(__dirname, '..', '..');

/** The closed vocabulary of ways a request is bounded. */
const BOUND_KINDS = {
  'user-action': 'one request per tap, none on its own',
  'once-per-launch': 'at most once each time the app starts',
  'once-per-foreground': 'at most once each time the app returns to the front',
  'in-flight-guard': 'a second trigger while one request runs is ignored or joins it',
  throttled: 'a pure time window decides whether to ask (lib/serverNotice)',
  paced: 'lib/requestPacing: minimum gap, budget per hour, backoff after failures',
  debounced: 'waits for a quiet pause after the last change, and only when the data differs',
  batched: 'many events leave in one request',
  'max-retries': 'a retry loop with a fixed upper limit',
};
/** At least one of these must be stated for anything that can start without a tap. */
const RATE_BOUNDS = ['once-per-launch', 'once-per-foreground', 'throttled', 'paced', 'debounced', 'batched', 'max-retries'];

const ANALYTICS_GUARDS = [
  { file: 'src/features/analytics/analyticsClient.ts', text: 'ANALYTICS_FLUSH_PACING' },
  { file: 'src/features/analytics/analyticsClient.ts', text: 'pacingWaitMs(pacing' },
  { file: 'src/features/analytics/analyticsClient.ts', text: 'notePacingOutcome(' },
  { file: 'src/features/analytics/analyticsClient.ts', text: 'FLUSH_DELAY_MS' },
  { file: 'src/features/analytics/analyticsClient.ts', text: 'takeBatch(' },
  { file: 'src/features/analytics/analyticsClient.ts', text: 'if (flushTimer)' },
  { file: 'src/features/analytics/analyticsClient.ts', text: 'flushing' },
];

/**
 * Every function that sends a request to our server, or reaches one in its
 * own file, keyed `file#function`. `callers` is the list of files that name it
 * (the direct callers); 'internal' means the bound is inside the module and
 * any caller is safe (the analytics queue).
 */
const ENTRY_POINTS = {
  'src/lib/aiCoachClient.ts#reportAiCoachAnswer': {
    trigger: 'user tap: Send on the "report this coach answer" sheet',
    bounds: ['user-action', 'in-flight-guard'],
    callers: [
      {
        file: 'src/screens/AICoachChatScreen.tsx',
        trigger: 'the sheet\'s onSend, after the reader picked a reason',
        bounds: ['user-action', 'in-flight-guard'],
        // The sheet ignores a second tap until the first settles.
        guards: [{ file: 'src/components/CoachReportSheet.tsx', text: 'sendingRef.current' }],
      },
    ],
  },
  'src/lib/aiCoachClient.ts#forgetAiCoachLog': {
    trigger: 'a delete of the kept coach copies: the reader\'s own switch, Reset, account deletion - and the retry of an owed delete',
    bounds: ['user-action', 'once-per-launch', 'once-per-foreground', 'paced', 'in-flight-guard'],
    callers: [
      {
        file: 'src/hooks/usePendingAiLogDeletions.ts',
        trigger: 'launch, each return to the foreground while a delete is owed, and one timer when a label is still inside its write window',
        bounds: ['once-per-launch', 'once-per-foreground', 'paced', 'in-flight-guard'],
        automatic: true,
        // Foreground retries go through AI_LOG_RETRY_PACING (backoff after a
        // failure, 20 an hour); the runner sends a label already on its way
        // once; at most MAX_PENDING_AI_LOG_DELETIONS labels exist.
        guards: [
          { file: 'src/hooks/usePendingAiLogDeletions.ts', text: 'AI_LOG_RETRY_PACING' },
          { file: 'src/hooks/usePendingAiLogDeletions.ts', text: 'pacingWaitMs(pacingRef.current' },
          { file: 'src/hooks/usePendingAiLogDeletions.ts', text: 'notePacingOutcome(' },
          { file: 'src/lib/aiLogDeletion.ts', text: 'inFlight.get(logId)' },
          { file: 'src/lib/aiLogDeletion.ts', text: 'MAX_PENDING_AI_LOG_DELETIONS' },
        ],
      },
      {
        file: 'src/app/renderProfileTab.tsx',
        trigger: 'user taps in Settings: take back permission to keep copies, delete the account',
        bounds: ['user-action'],
      },
    ],
  },
  'src/lib/aiCoachClient.ts#requestAiCoachAdvice': {
    trigger: 'user sends a question to the coach (chat, onboarding helper, the free tier\'s three demo moments)',
    bounds: ['user-action', 'in-flight-guard'],
    callers: [
      {
        file: 'src/screens/AICoachChatScreen.tsx',
        trigger: 'Send in the chat; the demo question is sent from an effect, once',
        bounds: ['user-action', 'in-flight-guard', 'once-per-launch'],
        // One question at a time (`asking`); the demo moment is spent through a ref.
        guards: [
          { file: 'src/screens/AICoachChatScreen.tsx', text: 'demoSent.current' },
          { file: 'src/screens/AICoachChatScreen.tsx', text: 'if (asking || mustAcknowledgeOnline)' },
        ],
      },
      {
        file: 'src/screens/OnboardingScreen.tsx',
        trigger: 'user taps Ask on the onboarding helper',
        bounds: ['user-action'],
      },
    ],
  },
  'src/lib/aiCoachClient.ts#requestProgramTableFromImage': {
    trigger: 'user picks a photo of a programme to import (Pro)',
    bounds: ['user-action'],
    callers: [{ file: 'src/app/onboardingFinishes.tsx', trigger: 'the photo picker\'s result', bounds: ['user-action'] }],
  },
  'src/lib/aiCoachClient.ts#requestProgrammeComposition': {
    trigger: 'user taps Build the week on a programme offer (Pro)',
    bounds: ['user-action', 'in-flight-guard'],
    callers: [{ file: 'src/app/renderHomeScreens.tsx', trigger: 'the chat\'s onComposeProgramme', bounds: ['user-action', 'in-flight-guard'] }],
  },
  'src/features/account/backupApi.ts#uploadBackup': {
    trigger: 'sign-in, "Back up now", an answered restore-or-keep question, and the automatic backup',
    bounds: ['user-action', 'debounced', 'paced', 'max-retries'],
    callers: [
      {
        file: 'src/features/account/useAccountBackup.ts',
        trigger: 'user actions, or the automatic backup after an 8 s quiet pause when the data differs from the cloud copy',
        bounds: ['user-action', 'debounced', 'paced', 'max-retries'],
        automatic: true,
        guards: [
          { file: 'src/features/account/useAccountBackup.ts', text: 'AUTO_BACKUP_QUIET_MS' },
          { file: 'src/features/account/useAccountBackup.ts', text: 'AUTO_BACKUP_PACING' },
          { file: 'src/features/account/useAccountBackup.ts', text: 'pacingWaitMs(backupPacingRef.current' },
          { file: 'src/features/account/useAccountBackup.ts', text: 'current.lastBackupFingerprint === accountBackupFingerprint(database, workoutHistory)' },
          { file: 'src/features/account/useAccountBackup.ts', text: 'unseenCopyFoundRef.current' },
          // uploadCurrent's loop: one silent retry, a second refusal returns.
          { file: 'src/features/account/useAccountBackup.ts', text: 'if (attempt > 0)' },
        ],
      },
    ],
  },
  'src/features/account/backupApi.ts#downloadBackup': {
    trigger: 'sign-in, restore, "Back up now", and the automatic backup\'s look at the cloud copy',
    bounds: ['user-action', 'debounced', 'paced'],
    callers: [{ file: 'src/features/account/useAccountBackup.ts', trigger: 'as uploadBackup', bounds: ['user-action', 'debounced', 'paced'], automatic: true }],
  },
  'src/features/account/backupApi.ts#deleteBackup': {
    trigger: 'user taps: delete the cloud copy, delete the account',
    bounds: ['user-action'],
    callers: [{ file: 'src/features/account/useAccountBackup.ts', trigger: 'deleteRemoteBackup / deleteAccount', bounds: ['user-action'], automatic: true }],
  },
  'src/features/account/backupApi.ts#exchangeAppleSession': {
    trigger: 'user signs in with Apple',
    bounds: ['user-action'],
    callers: [{ file: 'src/features/account/appleAuth.ts', trigger: 'the sign-in flow', bounds: ['user-action'] }],
  },
  'src/features/account/backupApi.ts#renewAppleSession': {
    trigger: 'a backup, or a return to the foreground, while the Apple session is inside its last 30 days',
    bounds: ['once-per-foreground', 'debounced'],
    callers: [
      {
        file: 'src/features/account/appleAuth.ts',
        trigger: 'getFreshAppleToken inside the renewal window; a success moves the expiry out of the window',
        bounds: ['once-per-foreground', 'debounced'],
        automatic: true,
        guards: [
          { file: 'src/features/account/appleAuth.ts', text: 'remaining < RENEW_WINDOW_MS' },
          { file: 'src/features/account/appleAuth.ts', text: 'remaining >= RENEW_WINDOW_MS' },
        ],
      },
    ],
  },
  'src/features/serverNotice/serverNoticeClient.ts#fetchServerNotice': {
    trigger: 'launch and each return to the foreground',
    bounds: ['once-per-launch', 'once-per-foreground', 'throttled', 'in-flight-guard'],
    callers: [
      {
        file: 'src/features/serverNotice/ServerNoticeDialog.tsx',
        trigger: 'launch and the foreground event; asked again only after six hours, or five minutes after a failure',
        bounds: ['once-per-launch', 'once-per-foreground', 'throttled', 'in-flight-guard'],
        automatic: true,
        guards: [
          { file: 'src/features/serverNotice/ServerNoticeDialog.tsx', text: 'shouldCheckServerNotice(' },
          { file: 'src/features/serverNotice/ServerNoticeDialog.tsx', text: 'inFlightRef.current' },
          { file: 'src/lib/serverNotice.ts', text: 'SERVER_NOTICE_RETRY_MS' },
        ],
      },
    ],
  },
  'src/features/analytics/analyticsClient.ts#trackEvent': {
    trigger: 'any usage event or error report raised anywhere in the app - it only queues; a flush sends the queue',
    bounds: ['batched', 'paced', 'debounced', 'in-flight-guard'],
    callers: 'internal',
    guards: ANALYTICS_GUARDS,
  },
  'src/features/analytics/analyticsClient.ts#setUsageStatisticsEnabled': {
    trigger: 'App.tsx hands the reader\'s Usage statistics switch over; turning it on lets the queue flush',
    bounds: ['batched', 'paced', 'debounced', 'in-flight-guard'],
    callers: 'internal',
    guards: ANALYTICS_GUARDS,
  },
};

/**
 * Loop constructs with no bound in their own header, in the files that talk to
 * the server. Each is stated with the marker that bounds it.
 */
const UNBOUNDED_LOOPS = {
  'src/features/account/useAccountBackup.ts': [
    {
      what: 'uploadCurrent: for (let attempt = 0; ; attempt += 1)',
      bound: 'max-retries: one silent retry, a second BACKUP_CHANGED returns \'changed\'',
      marker: 'if (attempt > 0)',
    },
  ],
};

// ---------------------------------------------------------------- scanning

function listSourceFiles() {
  const out = ['App.tsx', 'index.ts'];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(rel);
      }
    }
  };
  walk('src');
  return out.filter((rel) => fs.existsSync(path.join(ROOT, rel)));
}

function readTree() {
  const files = {};
  for (const rel of listSourceFiles()) {
    files[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  }
  return files;
}

/** The text with comments blanked (same length, newlines kept), so a mention in prose is not a call. */
function stripComments(text) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s;{}),(])\/\/[^\n]*/gm, (match, lead) => lead + blank(match.slice(lead.length)));
}

function topLevelFunctions(code) {
  const found = [];
  const pattern = /^(export\s+)?(?:async\s+)?function\s+(\w+)/gm;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const end = code.indexOf('\n}', match.index);
    found.push({
      name: match[2],
      exported: Boolean(match[1]),
      start: match.index,
      end: end === -1 ? code.length : end + 2,
    });
  }
  return found;
}

/** `file -> { entryPoints: Set<string>, outside: boolean }` for a file that sends requests. */
function networkEntryPoints(code) {
  const functions = topLevelFunctions(code);
  const regionOf = (fn) => code.slice(fn.start, fn.end);
  const reaching = new Set(functions.filter((fn) => /\bfetch\s*\(/.test(regionOf(fn))).map((fn) => fn.name));
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of functions) {
      if (reaching.has(fn.name)) {
        continue;
      }
      const region = regionOf(fn);
      if ([...reaching].some((name) => name !== fn.name && new RegExp(`\\b${name}\\b`).test(region))) {
        reaching.add(fn.name);
        grew = true;
      }
    }
  }
  // A fetch that no top-level function contains (a hook, a class, a module body).
  let inside = 0;
  for (const fn of functions) {
    inside += (regionOf(fn).match(/\bfetch\s*\(/g) ?? []).length;
  }
  const total = (code.match(/\bfetch\s*\(/g) ?? []).length;
  return {
    entryPoints: new Set(functions.filter((fn) => fn.exported && reaching.has(fn.name)).map((fn) => fn.name)),
    outside: total > inside,
  };
}

/** The text inside the parentheses of every `opener(` call, e.g. each useEffect callback. */
function callArguments(code, opener) {
  const regions = [];
  let from = 0;
  for (;;) {
    const at = code.indexOf(opener, from);
    if (at === -1) {
      return regions;
    }
    let depth = 0;
    let end = code.length;
    for (let index = at + opener.length - 1; index < code.length; index += 1) {
      if (code[index] === '(') {
        depth += 1;
      } else if (code[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    regions.push(code.slice(at, end));
    from = at + opener.length;
  }
}

const OTHER_NETWORK = /\b(XMLHttpRequest|sendBeacon|WebSocket|EventSource|axios|downloadAsync|uploadAsync|createDownloadResumable|createUploadTask)\b/;
const SERVER_URL_VARIABLES = /EXPO_PUBLIC_(AI_COACH_API|BACKUP_API|ANALYTICS)_URL/;
const LOOP_PATTERNS = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*(true|1)\s*\)/,
  /\bfor\s*\(\s*;\s*;\s*\)/,
  /\bfor\s*\([^;()]*;\s*;/,
];

const HOW_TO_STATE = 'State its bound in tests/lib/serverCallsAreBounded.test.cjs (ENTRY_POINTS): what triggers it, and what stops it from running again and again';

/** Every problem the tree has; empty when every server call is bounded and the bound is still in the code. */
function check(files) {
  const problems = [];
  const code = {};
  for (const [file, text] of Object.entries(files)) {
    code[file] = stripComments(text);
  }

  // The entries are well formed.
  for (const [key, entry] of Object.entries(ENTRY_POINTS)) {
    const callers = Array.isArray(entry.callers) ? entry.callers : [];
    const stated = [{ label: key, trigger: entry.trigger, bounds: entry.bounds }, ...callers.map((c) => ({ label: `${key} <- ${c.file}`, trigger: c.trigger, bounds: c.bounds, automatic: c.automatic }))];
    for (const item of stated) {
      if (typeof item.trigger !== 'string' || item.trigger.trim().length < 10) {
        problems.push(`${item.label}: no trigger stated`);
      }
      if (!Array.isArray(item.bounds) || item.bounds.length === 0) {
        problems.push(`${item.label}: no bound stated`);
        continue;
      }
      for (const bound of item.bounds) {
        if (!(bound in BOUND_KINDS)) {
          problems.push(`${item.label}: "${bound}" is not one of ${Object.keys(BOUND_KINDS).join(', ')}`);
        }
      }
      if (!item.bounds.includes('user-action') && !item.bounds.some((bound) => RATE_BOUNDS.includes(bound))) {
        problems.push(`${item.label}: starts without a tap but states no rate bound (${RATE_BOUNDS.join(', ')})`);
      }
    }
  }

  // 1. Every place that sends a request is on the list.
  const requestFiles = Object.keys(code).filter((file) => /\bfetch\s*\(/.test(code[file]));
  const computed = new Map();
  for (const file of requestFiles) {
    const found = networkEntryPoints(code[file]);
    computed.set(file, found);
    if (found.outside) {
      problems.push(`${file} sends a request outside any top-level function (a hook, a class, module scope). ${HOW_TO_STATE}.`);
    }
    for (const name of found.entryPoints) {
      if (!(`${file}#${name}` in ENTRY_POINTS)) {
        problems.push(`${file} exports \`${name}\`, which sends a request to our server and is not on the list. ${HOW_TO_STATE}.`);
      }
    }
    if (found.entryPoints.size === 0 && !found.outside) {
      problems.push(`${file} sends a request from a function that is not exported or reached by one. ${HOW_TO_STATE}.`);
    }
  }
  for (const key of Object.keys(ENTRY_POINTS)) {
    const [file, name] = key.split('#');
    if (!computed.get(file)?.entryPoints.has(name)) {
      problems.push(`${key} is on the list but no longer sends a request (renamed, moved or deleted). Remove or update the entry.`);
    }
  }
  for (const [file, text] of Object.entries(code)) {
    if (OTHER_NETWORK.test(text)) {
      problems.push(`${file} uses a network primitive other than fetch. ${HOW_TO_STATE}.`);
    }
    if (SERVER_URL_VARIABLES.test(text) && !requestFiles.includes(file)) {
      problems.push(`${file} reads a server address from the environment but sends nothing itself. ${HOW_TO_STATE}.`);
    }
  }

  // 2. Every direct caller of a request function is on the list, with its bound.
  for (const [key, entry] of Object.entries(ENTRY_POINTS)) {
    if (!Array.isArray(entry.callers)) {
      continue;
    }
    const [definedIn, name] = key.split('#');
    const reference = new RegExp(`\\b${name}\\b`);
    const referencing = Object.keys(code).filter((file) => file !== definedIn && reference.test(code[file]));
    const listed = entry.callers.map((caller) => caller.file);
    for (const file of referencing) {
      if (!listed.includes(file)) {
        problems.push(`${file} calls \`${name}\` (${definedIn}) and is not on the list. ${HOW_TO_STATE}.`);
      }
    }
    for (const file of listed) {
      if (!referencing.includes(file)) {
        problems.push(`${file} is listed as a caller of \`${name}\` but no longer names it. Remove or update the entry.`);
      }
    }

    // A request made straight from an effect, an interval or a timer is the
    // classic loop: the effect runs again whenever its dependencies change.
    for (const caller of entry.callers) {
      if (caller.automatic || !code[caller.file]) {
        continue;
      }
      for (const opener of ['useEffect(', 'useLayoutEffect(', 'setInterval(', 'setTimeout(']) {
        if (callArguments(code[caller.file], opener).some((region) => reference.test(region))) {
          problems.push(
            `${caller.file} calls \`${name}\` from inside ${opener.slice(0, -1)}. Mark the caller \`automatic: true\` and list the guard that bounds how often it runs.`,
          );
        }
      }
    }
  }

  // 3. The bound each entry states is still in the code.
  const guards = [];
  for (const [key, entry] of Object.entries(ENTRY_POINTS)) {
    guards.push(...(entry.guards ?? []).map((guard) => ({ ...guard, owner: key })));
    for (const caller of Array.isArray(entry.callers) ? entry.callers : []) {
      guards.push(...(caller.guards ?? []).map((guard) => ({ ...guard, owner: `${key} <- ${caller.file}` })));
    }
  }
  for (const guard of guards) {
    if (!code[guard.file]) {
      problems.push(`${guard.owner}: the bound lives in ${guard.file}, which is gone.`);
    } else if (!code[guard.file].includes(guard.text)) {
      problems.push(`${guard.owner}: \`${guard.text}\` is no longer in ${guard.file} (outside comments). The bound it states is gone, or the entry is stale.`);
    }
  }
  for (const entry of Object.values(ENTRY_POINTS)) {
    for (const caller of Array.isArray(entry.callers) ? entry.callers : []) {
      if (caller.automatic && (caller.guards ?? []).length === 0 && !caller.bounds.includes('user-action')) {
        problems.push(`${caller.file}: an automatic caller must list the code that bounds it (guards).`);
      }
    }
  }

  // 4. No loop without a bound in its header in a file that talks to the server.
  const watched = new Set(requestFiles);
  for (const entry of Object.values(ENTRY_POINTS)) {
    for (const caller of Array.isArray(entry.callers) ? entry.callers : []) {
      if (caller.automatic) {
        watched.add(caller.file);
      }
    }
  }
  for (const file of watched) {
    if (!code[file]) {
      continue;
    }
    let found = 0;
    for (const pattern of LOOP_PATTERNS) {
      found += (code[file].match(new RegExp(pattern.source, 'g')) ?? []).length;
    }
    const allowed = UNBOUNDED_LOOPS[file] ?? [];
    if (found !== allowed.length) {
      problems.push(
        `${file} has ${found} loop construct(s) with no bound in their header (setInterval, while (true), for (;;)); ${allowed.length} stated. A loop in a file that sends requests must say what stops it (UNBOUNDED_LOOPS).`,
      );
    }
    for (const loop of allowed) {
      if (!code[file].includes(loop.marker)) {
        problems.push(`${file}: the bound of "${loop.what}" (\`${loop.marker}\`) is gone.`);
      }
    }
  }

  return problems;
}

const realTree = readTree();

function without(files, file, text) {
  assert.ok(files[file].includes(text), `the mutation target "${text}" is not in ${file}`);
  return { ...files, [file]: files[file].split(text).join('/* removed */') };
}

module.exports = [
  {
    name: 'server calls: every request to our server is on the list with its trigger and its bound, and the bound is still in the code',
    run() {
      assert.deepEqual(check(realTree), []);
    },
  },
  {
    name: 'server calls: the list is the whole of it - every client function that sends a request is accounted for',
    run() {
      const keys = Object.keys(ENTRY_POINTS).sort();
      assert.deepEqual(
        keys.map((key) => key.split('#')[0]).filter((file, index, all) => all.indexOf(file) === index),
        [
          'src/features/account/backupApi.ts',
          'src/features/analytics/analyticsClient.ts',
          'src/features/serverNotice/serverNoticeClient.ts',
          'src/lib/aiCoachClient.ts',
        ],
        'a new client file means a new set of server calls: state each in ENTRY_POINTS',
      );
      assert.ok(keys.length >= 13);
    },
  },
  {
    name: 'server calls (mutation): a new unlisted call site fails the check and the message asks for its bound',
    run() {
      const planted = {
        ...realTree,
        'src/screens/RunawayScreen.tsx': [
          "import { useEffect } from 'react';",
          'export function ping() {',
          "  return fetch('https://api.vinha.app/anything');",
          '}',
          '',
        ].join('\n'),
      };
      const problems = check(planted);
      assert.ok(problems.length > 0, 'an unlisted fetch passed');
      assert.ok(problems.some((p) => p.includes('src/screens/RunawayScreen.tsx') && p.includes('State its bound')), problems.join('\n'));

      // A fetch inside a hook (no top-level function) is caught as well.
      const inHook = {
        ...realTree,
        'src/hooks/useRunaway.ts': ['export const useRunaway = () => {', "  void fetch('/x');", '};', ''].join('\n'),
      };
      assert.ok(check(inHook).some((p) => p.includes('src/hooks/useRunaway.ts')), 'a fetch outside a function passed');

      // And other ways of reaching the network.
      const xhr = { ...realTree, 'src/lib/beacon.ts': 'export const x = () => navigator.sendBeacon("/e");\n' };
      assert.ok(check(xhr).some((p) => p.includes('src/lib/beacon.ts')), 'a beacon passed');
    },
  },
  {
    name: 'server calls (mutation): mentions in comments and strings of prose are not call sites',
    run() {
      const prose = {
        ...realTree,
        'src/lib/notes.ts': ['// we used to fetch(url) here', '/* fetch(other) */', 'export const note = 1;', ''].join('\n'),
      };
      assert.deepEqual(check(prose), []);
    },
  },
  {
    name: 'server calls (mutation): a new caller of a request function that is not on the list fails',
    run() {
      const planted = {
        ...realTree,
        'src/screens/NewCoachScreen.tsx': [
          "import { requestAiCoachAdvice } from '../lib/aiCoachClient';",
          'export function Ask() {',
          '  return requestAiCoachAdvice({ prompt: "hi" });',
          '}',
          '',
        ].join('\n'),
      };
      const problems = check(planted);
      assert.ok(problems.some((p) => p.includes('src/screens/NewCoachScreen.tsx') && p.includes('requestAiCoachAdvice') && p.includes('State its bound')), problems.join('\n'));
    },
  },
  {
    name: 'server calls (mutation): a request made straight from an effect, an interval or a timer fails unless the caller is acknowledged as automatic',
    run() {
      for (const opener of ['useEffect', 'setInterval', 'setTimeout']) {
        const planted = {
          ...realTree,
          'src/app/renderHomeScreens.tsx': `${realTree['src/app/renderHomeScreens.tsx']}\n${opener}(() => { void requestProgrammeComposition({}); }, [x]);\n`,
        };
        const problems = check(planted);
        assert.ok(
          problems.some((p) => p.includes('src/app/renderHomeScreens.tsx') && p.includes(`inside ${opener}`)),
          `${opener}: ${problems.join('\n')}`,
        );
      }
    },
  },
  {
    name: 'server calls (mutation): taking a stated bound out of the code fails the check',
    run() {
      const removals = [
        ['src/features/analytics/analyticsClient.ts', 'pacingWaitMs(pacing'],
        ['src/features/analytics/analyticsClient.ts', 'if (flushTimer)'],
        ['src/features/account/useAccountBackup.ts', 'pacingWaitMs(backupPacingRef.current'],
        ['src/features/account/useAccountBackup.ts', 'if (attempt > 0)'],
        ['src/hooks/usePendingAiLogDeletions.ts', 'pacingWaitMs(pacingRef.current'],
        ['src/features/serverNotice/ServerNoticeDialog.tsx', 'shouldCheckServerNotice('],
        ['src/features/serverNotice/ServerNoticeDialog.tsx', 'inFlightRef.current'],
        ['src/lib/aiLogDeletion.ts', 'inFlight.get(logId)'],
        ['src/components/CoachReportSheet.tsx', 'sendingRef.current'],
        ['src/screens/AICoachChatScreen.tsx', 'demoSent.current'],
      ];
      for (const [file, text] of removals) {
        const problems = check(without(realTree, file, text));
        assert.ok(problems.some((p) => p.includes(text)), `removing \`${text}\` from ${file} passed`);
      }
    },
  },
  {
    name: 'server calls (mutation): a guard that only survives in a comment does not count',
    run() {
      const file = 'src/features/analytics/analyticsClient.ts';
      const commentedOut = {
        ...realTree,
        [file]: realTree[file].split('pacingWaitMs(pacing').join('// pacingWaitMs(pacing'),
      };
      assert.ok(check(commentedOut).some((p) => p.includes('pacingWaitMs(pacing')), 'a commented-out guard passed');
    },
  },
  {
    name: 'server calls (mutation): a loop with no bound in the files that send requests fails',
    run() {
      for (const [file, loop] of [
        ['src/features/account/useAccountBackup.ts', 'setInterval(() => lookRef.current(), 1000);'],
        ['src/features/analytics/analyticsClient.ts', 'while (true) { void flush(); }'],
        ['src/features/serverNotice/ServerNoticeDialog.tsx', 'for (;;) { void check(); }'],
      ]) {
        const problems = check({ ...realTree, [file]: `${realTree[file]}\n${loop}\n` });
        assert.ok(problems.some((p) => p.includes(file) && p.includes('loop construct')), `${file}: ${problems.join('\n')}`);
      }
      // And the one stated loop losing its stated bound.
      const problems = check(without(realTree, 'src/features/account/useAccountBackup.ts', 'if (attempt > 0)'));
      assert.ok(problems.some((p) => p.includes('uploadCurrent')), problems.join('\n'));
    },
  },
  {
    name: 'server calls (mutation): an entry for code that is gone is reported, not silently kept',
    run() {
      const renamed = {
        ...realTree,
        'src/features/serverNotice/serverNoticeClient.ts': realTree['src/features/serverNotice/serverNoticeClient.ts']
          .split('fetchServerNotice')
          .join('fetchTheNotice'),
      };
      const problems = check(renamed);
      assert.ok(problems.some((p) => p.includes('fetchServerNotice') && p.includes('no longer')), problems.join('\n'));
      assert.ok(problems.some((p) => p.includes('fetchTheNotice') && p.includes('State its bound')), problems.join('\n'));
    },
  },
];
