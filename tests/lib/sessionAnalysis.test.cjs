const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildSessionAnalysis, describeVolumeChange } = require('../../.test-dist/lib/sessionAnalysis.js');

function session(id, name, daysAgo, totalVolumeKg, durationMinutes) {
  return {
    id,
    workoutTemplateId: 'tpl',
    workoutNameSnapshot: name,
    performedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    totalVolumeKg,
    durationMinutes,
  };
}

function log(sessionId, name, weight, repsPerSet, sets) {
  return {
    id: `${sessionId}:${name}`,
    sessionId,
    exerciseTemplateId: null,
    exerciseNameSnapshot: name,
    weight,
    repsPerSet,
    tracked: true,
    orderIndex: 0,
    ...(sets ? { sets } : {}),
  };
}

const TWO_SESSIONS = {
  sessions: [session('s2', 'Day 1: Full Body', 1, 1080, 42), session('s1', 'Day 1: Full Body', 8, 1000, 40)],
  logs: [
    log('s1', 'Barbell Squat', 100, [5, 5]),
    log('s2', 'Barbell Squat', 105, [5, 5]),
    log('s1', 'Bench Press', 60, [8]),
    log('s2', 'Bench Press', 60, [8]),
  ],
};

module.exports = [
  {
    name: 'an unknown session id yields nothing rather than an empty shell',
    run() {
      assert.equal(
        buildSessionAnalysis({ sessionId: 'nope', sessions: [], logs: [], language: 'en' }),
        null,
      );
    },
  },
  {
    name: 'a session with no logged sets is not analysed',
    run() {
      const result = buildSessionAnalysis({
        sessionId: 's1',
        sessions: [session('s1', 'Day 1', 1, 0, 10)],
        logs: [],
        language: 'en',
      });
      assert.equal(result, null);
    },
  },
  {
    name: 'the meta row carries duration, sets and volume from the logged session',
    run() {
      const result = buildSessionAnalysis({ ...TWO_SESSIONS, sessionId: 's2', language: 'en' });
      const meta = result.metaParts.join(' · ');
      assert.match(meta, /42 min/);
      assert.match(meta, /3 sets/);
      assert.match(meta, /1080 kg/);
    },
  },
  {
    name: 'no effort is reported when the user never recorded any',
    run() {
      const result = buildSessionAnalysis({ ...TWO_SESSIONS, sessionId: 's2', language: 'en' });
      // The app has no RPE, and the coarse effort is optional — silence beats
      // printing a number the user was never asked for.
      assert.ok(!result.metaParts.some((part) => /felt good/.test(part)));
    },
  },
  {
    name: 'recorded efforts are reported as the ratio that was actually logged',
    run() {
      const result = buildSessionAnalysis({
        sessionId: 's1',
        sessions: [session('s1', 'Day 1', 1, 300, 20)],
        logs: [
          log('s1', 'Bench Press', 60, [8, 8], [
            { orderIndex: 0, weight: 60, reps: 8, kind: 'working', outcome: null, effort: 'good' },
            { orderIndex: 1, weight: 60, reps: 8, kind: 'working', outcome: null, effort: 'hard' },
          ]),
        ],
        language: 'en',
      });

      assert.ok(result.metaParts.some((part) => part === '1/2 felt good'));
    },
  },
  {
    name: 'the verdict is a phrase and never a score',
    run() {
      const result = buildSessionAnalysis({ ...TWO_SESSIONS, sessionId: 's2', language: 'en' });
      assert.equal(result.verdictTagKey, 'analysis.verdict.progress');
      assert.match(result.verdict.text, /\+8%/);
      // No "7/10", no "B+", no star rating.
      assert.doesNotMatch(result.verdict.text, /\d\s*\/\s*10|\b[A-F][+-]?\b\s*grade/i);
    },
  },
  {
    name: 'a first session of its name states its volume instead of a change',
    run() {
      const result = buildSessionAnalysis({
        sessionId: 's1',
        sessions: [session('s1', 'Day 1', 1, 500, 20)],
        logs: [log('s1', 'Barbell Squat', 100, [5])],
        language: 'en',
      });

      assert.equal(result.volumeChangePercent, null);
      assert.match(result.verdict.text, /500 kg/);
      assert.doesNotMatch(result.verdict.text, /%/);
    },
  },
  {
    name: 'volume bars cover comparable sessions only, up to six, current one marked',
    run() {
      const sessions = [];
      const logs = [];
      for (let index = 0; index < 8; index += 1) {
        const id = `s${index}`;
        sessions.push(session(id, 'Day 1: Full Body', 40 - index * 5, 1000 + index * 10, 40));
        logs.push(log(id, 'Barbell Squat', 100, [5]));
      }
      // A differently named session must not appear among the bars.
      sessions.push(session('other', 'Day 2: Lower', 3, 5000, 40));
      logs.push(log('other', 'Barbell Squat', 100, [5]));

      const result = buildSessionAnalysis({ sessions, logs, sessionId: 's7', language: 'en' });

      assert.equal(result.volumeBars.length, 6);
      assert.ok(!result.volumeBars.some((bar) => bar.sessionId === 'other'));
      assert.equal(result.volumeBars[result.volumeBars.length - 1].isCurrent, true);
      assert.equal(result.volumeBars.filter((bar) => bar.isCurrent).length, 1);
    },
  },
  {
    name: 'exercise rows compare against the same lift, and abstain on the first appearance',
    run() {
      const result = buildSessionAnalysis({ ...TWO_SESSIONS, sessionId: 's2', language: 'en' });

      const squat = result.exercises.find((row) => /Squat|Takakyykky/.test(row.name));
      assert.equal(squat.trend, 'up');
      assert.equal(squat.trendLabel, '+5 kg');

      const bench = result.exercises.find((row) => /Bench|Penkki/.test(row.name));
      assert.equal(bench.trend, 'flat');
      // A word, not '=': the row already carries an '=' marker beside it, and
      // the two together printed "= =".
      assert.equal(bench.trendLabel, 'unchanged');

      const firstTime = buildSessionAnalysis({
        sessionId: 's1',
        sessions: [session('s1', 'Day 1', 1, 500, 20)],
        logs: [log('s1', 'Barbell Squat', 100, [5])],
        language: 'en',
      });
      assert.equal(firstTime.exercises[0].trend, null);
      assert.equal(firstTime.exercises[0].trendLabel, null);
    },
  },
  {
    name: 'a later session is never used as the comparison for an earlier one',
    run() {
      // Analysing the older session must not read the newer one as its "last time".
      const result = buildSessionAnalysis({ ...TWO_SESSIONS, sessionId: 's1', language: 'en' });
      assert.ok(result.exercises.every((row) => row.trend === null));
      assert.equal(result.volumeChangePercent, null);
    },
  },
  {
    name: 'observations follow the figures rather than a fixed script',
    run() {
      const result = buildSessionAnalysis({ ...TWO_SESSIONS, sessionId: 's2', language: 'en' });
      const tones = result.observations.map((entry) => entry.trend);
      assert.ok(tones.includes('up'));
      assert.ok(!tones.includes('down'));
    },
  },
  {
    name: 'Finnish output carries the same figures',
    run() {
      const fi = buildSessionAnalysis({ ...TWO_SESSIONS, sessionId: 's2', language: 'fi' });
      // formatPercent: Finnish puts a non-breaking space before the sign.
      assert.match(fi.verdict.text, /\+8\u00a0%/);
      assert.match(fi.title, /Koko keho/);
      assert.ok(fi.metaParts.some((part) => /sarjaa/.test(part)));
    },
  },
  {
    name: 'the builder carries none of the mock figures',
    run() {
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'lib', 'sessionAnalysis.ts'),
        'utf8',
      );
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      // The handoff seeds 6,240 kg, 72.5 bench, avg RPE 7.8, +8%.
      for (const canned of ['6,240', '6240', '72.5', '7.8', "'+8%'"]) {
        assert.ok(!code.includes(canned), `builder must not carry the mock figure ${canned}`);
      }
      // And it must not invent an RPE scale the app never collects.
      assert.doesNotMatch(code, /\bRPE\b/);
    },
  },

  {
    name: 'no change is written as a word, never as 0 %',
    run() {
      // A percentage is reserved for change. "0 %" beside a "0 %" badge reads
      // as missing data on the one screen whose job is proving the numbers.
      assert.deepEqual(describeVolumeChange(0, 'en'), { kind: 'flat', text: 'unchanged' });
      assert.deepEqual(describeVolumeChange(0, 'fi'), { kind: 'flat', text: 'ennallaan' });
      assert.deepEqual(describeVolumeChange(8, 'en'), { kind: 'up', text: '+8%' });
      assert.deepEqual(describeVolumeChange(-8, 'en'), { kind: 'down', text: '-8%' });
      assert.equal(describeVolumeChange(null, 'en'), null);
    },
  },
  {
    name: 'an identical session states its volume instead of three zeros',
    run() {
      // Same name, same volume both times: the old build printed 0 % in the
      // key number, the observation and the verdict.
      const sessions = [
        session('b1', 'Day 1: Full Body', 8, 480, 34),
        session('b2', 'Day 1: Full Body', 1, 480, 34),
      ];
      const logs = [log('b1', 'Bench Press', 60, [8]), log('b2', 'Bench Press', 60, [8])];
      const result = buildSessionAnalysis({ sessionId: 'b2', sessions, logs, language: 'en' });

      assert.equal(result.volumeChangePercent, 0);
      const volumeKey = result.keyNumbers.find((metric) => metric.labelKey === 'analysis.key.volume');
      assert.equal(volumeKey.sub, 'unchanged');

      const everything = [
        result.verdict.text,
        ...result.observations.map((entry) => entry.body.text),
        ...result.keyNumbers.map((metric) => metric.sub ?? ''),
      ].join(' | ');
      assert.ok(!/0\s*%/.test(everything), `a zero percentage survived: ${everything}`);
      // The number itself is what reassures, so the verdict names it.
      assert.match(result.verdict.text, /480 kg/);
      // The per-exercise row said it twice: an "=" marker beside an "=" label.
      const bench = result.exercises.find((row) => /Bench/.test(row.name));
      assert.equal(bench.trend, 'flat');
      assert.equal(bench.trendLabel, 'unchanged');
      assert.equal(result.verdictTagKey, 'analysis.verdict.steady');
    },
  },
  {
    name: 'one logged set reads "1 set", not "1 sets"',
    run() {
      const sessions = [session('o1', 'Day 1: Full Body', 1, 480, 34)];
      const logs = [log('o1', 'Bench Press', 60, [8])];
      const en = buildSessionAnalysis({ sessionId: 'o1', sessions, logs, language: 'en' });
      assert.ok(en.metaParts.includes('1 set'), en.metaParts.join(' · '));
      const fi = buildSessionAnalysis({ sessionId: 'o1', sessions, logs, language: 'fi' });
      assert.ok(fi.metaParts.includes('1 sarja'), fi.metaParts.join(' · '));
    },
  },
];
