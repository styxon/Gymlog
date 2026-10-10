const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildRecoverySheet,
  dayStartPlus,
  formatLoadKg,
  isLightenPending,
  lightenedFatigueSignal,
  lightenRuntimeTemplate,
  normalizeLightNextSession,
  normalizeRestDayStarts,
  pruneRestDays,
  recoveryWeek,
  withoutRestDay,
  withRestDay,
} = require('../../.test-dist/lib/recoverySheet.js');
const {
  sessionSlotOn,
  trainsOn,
  weekdaySchedule,
  cycleSchedule,
  withRestDays,
} = require('../../.test-dist/lib/trainingSchedule.js');
const { resolveReminderSchedule } = require('../../.test-dist/lib/reminderSchedule.js');
const { setNumberLanguage } = require('../../.test-dist/lib/format.js');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');

function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

// A Saturday noon, local — the tests reason in the reader's own calendar.
const NOW = new Date(2026, 8, 26, 12, 0, 0);

function fatigue(overrides = {}) {
  return {
    acuteLoadKg: 18400,
    chronicLoadKg: 17500,
    acwr: 1.05,
    recoveryScore: 96,
    signal: 'optimal',
    sessionCount7d: 4,
    sessionCount28d: 14,
    confident: true,
    ...overrides,
  };
}

function sheet(overrides = {}, fatigueOverrides = {}) {
  return buildRecoverySheet({
    fatigue: fatigue(fatigueOverrides),
    sessionDates: [],
    now: NOW,
    nextSessionTitle: 'Push A',
    automatedProgression: true,
    proUnlocked: true,
    tomorrowTrains: true,
    restTomorrowMarked: false,
    lightenQueued: false,
    language: 'fi',
    ...overrides,
  });
}

/**
 * The recovery sheet (design: GAINER Palautuminen Sheet, 2026-09-26). Every
 * number from the fatigue model, every sentence true of what the app does,
 * and the two actions — lighter next session, rest tomorrow — real.
 */
module.exports = [
  {
    name: 'recovery sheet: no sheet without a confident model, as there is no row',
    run() {
      assert.equal(sheet({}, { confident: false }), null);
    },
  },
  {
    name: 'recovery sheet: the tone, the status and the lead follow the model — a light week says so',
    run() {
      const green = sheet();
      assert.equal(green.tone, 'green');
      assert.equal(green.status, 'Kunnossa');
      assert.match(green.lead, /linjassa tavallisen viikkosi/);

      // "undertrained" is green, but "in line with your usual week" would be
      // false of it.
      const light = sheet({}, { signal: 'undertrained', acwr: 0.62, recoveryScore: 50 });
      assert.equal(light.tone, 'green');
      assert.match(light.lead, /noin 38 % kevyempi/);
      assert.doesNotMatch(light.lead, /linjassa/);

      const amber = sheet({}, { signal: 'elevated', acwr: 1.38, recoveryScore: 64 });
      assert.equal(amber.tone, 'amber');
      assert.equal(amber.status, 'Koholla');
      assert.match(amber.lead, /noin 38 % raskaampi/);

      const red = sheet({}, { signal: 'high', acwr: 1.62, recoveryScore: 44 });
      assert.equal(red.tone, 'red');
      assert.equal(red.status, 'Vähissä');
      assert.match(red.lead, /62 % yli tavallisen/);
      assert.equal(red.score, 44);
    },
  },
  {
    /**
     * Found by the adversarial pass on #188 (2026-09-26): each read wrong to a
     * real reader.
     */
    name: 'recovery sheet: a week off, a light week, a huge week, and a rest day already taken read true',
    run() {
      // Nothing in seven days is a week off, not "100 % lighter".
      const off = sheet({}, { signal: 'undertrained', acwr: 0, acuteLoadKg: 0, sessionCount7d: 0, recoveryScore: 50 });
      assert.match(off.lead, /ei ole kirjattu treenejä/);
      assert.doesNotMatch(off.lead, /100 %/);
      // A light week carries no score: "Kunnossa 20/100" said two things.
      assert.equal(off.score, null);
      assert.equal(sheet({}, { signal: 'undertrained', acwr: 0.25, recoveryScore: 20, sessionCount7d: 1 }).score, null);
      assert.equal(sheet().score, 96, 'an ordinary week keeps its score');
      // Past double the usual, a multiple — not "15900 % over".
      setNumberLanguage('fi');
      try {
        const huge = sheet({}, { signal: 'high', acwr: 160, recoveryScore: 0 });
        assert.match(huge.lead, /160,0-kertainen/);
        assert.doesNotMatch(huge.lead, /%/);
        assert.match(sheet({}, { signal: 'high', acwr: 1.62 }).lead, /62 % yli/);
      } finally {
        setNumberLanguage('en');
      }
      // Tomorrow already made a rest day: the advice is to keep it, and no
      // button offers it again.
      const marked = sheet({ tomorrowTrains: true, restTomorrowMarked: true }, { signal: 'high', acwr: 1.62 });
      assert.match(marked.todos[0], /lepopäivä lepona/);
      assert.ok(![marked.primary.kind, marked.secondary?.kind].includes('restTomorrow'));
      const open = sheet({ tomorrowTrains: true, restTomorrowMarked: false }, { signal: 'high', acwr: 1.62 });
      assert.equal(open.todos[0], 'Pidä huomenna lepopäivä');
      // English percentages without the Finnish space.
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.doesNotMatch(i18n, /'recovery\.lead\.[a-z]+': '[^']*\{pct\} % (lighter|heavier|over)/);
    },
  },
  {
    name: 'recovery sheet: the buttons are the actions that apply, and none that would do nothing',
    run() {
      const green = sheet();
      assert.equal(green.primary.kind, 'close');
      assert.equal(green.secondary, null);

      const amber = sheet({}, { signal: 'elevated', acwr: 1.38 });
      assert.deepEqual([amber.primary.kind, amber.secondary.kind], ['lighten', 'close']);
      assert.equal(amber.secondary.label, 'Pidä suunnitelma');
      const amberDone = sheet({ lightenQueued: true }, { signal: 'elevated', acwr: 1.38 });
      assert.equal(amberDone.primary.kind, 'close', 'lightening twice is not an action');
      assert.equal(amberDone.secondary, null);

      const high = { signal: 'high', acwr: 1.62 };
      const red = sheet({}, high);
      assert.deepEqual([red.primary.kind, red.secondary.kind], ['restTomorrow', 'lighten']);
      // Tomorrow was going to be rest anyway: no button to make it so.
      const redRestDay = sheet({ tomorrowTrains: false }, high);
      assert.equal(redRestDay.primary.kind, 'lighten');
      assert.equal(redRestDay.secondary, null);
      assert.match(redRestDay.todos[0], /lepopäivä lepona/);
      const redMarked = sheet({ restTomorrowMarked: true }, high);
      assert.equal(redMarked.primary.kind, 'lighten');
      assert.ok(redMarked.restTomorrowMarked);
      const redAllDone = sheet({ restTomorrowMarked: true, lightenQueued: true }, high);
      assert.equal(redAllDone.primary.kind, 'close');
    },
  },
  {
    name: 'recovery sheet: advice and actions are Pro\'s, and green is free in full',
    run() {
      assert.equal(sheet({ proUnlocked: false }).locked, false);
      assert.equal(sheet({ proUnlocked: false }, { signal: 'elevated', acwr: 1.38 }).locked, true);
      assert.equal(sheet({ proUnlocked: false }, { signal: 'high', acwr: 1.62 }).locked, true);
      assert.equal(sheet({ proUnlocked: true }, { signal: 'high', acwr: 1.62 }).locked, false);
    },
  },
  {
    name: 'recovery sheet: the green list says progression stays on only when it is on',
    run() {
      assert.ok(sheet().todos.includes('Automaattinen progressio pysyy päällä'));
      assert.ok(!sheet({ automatedProgression: false }).todos.some((line) => /progressio/i.test(line)));
      assert.match(sheet().todos[0], /seuraavana Push A/);
      assert.equal(sheet({ nextSessionTitle: null }).todos[0], 'Jatka suunnitelman mukaan');
      // "About 30 % lighter" was the design's; one set fewer is what the
      // button does, so that is what the sheet says.
      assert.ok(!sheet({}, { signal: 'high', acwr: 1.62 }).todos.some((line) => /30 %/.test(line)));
    },
  },
  {
    name: 'recovery sheet: the numbers read the reader\'s way — comma, thin thousands, a marker kept on the bar',
    run() {
      setNumberLanguage('fi');
      try {
        assert.equal(sheet({}, { acwr: 1.05 }).acwrLabel, '1,05');
        assert.equal(sheet({}, { acwr: 1.3 }).acwrLabel, '1,30');
      } finally {
        setNumberLanguage('en');
      }
      assert.equal(formatLoadKg(18400), '18 400 kg');
      assert.equal(formatLoadKg(950), '950 kg');
      assert.equal(formatLoadKg(1234567), '1 234 567 kg');
      assert.equal(sheet({}, { acwr: 1.25 }).markerPercent, 50);
      assert.equal(sheet({}, { acwr: 0.1 }).markerPercent, 2);
      assert.equal(sheet({}, { acwr: 3.4 }).markerPercent, 98);
    },
  },
  {
    name: 'recovery sheet: the week strip is the last seven calendar days, today last, trained days marked',
    run() {
      const trainedFriday = new Date(2026, 8, 25, 18, 30).toISOString();
      const trainedMonday = new Date(2026, 8, 21, 7, 0).toISOString();
      const tooOld = new Date(2026, 8, 19, 7, 0).toISOString();
      const week = recoveryWeek([trainedFriday, trainedMonday, tooOld], NOW, 'fi');
      assert.equal(week.length, 7);
      assert.deepEqual(week.map((day) => day.label), ['Su', 'Ma', 'Ti', 'Ke', 'To', 'Pe', 'La']);
      assert.deepEqual(week.map((day) => day.trained), [false, true, false, false, false, true, false]);
      assert.ok(week[6].today && !week[5].today);
      // Local midnights, stepped by calendar date — across the October clock
      // change the days stay whole.
      const afterDst = recoveryWeek([], new Date(2026, 9, 27, 12), 'fi');
      for (const day of afterDst) {
        const date = new Date(day.dayStart);
        assert.equal(date.getHours(), 0, date.toString());
      }
    },
  },
  {
    name: 'lighter next session: one set fewer on each lift with one to spare, and loads held',
    run() {
      const template = {
        id: 't',
        sessions: [
          {
            id: 's',
            exercises: [
              { slotId: 'a', exerciseName: 'Squat', sets: 4 },
              { slotId: 'b', exerciseName: 'Curl', sets: 1 },
              { slotId: 'c', exerciseName: 'Row', sets: 2 },
            ],
          },
        ],
      };
      const light = lightenRuntimeTemplate(template);
      assert.deepEqual(light.sessions[0].exercises.map((exercise) => [exercise.slotId, exercise.sets]), [
        ['a', 3],
        ['b', 1],
        ['c', 1],
      ]);
      assert.equal(template.sessions[0].exercises[0].sets, 4, 'the programme itself is not touched');
      assert.equal(lightenedFatigueSignal('normal'), 'elevated');
      assert.equal(lightenedFatigueSignal('elevated'), 'elevated');
      assert.equal(lightenedFatigueSignal('high'), 'high');
    },
  },
  {
    name: 'lighter next session: asked within the week, and a stored request is trusted only whole',
    run() {
      assert.equal(isLightenPending(null, NOW), false);
      assert.equal(isLightenPending({ requestedAt: new Date(2026, 8, 24, 9).toISOString() }, NOW), true);
      assert.equal(isLightenPending({ requestedAt: new Date(2026, 8, 20, 9).toISOString() }, NOW), true);
      assert.equal(isLightenPending({ requestedAt: new Date(2026, 8, 19, 9).toISOString() }, NOW), false, 'a week old');
      assert.equal(isLightenPending({ requestedAt: 'yesterday' }, NOW), false);
      assert.deepEqual(normalizeLightNextSession({ requestedAt: '2026-09-26T09:00:00.000Z' }), {
        requestedAt: '2026-09-26T09:00:00.000Z',
      });
      for (const bad of [null, 'yes', {}, { requestedAt: 5 }, { requestedAt: 'nope' }]) {
        assert.equal(normalizeLightNextSession(bad), null, JSON.stringify(bad));
      }
    },
  },
  {
    name: 'rest tomorrow: a day off in every calendar, kept long enough not to turn into a missed day',
    run() {
      const tomorrow = dayStartPlus(NOW, 1);
      assert.equal(new Date(tomorrow).getDate(), 27);
      const rest = withRestDay([], tomorrow, NOW);
      assert.deepEqual(rest, [tomorrow]);
      assert.deepEqual(withRestDay(rest, tomorrow, NOW), [tomorrow], 'no duplicates');
      assert.deepEqual(withoutRestDay(rest, tomorrow, NOW), []);
      // Passed rest days stay for a while — Progress marks a past training day
      // with no session as missed — and go after sixty days.
      const yesterday = dayStartPlus(NOW, -1);
      const longAgo = dayStartPlus(NOW, -61);
      assert.deepEqual(pruneRestDays([longAgo, yesterday, tomorrow], NOW), [yesterday, tomorrow]);
      assert.deepEqual(normalizeRestDayStarts([tomorrow, 'x', NaN, tomorrow, yesterday]), [yesterday, tomorrow]);
      assert.deepEqual(normalizeRestDayStarts('nope'), []);

      // Saturday rest: a Mon–Sat rhythm does not train on it, and nothing else
      // moves.
      const everyDay = weekdaySchedule([0, 1, 2, 3, 4, 5, 6]);
      const withRest = withRestDays(everyDay, [tomorrow]);
      assert.equal(trainsOn(everyDay, new Date(tomorrow)), true);
      assert.equal(trainsOn(withRest, new Date(tomorrow)), false);
      assert.equal(sessionSlotOn(withRest, new Date(tomorrow)), null);
      assert.equal(trainsOn(withRest, new Date(dayStartPlus(NOW, 2))), true);
      assert.equal(withRestDays(everyDay, []), everyDay, 'no rest days, no new object');
      const cycle = withRestDays(cycleSchedule([true, true, false], NOW), [tomorrow]);
      assert.equal(trainsOn(cycle, new Date(tomorrow)), false);
      assert.equal(trainsOn(cycle, NOW), true);

      // And the reminders read it too.
      const reminders = resolveReminderSchedule({
        trainingCycle: null,
        planEntries: [],
        availableDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        restDayStarts: [tomorrow],
      });
      assert.equal(trainsOn(reminders, new Date(tomorrow)), false);
    },
  },
  {
    name: 'recovery sheet: wired end to end — stored, normalised, applied at the start, confirmed after the write',
    run() {
      const database = read('src', 'storage', 'database.ts');
      assert.match(database, /restDayStarts: normalizeRestDayStarts\(input\?\.preferences\?\.restDayStarts\),/);
      assert.match(database, /lightNextSession: normalizeLightNextSession\(input\?\.preferences\?\.lightNextSession\),/);

      const app = read('App.tsx');
      // The shell: App.tsx and the src/app modules its blocks moved into.
      const wiring = readAppWiring().split('\r\n').join('\n');
      // Every calendar reads one schedule, with the rest days in it; "would
      // tomorrow have trained" asks the one without.
      assert.match(wiring, /withRestDays\(baseTrainingSchedule, preferences\.restDayStarts\)/);
      assert.match(wiring, /tomorrowTrains: trainsOn\(baseTrainingSchedule, tomorrow\),/);
      // Both programme starts go through the one door that applies and spends
      // a lighter session — counted across the whole shell, so a start added
      // in a src/app module cannot bypass it either.
      assert.equal(wiring.split('startProgrammeWorkout(runtimeTemplate, ').length - 1, 2);
      assert.equal(wiring.split('workout.startCustomWorkout(').length - 1, 1, 'a start bypasses the lighter session');
      // Over the shell: the door and programmeStart move to src/app in phase C
      // (2026-10-01), still at two spaces, so each still ends at its own brace.
      const door = between(wiring, 'function startProgrammeWorkout(', '\n  }\n');
      // The lightening lives in programmeStart, which the door and the
      // coach's preview of the next session both use (2026-09-27).
      assert.match(door, /const start = programmeStart\(runtimeTemplate\);\s*workout\.startCustomWorkout\(start\.template, unit, start\.options\);/);
      const start = between(wiring, 'function programmeStart(', '\n  }\n');
      // Recovery as of the start's own clock, not the memo (hunt 11), and the
      // lightening, both in lib/recoverySheet resolveProgrammeStart.
      assert.match(start, /resolveProgrammeStart\(runtimeTemplate, lighten, database, now\)/);
      assert.match(start, /fatigueSignal: start\.fatigueSignal,/);
      assert.match(door, /updatePreferences\(\{ lightNextSession: null \}\)\.catch\(/, 'a refused spend is swallowed');
      assert.match(door, /'recovery\.toast\.spendFailed'/);
      assert.doesNotMatch(door, /void updatePreferences\(\{ lightNextSession: null \}\)/);
      // Done is said after the write.
      const action = between(wiring, 'async function handleRecoveryAction(', '\n  }\n');
      const lightenWrite = action.indexOf('await updatePreferences({ lightNextSession');
      // Functional since #bugs 2026-10-01: written from the stored list.
      const restWrite = action.indexOf('await updatePreferences((current) => ({\n        restDayStarts');
      assert.ok(lightenWrite >= 0, 'the lighten write is not awaited');
      assert.ok(restWrite >= 0, 'the rest-day write is not awaited');
      assert.ok(action.indexOf("'recovery.toast.lighten'") > lightenWrite);
      assert.ok(action.indexOf("'recovery.toast.rest'") > restWrite);
      assert.match(action, /catch \(error\)[\s\S]*'recovery\.toast\.failed'/);

      // The notification hook passes the rest days on.
      assert.match(read('src', 'hooks', 'useScheduledNotifications.ts'), /restDayStarts: database\.preferences\.restDayStarts,/);

      // The row is the door, with a chevron, and its answer is in the sheet.
      const screen = read('src', 'screens', 'ProgressScreen.tsx');
      assert.match(screen, /const recoveryDoor = row\.key === 'recovery' && Boolean\(recoverySheet\);/);
      assert.match(screen, /recoveryDoor \? setRecoveryOpen\(true\) : setSetLogTarget/);
      assert.match(screen, /\{row\.locked && !recoveryDoor \? \(/);
      assert.match(screen, /<RecoverySheet\s/);
    },
  },
  {
    // "jotkut buttonin värit oli vääriä" (user, 2026-09-26): the design's
    // black primary button is ink, not an action. Here the action colour.
    name: 'recovery sheet: the buttons wear this app\'s colours, on the sheet kit',
    run() {
      const component = read('src', 'components', 'RecoverySheet.tsx');
      assert.match(component, /<KitSheet/);
      // The content scrolls inside the kit's height cap rather than running
      // past it: on a short phone the buttons are the part that fell off.
      assert.match(component, /scroll: \{ flexGrow: 0, flexShrink: 1 \}/);
      assert.match(component, /primary: \{[\s\S]*?backgroundColor: theme\.highlight,/);
      assert.match(component, /primaryText: \{ color: theme\.onHighlight,/);
      assert.doesNotMatch(component, /backgroundColor: theme\.ink/);
      assert.doesNotMatch(component, /#157A3A|#B45309|#B91C1C|#17131F/, 'a light-only hex from the mock');
      // Tones from the theme, so the dark theme gets its own.
      assert.match(component, /theme\.greenInk/);
      assert.match(component, /theme\.amberInk/);
      assert.match(component, /theme\.dangerSoft/);
    },
  },
  {
    name: 'recovery sheet: every string in both languages',
    run() {
      const i18n = read('src', 'lib', 'i18n.ts');
      const keys = [...read('src', 'lib', 'recoverySheet.ts').matchAll(/'(recovery\.[a-zA-Z.]+)'/g)].map((match) => match[1]);
      const componentKeys = [...read('src', 'components', 'RecoverySheet.tsx').matchAll(/'(recovery\.[a-zA-Z.]+)'/g)].map((match) => match[1]);
      const all = [...new Set([...keys, ...componentKeys, 'recovery.toast.lighten', 'recovery.toast.rest', 'recovery.toast.failed', 'recovery.toast.spendFailed', 'recovery.a11y.row'])];
      assert.ok(all.length > 30, `only ${all.length} keys found`);
      for (const key of all) {
        assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} needs EN and FI`);
      }
    },
  },
];
