const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const dist = (...parts) => require(path.join(root, '.test-dist', ...parts));
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const HOUR = 60 * 60 * 1000;

/**
 * Hunt 10 (2026-10-09), cardio, free workout and measurements: a cardio clock
 * left running, the free board's idle stretch and superset rests, the finish
 * card's rounding, the measure delta pill, one record entry per session and
 * one weigh-in per day on the milestone ladder.
 */
module.exports = [
  {
    name: 'hunt 10: a cardio clock left running for days asks for the real minutes instead of saving the gap',
    run() {
      const C = dist('lib', 'cardio.js');
      const start = Date.parse('2026-10-09T15:00:00Z');
      const monday = Date.parse('2026-10-12T06:00:00Z');
      const paused = C.pauseCardioSession(C.startCardioSession('run', start), monday);

      const asked = C.resolveCardioFinish(paused, monday);
      assert.equal(asked.needsMinutes, true);
      assert.equal(asked.durationSec, null, 'nothing is saved until the reader says how long it was');
      for (const text of ['', ' ', '0', 'abc', '1,5', '1441', '-5']) {
        assert.equal(C.resolveCardioFinish(paused, monday, text).durationSec, null, `"${text}" is no minute count`);
      }

      const answered = C.resolveCardioFinish(paused, monday, '30');
      assert.equal(answered.durationSec, 1800);
      assert.equal(answered.endedAt, new Date(start + 30 * 60 * 1000).toISOString(), 'the run ends 30 minutes after it started, not on Monday');

      // An ordinary run, and a long one inside the limit, are the clock's own reading.
      const ordinary = C.resolveCardioFinish(C.pauseCardioSession(C.startCardioSession('run', start), start + 45 * 60 * 1000), start + 50 * 60 * 1000);
      assert.deepEqual(
        { needs: ordinary.needsMinutes, sec: ordinary.durationSec, ended: ordinary.endedAt },
        { needs: false, sec: 2700, ended: new Date(start + 45 * 60 * 1000).toISOString() },
      );
      const longRide = C.resolveCardioFinish(C.pauseCardioSession(C.startCardioSession('cycle-out', start), start + 6 * HOUR), start + 6 * HOUR);
      assert.equal(longRide.needsMinutes, false);
      assert.equal(longRide.durationSec, 6 * 3600);
      // A typed answer never ends after now.
      const early = C.pauseCardioSession(C.startCardioSession('run', start), start + 9 * HOUR);
      assert.equal(C.resolveCardioFinish(early, start + 9 * HOUR, '1000').endedAt, new Date(start + 9 * HOUR).toISOString());

      assert.equal(C.parseCardioMinutes('90'), 90);
      assert.equal(C.parseCardioMinutes('1440'), 1440);
    },
  },
  {
    name: 'hunt 10: the cardio screen saves what resolveCardioFinish says and holds Complete until it has minutes',
    run() {
      const screen = read('src', 'screens', 'CardioScreen.tsx');
      assert.match(screen, /resolveCardioFinish\(activeCardio, nowMs, minutesText\)/);
      assert.match(screen, /if \(finish\.durationSec === null\) \{\s*return;/);
      assert.match(screen, /durationSec: finish\.durationSec,/);
      assert.doesNotMatch(screen, /getCardioElapsedMs\(activeCardio, nowMs\)/, 'the save no longer reads the raw clock');
      assert.match(screen, /finish\.needsMinutes \?/);
      assert.match(screen, /keyboardType="number-pad"/);
      const i18n = read('src', 'lib', 'i18n.ts');
      for (const key of ['cardio.clockLong', 'cardio.addMinutes']) {
        assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
      }
    },
  },
  {
    name: 'hunt 10: the finish card reads the week the way Progress does, rounded once over the seconds',
    run() {
      const C = dist('lib', 'cardio.js');
      const now = new Date('2026-10-08T12:00:00Z');
      const stored = [{ performedAt: '2026-10-07T08:00:00Z', durationSec: 1220 }];
      const onFinish = C.getWeekCardioMinutes([...stored, { performedAt: now.toISOString(), durationSec: 1220 }], now);
      assert.equal(onFinish, 41, 'two 20:20 runs are 40:40');
      assert.equal(C.getWeekCardioMinutes(stored, now) + Math.round(1220 / 60), 40, 'the old arithmetic read a minute short');
    },
  },
  {
    name: 'hunt 10: a free workout resumed after a long idle stretch carries on from where its clock stood',
    run() {
      const E = dist('lib', 'emptyWorkoutSession.js');
      const startedAtMs = Date.parse('2026-10-09T05:00:00Z');
      const savedAtMs = startedAtMs + 20 * 60 * 1000;

      // Reopened an hour later: the same stretch of work, nothing to take off.
      assert.equal(E.resolveFreestyleDraftStart({ startedAtMs, savedAtMs }, savedAtMs + HOUR), startedAtMs);
      // Reopened five hours later: the five hours are not training time.
      const reopen = savedAtMs + 5 * HOUR;
      const resumed = E.resolveFreestyleDraftStart({ startedAtMs, savedAtMs }, reopen);
      assert.equal(reopen - resumed, 20 * 60 * 1000, 'the clock reads the 20 minutes it had');
      // One set a minute after reopening, then Finish.
      const lastEdit = reopen + 60 * 1000;
      const lastEditSeed = E.resolveFreestyleLastEdit({ startedAtMs, savedAtMs }, resumed, reopen);
      assert.equal(lastEditSeed, reopen, 'the gap is already off, so the last edit is now and not the old save');
      const finish = E.resolveFreestyleFinish({ startedAtMs: resumed, lastEditMs: lastEdit, nowMs: lastEdit + 30 * 1000 });
      assert.equal(Math.round(finish.elapsedSeconds / 60), 22, 'about 21 minutes of work and the minute and a half after');

      // The same rule on a board that stays open: a touch after hours of nothing.
      assert.equal(E.skipFreestyleIdle(startedAtMs, startedAtMs + 20 * 60 * 1000, startedAtMs + 20 * 60 * 1000 + 3 * HOUR), startedAtMs + 3 * HOUR);
      assert.equal(E.skipFreestyleIdle(startedAtMs, startedAtMs + 20 * 60 * 1000, startedAtMs + 20 * 60 * 1000 + 2 * HOUR), startedAtMs, 'two hours exactly is not idle');
      assert.equal(E.skipFreestyleIdle(startedAtMs, startedAtMs - 5 * HOUR, startedAtMs + HOUR), startedAtMs, 'an edit before the start says nothing about the session');
      assert.equal(E.skipFreestyleIdle(startedAtMs, savedAtMs, Number.NaN), startedAtMs);
      assert.ok(E.skipFreestyleIdle(startedAtMs, startedAtMs, startedAtMs + 9 * HOUR) <= startedAtMs + 9 * HOUR, 'never a start in the future');

      const screen = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      assert.match(screen, /setStartedAtMs\(\(current\) => \(current === null \? current : skipFreestyleIdle\(current, previousEditMs, editedAtMs\)\)\);/);
    },
  },
  {
    name: 'hunt 10: ticking the lead lift of a superset with more sets than its partner still rests after the last lift of the round',
    run() {
      const E = dist('lib', 'emptyWorkoutSession.js');
      const S = dist('lib', 'supersetGrouping.js');
      const mk = (key, n) => ({
        localKey: key, name: key, libraryItemId: null, imageUrl: null, repMin: 8, repMax: 12, restSeconds: 90, trackedDefault: true,
        sets: Array.from({ length: n }, (_, i) => ({ localKey: key + i, kg: '50', reps: '8', done: false })),
      });
      const rest = (list, lift, round) => E.freestyleRestSecondsForTick(list[lift], list[lift].sets[round], 60, list);

      const linked = S.setSupersetLink([mk('Bench', 3), mk('Row', 1)], 0, true);
      assert.equal(rest(linked, 0, 0), null, 'round 1: Row still has its set to do');
      assert.equal(rest(linked, 0, 1), 90, 'round 2: Bench carries on alone, so its own tick rests');
      assert.equal(rest(linked, 0, 2), 90);
      assert.equal(rest(linked, 1, 0), 90, 'the last lift of round 1 rests, as before');

      const reversed = S.setSupersetLink([mk('Row', 1), mk('Bench', 3)], 0, true);
      assert.equal(rest(reversed, 0, 0), null);
      assert.equal(rest(reversed, 1, 0), 90);
      assert.equal(rest(reversed, 1, 2), 90);

      // Equal counts and a three-lift group keep their rule: nothing until the last lift of the round.
      const equal = S.setSupersetLink([mk('A', 2), mk('B', 2)], 0, true);
      assert.equal(rest(equal, 0, 0), null);
      assert.equal(rest(equal, 0, 1), null);
      assert.equal(rest(equal, 1, 1), 90);
      const three = S.setSupersetLink(S.setSupersetLink([mk('A', 2), mk('B', 3), mk('C', 1)], 0, true), 1, true);
      assert.equal(rest(three, 0, 1), null, 'B still has a set in round 2');
      assert.equal(rest(three, 1, 1), 90, 'C has none in round 2, so B is the last of it');
      assert.equal(rest(three, 1, 0), null);
    },
  },
  {
    name: 'hunt 10: the measure delta pill reads the window the chart draws, so 7D is a week',
    run() {
      const B = dist('lib', 'bodyweightCard.js');
      const now = new Date(2026, 9, 9, 12);
      const nowMs = now.getTime();
      const at = (daysAgo) => new Date(2026, 9, 9 - daysAgo, 8).toISOString();
      const entries = [
        { recordedAt: at(300), value: 100 },
        { recordedAt: at(3), value: 89 },
        { recordedAt: at(0), value: 88 },
      ];
      const windowOf = (range) =>
        B.buildValueWindow(entries, nowMs, B.measureRangeDays(range, B.earliestEntryMs(entries.map((e) => e.recordedAt)), nowMs), 'en');
      assert.equal(B.windowValueDelta(windowOf('7d')), -1, '89 to 88 this week, not 100 to 88 since last winter');
      assert.equal(B.windowValueDelta(windowOf('3m')), -1);
      assert.equal(B.windowValueDelta(windowOf('1y')), -12, 'the year chip does reach 300 days back');
      assert.equal(B.windowValueDelta(B.buildValueWindow([entries[2]], nowMs, 7, 'en')), null, 'one reading is no change');
      assert.equal(B.windowValueDelta([]), null);

      const progress = read('src', 'screens', 'ProgressScreen.tsx');
      assert.match(progress, /const selectedMeasureDelta = windowValueDelta\(selectedMeasureWindow\);/);
      assert.doesNotMatch(progress, /getMeasurementRangeStart/);
    },
  },
  {
    name: 'hunt 10: a lift logged twice in one workout is one session for the records and the set log',
    run() {
      const P = dist('lib', 'personalRecords.js');
      const L = dist('lib', 'exerciseSetLog.js');
      const at = '2026-09-20T10:00:00.000Z';
      const at2 = '2026-09-27T10:00:00.000Z';
      const log = (id, sessionId, performedAt, weight, reps) => ({
        id, sessionId, performedAt, exerciseNameSnapshot: 'Bench Press', exerciseTemplateId: null, weight,
        repsPerSet: reps, tracked: true, orderIndex: 0,
      });
      // Newest first, as allLogs comes: one log on the 27th, then two blocks of one session on the 20th.
      const logs = [
        log('c', 's2', at2, 100, [5, 5, 5]),
        log('b', 's1', at, 80, [10, 10, 10]),
        log('a', 's1', at, 100, [5, 5, 5]),
      ];
      const entries = P.recordEntriesOfLogs(logs);
      assert.equal(entries.length, 2, 'two sessions, not three logs');
      assert.equal(entries[1].sets.length, 6, 'both blocks of the 20th are one entry');
      assert.equal(entries[1].performedAt, at);

      const source = { key: 'bench', name: 'Bench Press', entries };
      const volume = P.resolveRecord(source, 'volume', new Date('2026-10-09'));
      assert.equal(volume.value, 3900, 'the session moved 1500 + 2400 kg of bench');
      assert.equal(volume.performedAt, at);
      assert.equal(L.buildExerciseSetLog(source, { now: new Date('2026-10-09') }).totalSessions, 2);

      // A log without a session id stands alone; nothing is merged across ids.
      assert.equal(P.recordEntriesOfLogs([{ ...logs[1], sessionId: '' }, { ...logs[2], sessionId: '' }]).length, 2);
      assert.equal(P.recordEntriesOfLogs([]).length, 0);

      assert.match(read('src', 'app', 'useRecordsAndMilestones.ts'), /entries: recordEntriesOfLogs\(summary\.allLogs\),/);
    },
  },
  {
    name: 'hunt 10: the weigh-ins milestone counts days with a weigh-in, as the weight card does',
    run() {
      const M = dist('lib', 'milestoneFacts.js');
      const B = dist('lib', 'bodyweightCard.js');
      const entry = (day, hour, weight, id) => ({ id, recordedAt: new Date(2026, 9, day, hour).toISOString(), weight });
      const database = (bodyweightEntries) => ({ workoutSessions: [], exerciseLogs: [], cardioSessions: [], bodyweightEntries, preferences: {} });
      const bodyweightRungs = (entries) => {
        const facts = M.getMilestoneFacts(database(entries), { currentWeekStreak: 0 }, []);
        return {
          figure: facts.current.bodyweight,
          reached: M.buildMilestoneLedger(facts, 'kg').reached.filter((rung) => rung.family === 'bodyweight').map((rung) => rung.target),
        };
      };

      const sameDay = [entry(8, 7, 75, 'a'), entry(8, 8, 57, 'b'), entry(8, 9, 75.5, 'c'), entry(8, 10, 75.4, 'd'), entry(8, 11, 75.2, 'e')];
      const corrected = bodyweightRungs(sameDay);
      assert.equal(corrected.figure, 1, 'five corrections on one morning are one weigh-in');
      assert.equal(corrected.figure, B.buildBodyweightCardStats(sameDay, new Date(2026, 9, 8, 23)).count);
      assert.ok(!corrected.reached.includes(5));

      const fiveDays = [1, 2, 3, 4, 5].map((day) => entry(day, 8, 75, `d${day}`));
      const real = bodyweightRungs([...fiveDays, entry(5, 9, 74.5, 'fix')]);
      assert.equal(real.figure, 5);
      assert.ok(real.reached.includes(5), 'five days is the five weigh-ins rung');
      // An unreadable date still is not a point.
      assert.equal(bodyweightRungs([entry(1, 8, 75, 'a'), { id: 'x', recordedAt: 'nope', weight: 75 }]).figure, 1);
    },
  },
];
