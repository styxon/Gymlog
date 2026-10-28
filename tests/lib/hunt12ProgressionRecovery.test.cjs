const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const L = '../../src/lib/';
const { buildFatigueModel } = require(L + 'fatigueModel.js');
const { progressionFatigueSignalAt } = require(L + 'progressionGate.js');
const { buildRecoverySheet, isLightenDue, isLightenPending, resolveProgrammeStart } = require(L + 'recoverySheet.js');
const { t } = require(L + 'i18n.js');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');

function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

function session(id, date, totalVolumeKg) {
  return { id, workoutTemplateId: 'tpl', workoutNameSnapshot: 'Push', performedAt: date.toISOString(), totalVolumeKg };
}

/** The zones as the sheet draws them, read off the number it prints. */
function zoneOf(acwr) {
  if (acwr < 0.8) return 'undertrained';
  if (acwr <= 1.3) return 'optimal';
  if (acwr <= 1.5) return 'elevated';
  return 'high';
}

/**
 * Bug hunt 12 (2026-10-11), the recovery cluster: the sheet and the start
 * reading the same week the same way, and Pro's advice staying Pro's.
 */
module.exports = [
  {
    // A10-1 + A9-3
    name: 'hunt12 recovery: a Free reader\'s green sheet does not say automatic progression stays on',
    run() {
      const base = {
        fatigue: {
          acuteLoadKg: 9000,
          chronicLoadKg: 9000,
          acwr: 1,
          recoveryScore: 95,
          signal: 'optimal',
          sessionCount7d: 3,
          sessionCount28d: 12,
          confident: true,
        },
        sessionDates: [],
        now: new Date(2026, 9, 12, 12),
        nextSessionTitle: 'Push A',
        automatedProgression: true,
        tomorrowTrains: true,
        restTomorrowMarked: false,
        lightenQueued: false,
        language: 'en',
      };
      const line = t('en', 'recovery.todo.green.progression');
      const free = buildRecoverySheet({ ...base, proUnlocked: false });
      assert.equal(free.locked, false, 'green is free in full');
      assert.ok(!free.todos.includes(line), 'the gate is off for a Free reader');
      assert.ok(buildRecoverySheet({ ...base, proUnlocked: true }).todos.includes(line));
      assert.ok(!buildRecoverySheet({ ...base, proUnlocked: true, automatedProgression: false }).todos.includes(line));
    },
  },
  {
    name: 'hunt12 recovery: the sheet hook hands over progression as the gate resolves it, not the bare preference',
    run() {
      const hook = read('src', 'app', 'useRecoverySheet.ts');
      const memo = between(hook, 'const recoverySheet = useMemo(', '\n  ]);');
      assert.doesNotMatch(memo, /automatedProgression: preferences\.automatedProgressionEnabled,/);
      assert.match(memo, /automatedProgression: preferences\.automatedProgressionEnabled && coachProUnlocked,/);
      // A request the start will not honour is not shown as queued either.
      assert.match(memo, /lightenQueued: isLightenDue\(preferences, now\),/);
    },
  },
  {
    // A9-5
    name: 'hunt12 recovery: the fatigue model reads the same all day — 08:00 and 19:00 agree',
    run() {
      withHelsinkiClocks(() => {
        const sessions = [];
        // Mon/Wed/Fri 18:00 from Mon 14 Sep, 5000 kg, plus a 9000 kg Monday
        // morning a week before the read.
        for (let week = 0; week < 4; week++) {
          for (const day of [0, 2, 4]) {
            sessions.push(session(`s${week}${day}`, new Date(2026, 8, 14 + week * 7 + day, 18), 5000));
          }
        }
        sessions.push(session('big', new Date(2026, 9, 5, 10), 9000));
        const input = { workoutSessions: sessions, exerciseLogs: [] };
        const morning = new Date(2026, 9, 12, 8);
        const evening = new Date(2026, 9, 12, 19);
        assert.deepEqual(buildFatigueModel(input, evening), buildFatigueModel(input, morning));
        assert.equal(progressionFatigueSignalAt(input, evening), progressionFatigueSignalAt(input, morning));
      });
    },
  },
  {
    name: 'hunt12 recovery: the acute load counts the sessions the seven-day strip counts',
    run() {
      withHelsinkiClocks(() => {
        // Mondays 18:00, the last on 5 Oct; read Mon 12 Oct 09:00, six days and
        // fifteen hours later — the eighth calendar date back.
        const sessions = [0, 1, 2, 3].map((week) => session(`w${week}`, new Date(2026, 8, 14 + week * 7, 18), 5000));
        const model = buildFatigueModel({ workoutSessions: sessions, exerciseLogs: [] }, new Date(2026, 9, 12, 9));
        assert.equal(model.sessionCount7d, 0);
        assert.equal(model.acuteLoadKg, 0);
      });
    },
  },
  {
    name: 'hunt12 recovery: the fatigue windows open at local midnight across the 25 Oct clock change',
    run() {
      withHelsinkiClocks(() => {
        // Read Sat 31 Oct 12:00: the week is Sun 25 Oct .. Sat 31 Oct, and the
        // four weeks open on Sun 4 Oct. Both edges sit before the change at
        // 04:00 on the 25th, so stepping back by 24 h from Saturday's midnight
        // lands at 01:00 and drops the sessions just after midnight.
        const now = new Date(2026, 9, 31, 12);
        const sessions = [
          session('before28', new Date(2026, 9, 3, 23, 30), 7000),
          session('first28', new Date(2026, 9, 4, 0, 30), 3000),
          session('mid', new Date(2026, 9, 14, 18), 3000),
          session('before7', new Date(2026, 9, 24, 23, 30), 1000),
          session('first7', new Date(2026, 9, 25, 0, 30), 2000),
        ];
        const model = buildFatigueModel({ workoutSessions: sessions, exerciseLogs: [] }, now);
        assert.equal(model.sessionCount7d, 1);
        assert.equal(model.acuteLoadKg, 2000);
        assert.equal(model.sessionCount28d, 4);
      });
    },
  },
  {
    name: 'hunt12 recovery: any two reads on the same local day agree, every day around the clock change',
    run() {
      withHelsinkiClocks(() => {
        const sessions = [];
        // One session most days from 1 Sep to 10 Nov, at hours spread across
        // the day and loads that vary, so a moving edge would show.
        for (let day = 0; day < 71; day++) {
          if (day % 4 === 3) continue;
          const hour = [0, 6, 11, 17, 23][day % 5];
          sessions.push(session(`d${day}`, new Date(2026, 8, 1 + day, hour, 30), 2000 + ((day * 773) % 5000)));
        }
        for (let day = 0; day < 30; day++) {
          const dayStart = new Date(2026, 9, 10 + day);
          const before = sessions.filter((s) => Date.parse(s.performedAt) < dayStart.getTime());
          const input = { workoutSessions: before, exerciseLogs: [] };
          const early = new Date(2026, 9, 10 + day, 0, 1);
          const late = new Date(2026, 9, 10 + day, 23, 59);
          assert.deepEqual(
            buildFatigueModel(input, late),
            buildFatigueModel(input, early),
            `${dayStart.toDateString()} read differently at 00:01 and 23:59`,
          );
        }
      });
    },
  },
  {
    // A9-6
    name: 'hunt12 recovery: an ACWR shown as 1.30 is in the optimal zone, and label and zone never disagree',
    run() {
      withHelsinkiClocks(() => {
        const now = new Date(2026, 9, 30, 12);
        const chronic = [27, 21, 14, 10].map((back) => session(`c${back}`, new Date(2026, 9, 30 - back, 18), 1000));
        const at = (kg) =>
          buildFatigueModel(
            { workoutSessions: [...chronic, session('acute', new Date(2026, 9, 29, 18), kg)], exerciseLogs: [] },
            now,
          );
        const edge = at(1926);
        assert.equal(edge.acwr, 1.3);
        assert.equal(edge.signal, 'optimal');
        for (let kg = 0; kg <= 6000; kg += 1) {
          const model = at(kg);
          assert.equal(model.signal, zoneOf(model.acwr), `${kg} kg: ACWR ${model.acwr} read ${model.signal}`);
        }
      });
    },
  },
  {
    // A9-4
    name: 'hunt12 recovery: a lighter session asked for during the trial does not shorten a Free start',
    run() {
      const template = {
        id: 't',
        name: 'T',
        defaultScheduleMode: 'weekly',
        sessions: [
          {
            id: 'd',
            name: 'D',
            orderIndex: 0,
            exercises: [{ id: 'e', exerciseName: 'Bench Press', slotId: 'b', sets: 3, repsMin: 8, repsMax: 8 }],
          },
        ],
      };
      const input = { workoutSessions: [], exerciseLogs: [] };
      const now = new Date(2026, 9, 14, 18);
      const request = { requestedAt: new Date(2026, 9, 12, 20).toISOString() };
      const lapsed = { lightNextSession: request, proTrialUntil: new Date(2026, 9, 13, 12).toISOString() };
      const trial = { lightNextSession: request, proTrialUntil: new Date(2026, 9, 20, 12).toISOString() };
      assert.equal(isLightenPending(request, now), true, 'the request itself is still fresh');
      assert.equal(isLightenDue(lapsed, now), false);
      assert.equal(isLightenDue(trial, now), true);
      assert.equal(isLightenDue({ lightNextSession: null, proTrialUntil: trial.proTrialUntil }, now), false);

      const free = resolveProgrammeStart(template, isLightenDue(lapsed, now), input, now);
      assert.equal(free.template.sessions[0].exercises[0].sets, 3);
      assert.equal(free.fatigueSignal, 'normal');
      const pro = resolveProgrammeStart(template, isLightenDue(trial, now), input, now);
      assert.equal(pro.template.sessions[0].exercises[0].sets, 2);
      assert.equal(pro.fatigueSignal, 'elevated');
    },
  },
  {
    name: 'hunt12 recovery: the programme start decides the lighter session and the gate at one clock, Pro-gated',
    run() {
      const starts = read('src', 'app', 'programmeStarts.tsx');
      const start = between(starts, 'function programmeStart(', '\n  }\n');
      assert.match(start, /const lighten = isLightenDue\(preferences, now\);/);
      assert.doesNotMatch(start, /isLightenPending\(/);
      assert.match(start, /resolveProgressionOptions\(preferences, now\)/);
      assert.match(start, /resolveProgrammeStart\(runtimeTemplate, lighten, database, now\)/);
    },
  },
];
