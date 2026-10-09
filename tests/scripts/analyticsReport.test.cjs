const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The report's arithmetic, held to fixed events (analytics audit,
 * 2026-09-21). The script runs on the developer's machine against live data,
 * so nothing else ever checks what it divides by.
 */
const report = require('../../scripts/analytics-report.cjs');
const { render } = require('../../scripts/analytics-dashboard.cjs');

const root = path.join(__dirname, '..', '..');

let seq = 0;
const install = () => `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`;
const ev = (installId, name, at, props) => ({ installId, name, at, props: props ?? {} });
const step = (installId, value, at = '2026-09-10T08:00:00.000Z') => ev(installId, 'onboarding_step', at, { path: value });

module.exports = [
  {
    name: 'analytics report: days are Helsinki days, stepped by the calendar',
    run() {
      assert.equal(report.TIME_ZONE, 'Europe/Helsinki');
      // 23:30 and 00:30 in Helsinki are one UTC day and two Helsinki days.
      assert.equal(report.localDay('2026-09-20T20:30:00.000Z'), '2026-09-20');
      assert.equal(report.localDay('2026-09-20T21:30:00.000Z'), '2026-09-21');
      // Winter time is UTC+2.
      assert.equal(report.localDay('2026-12-31T22:30:00.000Z'), '2027-01-01');
      assert.equal(report.localDay('not a date'), null);
      // Across both clock changes and a month end.
      assert.equal(report.addDays('2026-10-24', 1), '2026-10-25');
      assert.equal(report.addDays('2026-10-25', 1), '2026-10-26');
      assert.equal(report.addDays('2026-03-28', 2), '2026-03-30');
      assert.equal(report.addDays('2026-09-30', 1), '2026-10-01');

      const dailies = report.aggregate([
        ev('a', 'app_open', '2026-09-20T20:30:00.000Z'),
        ev('a', 'app_open', '2026-09-20T21:30:00.000Z'),
      ], { now: new Date('2026-09-22T12:00:00.000Z') }).dailies;
      assert.deepEqual(dailies.map((row) => row.day), ['2026-09-20', '2026-09-21']);
    },
  },
  {
    name: 'analytics report: an install counts for a return window only once the window is over',
    run() {
      const old = install();
      const oldGone = install();
      const midnight = install();
      const young = install();
      const events = [
        // First opened 10 September, back on the 11th.
        ev(old, 'app_open', '2026-09-10T08:00:00.000Z'),
        ev(old, 'app_open', '2026-09-11T08:00:00.000Z'),
        // First opened 10 September, never back.
        ev(oldGone, 'app_open', '2026-09-10T09:00:00.000Z'),
        // 23:30 and 00:30 Helsinki time: back the next day, the same UTC day.
        ev(midnight, 'app_open', '2026-09-12T20:30:00.000Z'),
        ev(midnight, 'app_open', '2026-09-12T21:30:00.000Z'),
        // First opened yesterday: cannot have come back on day 2 yet.
        ev(young, 'app_open', '2026-09-20T10:00:00.000Z'),
        ev(young, 'app_open', '2026-09-21T06:00:00.000Z'),
      ];
      const back = report.aggregate(events, { now: new Date('2026-09-21T12:00:00.000Z') }).retention;
      assert.equal(back.installs, 4);
      assert.equal(back.horizon, '2026-09-21');
      const [early, week] = back.windows;
      assert.deepEqual([early.from, early.to, week.from, week.to], [1, 2, 6, 8]);
      // The window's name says the days it counts, not "D2".
      assert.match(early.label, /1\.–2\./);
      assert.match(week.label, /6\.–8\./);
      // `young` is out of both: its day 2 is today, still going on.
      assert.equal(early.eligible, 3);
      assert.equal(early.returned, 2, 'the Helsinki-midnight return counts');
      // Day 8 for 10 September is the 18th, over; for the 12th it is the 20th, over.
      assert.equal(week.eligible, 3);
      assert.equal(week.returned, 0);

      // The horizon is the last day the data has, not a phone's future clock.
      const skewed = report.aggregate(
        [...events, ev(young, 'app_open', '2027-01-01T10:00:00.000Z')],
        { now: new Date('2026-09-21T12:00:00.000Z') },
      ).retention;
      assert.equal(skewed.horizon, '2026-09-21');
      // And not past the data: a pipe that went quiet on the 13th cannot
      // count day 8 of an install from the 12th as "never came back".
      const quiet = report.aggregate(events.slice(0, 5), { now: new Date('2026-09-21T12:00:00.000Z') }).retention;
      assert.equal(quiet.horizon, '2026-09-13');
      assert.equal(quiet.windows[0].eligible, 2);
      assert.equal(quiet.windows[1].eligible, 0);
    },
  },
  {
    name: 'analytics report: the funnel is one branch at a time, each a share of the installs that reached its first row',
    run() {
      const built = install();
      const ready = install();
      const empty = install();
      const leftAtWelcome = install();
      const leftAtPicker = install();
      const events = [
        step(built, 'welcome'), step(built, 'path'), step(built, 'about'), step(built, 'questionnaire'),
        step(built, 'location'), step(built, 'goal'),
        ev(built, 'onboarding_completed', '2026-09-10T08:10:00.000Z', { path: 'build' }),
        ev(built, 'plan_adopted', '2026-09-10T08:10:01.000Z'),
        ev(built, 'workout_started', '2026-09-11T08:00:00.000Z'),
        step(ready, 'welcome'), step(ready, 'path'), step(ready, 'ready_catalog'),
        ev(ready, 'onboarding_completed', '2026-09-10T08:10:00.000Z', { path: 'ready_catalog' }),
        step(empty, 'welcome'), step(empty, 'path'),
        ev(empty, 'onboarding_completed', '2026-09-10T08:10:00.000Z', { path: 'empty' }),
        step(leftAtWelcome, 'welcome'),
        step(leftAtPicker, 'welcome'), step(leftAtPicker, 'path'),
      ];
      const funnels = Object.fromEntries(report.buildFunnels(events).map((funnel) => [funnel.key, funnel]));
      const counts = (key) => funnels[key].rows.map((row) => row.count);

      assert.equal(funnels.entry.base, 5);
      assert.deepEqual(counts('entry'), [5, 4]);
      // Every branch starts at the fork: four installs reached the picker.
      for (const key of ['build', 'ready', 'empty']) {
        assert.equal(funnels[key].base, 4, `${key} starts from the path picker`);
      }
      assert.deepEqual(counts('ready'), [4, 1, 1]);
      assert.deepEqual(counts('empty'), [4, 1]);
      // Build: path, about, questionnaire, the seven stages, done.
      assert.deepEqual(counts('build'), [4, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1]);
      // The catalogue is not a step of the questionnaire branch.
      assert.ok(!funnels.build.rows.some((row) => /ready_catalog/.test(row.label)));
      assert.equal(funnels.after.base, 3);
      assert.deepEqual(counts('after'), [3, 1, 1, 0]);
      // No row can hold more than its branch's base.
      for (const funnel of Object.values(funnels)) {
        for (const row of funnel.rows) assert.ok(row.count <= funnel.base, `${funnel.key}: ${row.label}`);
      }
    },
  },
  {
    name: 'analytics report: the funnel lists every stage the questionnaire sends, in its order',
    run() {
      const screen = fs.readFileSync(path.join(root, 'src', 'screens', 'OnboardingScreen.tsx'), 'utf8');
      const declared = /const STAGES: SetupStage\[\] = \[([^\]]*)\];/.exec(screen);
      assert.ok(declared, 'OnboardingScreen STAGES not found');
      const stages = declared[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, '')).filter(Boolean);
      assert.deepEqual(report.QUESTIONNAIRE_STAGES, stages);
      const build = report.FUNNELS.find((funnel) => funnel.key === 'build');
      assert.deepEqual(
        build.rows.filter(([kind, value]) => kind === 'step' && stages.includes(value)).map(([, value]) => value),
        stages,
      );
    },
  },
  {
    name: 'analytics report: every page is fetched, and a short read says so',
    async run() {
      const batch = (index) => ({ installId: 'x', events: [{ name: 'app_open', at: `2026-09-10T08:00:${String(index % 60).padStart(2, '0')}.000Z` }] });
      const requests = [];
      // Only the first page carries the total; a page before `since` can
      // hold nothing and still lead on.
      const pages = [
        { total: 5, batches: [batch(1), batch(2)], unreadable: 0, next: 'cursor-1' },
        { batches: [], unreadable: 0, next: 'cursor-2' },
        { batches: [batch(3), batch(4)], unreadable: 0, next: 'cursor-3' },
        { batches: [batch(5)], unreadable: 0, next: null },
      ];
      const fetchImpl = async (url) => {
        requests.push(new URL(url));
        const body = pages[requests.length - 1];
        return { ok: true, json: async () => body, text: async () => '' };
      };
      const result = await report.fetchEventPages({ url: 'https://example.test/api/events', secret: 's', since: '2026-09-01', fetchImpl });
      assert.equal(requests.length, 4);
      assert.equal(requests[0].searchParams.get('since'), '2026-09-01');
      assert.equal(requests[0].searchParams.get('cursor'), null);
      assert.deepEqual(requests.slice(1).map((request) => request.searchParams.get('cursor')), ['cursor-1', 'cursor-2', 'cursor-3']);
      assert.ok(requests.every((request) => request.searchParams.get('since') === '2026-09-01'), 'every page keeps the bound');
      assert.equal(result.events.length, 5);
      assert.equal(result.batchesFetched, 5);
      assert.equal(result.batchTotal, 5);
      assert.equal(report.coverageWarning(result), null);

      // A server from before paging answers once, with its newest batches.
      const legacy = await report.fetchEventPages({
        url: 'https://example.test/api/events',
        secret: 's',
        fetchImpl: async () => ({ ok: true, json: async () => ({ total: 2400, batches: [batch(1)] }), text: async () => '' }),
      });
      assert.equal(legacy.batchesFetched, 1);
      assert.match(report.coverageWarning(legacy), /1\/2400/);
      assert.match(report.coverageWarning({ batchesFetched: 3, batchTotal: 5, unreadable: 2 }), /2 lukukelvotonta/);
    },
  },
  {
    name: 'analytics report: the dashboard draws what the report aggregates',
    run() {
      const a = install();
      const summary = report.aggregate(
        [step(a, 'welcome'), step(a, 'path'), ev(a, 'app_open', '2026-09-10T08:00:00.000Z')],
        { now: new Date('2026-09-21T12:00:00.000Z') },
      );
      const html = render(summary, {
        generatedAt: 'now',
        eventCount: 3,
        batchTotal: 2,
        batchesFetched: 1,
        warning: report.coverageWarning({ batchesFetched: 1, batchTotal: 2, unreadable: 0 }),
      });
      assert.doesNotMatch(html, /undefined|NaN/);
      assert.match(html, /Rakenna ohjelma/);
      assert.match(html, /palasi 1\.–2\. päivänä/);
      assert.match(html, /VAROITUS: luettiin 1\/2/);
    },
  },
  {
    name: 'analytics report: errors group by signature, worst first, and operations by op and code per Helsinki day',
    run() {
      const a = install();
      const b = install();
      const c = install();
      const err = (installId, at, signature, over = {}) =>
        ev(installId, 'app_error', at, {
          kind: 'render',
          name: 'TypeError',
          signature,
          frames: ['index.android.bundle:1:100', 'index.android.bundle:1:200'],
          screen: 'home/dashboard',
          appVersion: '1.1.0',
          platform: 'android',
          ...over,
        });
      const events = [
        // One bug, three phones, two versions.
        err(a, '2026-10-01T08:00:00.000Z', 'aaaaaaaaaaaa01'),
        err(a, '2026-10-02T08:00:00.000Z', 'aaaaaaaaaaaa01', { appVersion: '1.1.1', screen: 'workout/programDay' }),
        err(b, '2026-10-02T09:00:00.000Z', 'aaaaaaaaaaaa01', { appVersion: '1.1.1', screen: 'workout/programDay' }),
        err(c, '2026-10-03T09:00:00.000Z', 'aaaaaaaaaaaa01', { frames: ['index.android.bundle:9:9'] }),
        // Another bug that one phone hits five times: more occurrences, fewer installs.
        ...Array.from({ length: 5 }, (_, index) => err(a, `2026-10-0${index + 1}T10:00:00.000Z`, 'bbbbbbbbbbbb02', { kind: 'js_fatal', name: 'RangeError' })),
        // 23:30 and 00:30 Helsinki: one UTC day, two Helsinki days.
        ev(a, 'operation_failed', '2026-10-01T20:30:00.000Z', { op: 'backup_upload', code: 'NETWORK' }),
        ev(a, 'operation_failed', '2026-10-01T21:30:00.000Z', { op: 'backup_upload', code: 'NETWORK' }),
        ev(b, 'operation_failed', '2026-10-01T21:40:00.000Z', { op: 'backup_upload', code: 'NETWORK' }),
        ev(b, 'operation_failed', '2026-10-02T08:00:00.000Z', { op: 'workout_save', code: 'QUOTA' }),
        ev(a, 'app_open', '2026-10-01T08:00:00.000Z'),
      ];
      const { appErrors, operations } = report.buildErrors(events);

      assert.deepEqual(appErrors.map((row) => row.signature), ['aaaaaaaaaaaa01', 'bbbbbbbbbbbb02'], 'most installs first, however often the other repeats');
      const first = appErrors[0];
      assert.equal(first.count, 4);
      assert.equal(first.installs, 3);
      assert.equal(first.firstSeen, '2026-10-01');
      assert.equal(first.lastSeen, '2026-10-03');
      assert.deepEqual(first.versions, ['1.1.0', '1.1.1']);
      assert.deepEqual(first.screens, ['home/dashboard', 'workout/programDay'], 'two each: alphabetical');
      assert.deepEqual(first.frames, ['index.android.bundle:9:9'], 'the latest sighting’s frames');
      assert.equal(appErrors[1].count, 5);
      assert.equal(appErrors[1].installs, 1);
      assert.deepEqual(appErrors[1].kinds, ['js_fatal']);

      assert.deepEqual(operations.map((row) => `${row.op}/${row.code}/${row.total}/${row.installs}`), [
        'backup_upload/NETWORK/3/2',
        'workout_save/QUOTA/1/1',
      ]);
      assert.deepEqual(operations[0].days, [
        { day: '2026-10-01', count: 1 },
        { day: '2026-10-02', count: 2 },
      ]);

      // Nothing sent, nothing printed as undefined.
      const lines = report.errorLines(report.buildErrors([])).join('\n');
      assert.match(lines, /ei sovellusvirheitä/);
      assert.match(lines, /ei epäonnistuneita toimintoja/);
      assert.match(report.errorLines({ appErrors, operations }).join('\n'), /aaaaaaaaaaaa01 {2}TypeError/);

      const summary = report.aggregate(events, { now: new Date('2026-10-04T12:00:00.000Z') });
      assert.equal(summary.errors.appErrors.length, 2);
      const html = render(summary, { generatedAt: 'now', eventCount: events.length, batchTotal: 1, batchesFetched: 1, warning: null });
      assert.doesNotMatch(html, /undefined|NaN/);
      assert.match(html, /Virheet/);
      assert.match(html, /aaaaaaaaaaaa01/);
      assert.match(html, /backup_upload/);
      // A hostile stored value is escaped, not rendered.
      const hostile = report.aggregate(
        [ev(a, 'app_error', '2026-10-01T08:00:00.000Z', { signature: 'cc01', name: '<script>alert(1)</script>', frames: [], kind: 'render' })],
        { now: new Date('2026-10-04T12:00:00.000Z') },
      );
      const page = render(hostile, { generatedAt: 'now', eventCount: 1, batchTotal: 1, batchesFetched: 1, warning: null });
      assert.doesNotMatch(page, /<script>alert/);
    },
  },
];
