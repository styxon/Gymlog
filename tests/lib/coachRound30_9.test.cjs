const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * Four coach findings from the store-shot session (2026-09-30): a Finnish
 * question the chip wrote with the lift's name uninflected, a rest day Home's
 * hero did not admit to, bench press cut from the coach's lift list and read
 * as "not tracked", and a rate-limited question shown as OFFLINE.
 */
module.exports = [
  {
    name: 'coach chips: a Finnish question puts the lift name first instead of inflecting it',
    run() {
      const { buildCoachNoticed, buildCoachOpeningLine, nameVars } = require('../../.test-dist/lib/coachChat.js');
      assert.deepEqual(nameVars('subject', ' Jalkaprässi '), { subject: 'jalkaprässi', Subject: 'Jalkaprässi' });

      const row = { key: 'legpress', tone: 'amber', name: 'Jalkaprässi', status: 'paikallaan', meta: '215 kg', bars: [], locked: null };
      const [fi] = buildCoachNoticed([row], 'fi');
      assert.equal(fi.question, 'Jalkaprässi: mitä minun pitäisi tehdä seuraavaksi?');
      assert.ok(!/asialle/.test(fi.question));
      const [en] = buildCoachNoticed([{ ...row, name: 'Leg Press' }], 'en');
      assert.equal(en.question, 'What should I do about my leg press?');

      // And a sentence the name opens starts with a capital.
      const input = { weeklyRead: [row], todaySessionTitle: null, nextSessionTitle: null, sessionsThisWeek: 0 };
      assert.match(buildCoachOpeningLine(input, 'fi'), /^Jalkaprässi ei ole liikkunut/);
    },
  },
  {
    name: 'home hero: a rest day with no pick says so above the next session',
    run() {
      const home = read('src', 'screens', 'HomeScreen.tsx');
      assert.match(
        home,
        /const restToday =\s*Boolean\(nextPlanSession\) &&\s*scheduleKnown &&\s*!activePlan\?\.todayPickSessionId &&\s*!trainsOn\(trainingSchedule, new Date\(\)\);/,
      );
      assert.match(home, /\{restToday \? \(\s*<Text style=\{styles\.heroRestLabel\}>\{t\(language, 'home\.hero\.restToday'\)\}<\/Text>/);
      // The coach treats a picked session as today's too, so the two agree.
      // Its intro memo leaves VinhaApp for src/app in the phase-B split
      // (2026-09-30): read the whole shell, App.tsx first.
      const app = require('../helpers/appWiringSource.cjs').readAppWiring().replace(/\r\n/g, '\n');
      assert.match(
        app,
        /homeActivePlanCard\?\.nextSession &&\s*sessionIsOnPlanToday\(\{[^}]*pickStands: Boolean\(homeActivePlanCard\.todayPickSessionId\),[^}]*scheduledToday: trainsOn\(homeTrainingSchedule, new Date\(todayStartMs\)\),/,
      );
    },
  },
  {
    name: 'coach history: a four-day split keeps every lift, and one past the cap is named, not dropped',
    run() {
      const { buildAiTrainingContext, normalizeAiCoachTrainingContext } = require('../../.test-dist/lib/aiTrainingContext.js');
      const { buildAiCoachContextText } = require('../../.test-dist/lib/aiCoachSystemContext.js');
      const DAY = 86400000;
      const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
      const lifts = Array.from({ length: 26 }, (_, index) => `Lift ${String(index + 1).padStart(2, '0')}`);
      // Bench trained least recently and least often: last in the sort.
      const sessions = [];
      const logs = [];
      for (let day = 0; day < 6; day += 1) {
        const id = `s${day}`;
        sessions.push({ id, workoutTemplateId: 't', workoutNameSnapshot: 'Day', performedAt: at(2 + day * 3), durationMinutes: 60, totalVolumeKg: 1000 });
        lifts.forEach((name, order) => logs.push({
          id: `${id}-${order}`, sessionId: id, exerciseTemplateId: null, exerciseNameSnapshot: name,
          weight: 50, repsPerSet: [8, 8], tracked: true, orderIndex: order,
        }));
      }
      sessions.push({ id: 'old', workoutTemplateId: 't', workoutNameSnapshot: 'Day', performedAt: at(40), durationMinutes: 60, totalVolumeKg: 1000 });
      logs.push({ id: 'old-bench', sessionId: 'old', exerciseTemplateId: null, exerciseNameSnapshot: 'Bench Press', weight: 80, repsPerSet: [8, 8, 7], tracked: true, orderIndex: 0 });

      const context = buildAiTrainingContext({
        unitPreference: 'kg',
        activeWorkoutSummary: null,
        homeSummary: { streak: { sessionsThisWeek: 1, sessionsLast30Days: 7, activity: { days: [] } } },
        workoutSessions: sessions,
        exerciseLogs: logs,
        trackedProgress: [],
        readyProgramCount: 3,
        recommendedProgramId: null,
        recommendedProgramTitle: null,
        customProgramTitle: null,
        trainingDays: ['mon', 'thu'],
      });
      assert.equal(context.history.lifts.length, 24);
      assert.equal(context.history.liftsNotShown.length, 3);
      assert.ok(context.history.liftsNotShown.includes('Bench Press'), context.history.liftsNotShown.join(', '));

      const text = buildAiCoachContextText(normalizeAiCoachTrainingContext(context), 'en');
      assert.match(text, /- Also logged in this window, trajectory left out for size: [^\n]*Bench Press[^\n]*never say one is not tracked/);

      // A posted list is re-parsed: strings only, trimmed, bounded.
      const posted = normalizeAiCoachTrainingContext({
        history: { lifts: [], liftsNotShown: [' Bench Press ', 5, '', null, 'x'.repeat(200), ...Array.from({ length: 60 }, (_, i) => `L${i}`)] },
      }).history.liftsNotShown;
      assert.equal(posted[0], 'Bench Press');
      assert.equal(posted[1].length, 80);
      assert.equal(posted.length, 40);
      // An older app sends none, and the block says nothing about it.
      assert.deepEqual(normalizeAiCoachTrainingContext({ history: { lifts: [] } }).history.liftsNotShown, []);
    },
  },
  {
    name: 'coach history: shedding a heavy context names the lifts it cut',
    run() {
      const source = read('src', 'lib', 'aiTrainingContext.ts');
      assert.match(source, /history: \{\s*\.\.\.shedLifts\(context\.history, 5\),/);
      assert.match(source, /history: \{ \.\.\.shedLifts\(context\.history, 0\), sessions: \[\], truncated: true \}/);
    },
  },
  {
    name: 'coach client: a rate-limited question is marked, and the chat says wait rather than OFFLINE',
    run() {
      const client = read('src', 'lib', 'aiCoachClient.ts');
      assert.match(client, /if \(isErrorResponse\(payload\) && payload\.error\?\.code === 'RATE_LIMIT'\) \{[\s\S]{0,300}limited: true,/);
      // Checked before the generic fallback, which would call it an outage.
      assert.ok(client.indexOf("payload.error?.code === 'RATE_LIMIT'") < client.indexOf('if (isErrorResponse(payload) && payload.fallback)'));

      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      const limited = chat.indexOf('if (result.limited) {');
      const offline = chat.indexOf("setAnsweredOffline(result.source === 'preview');");
      const charged = chat.indexOf('onQuestionUsed();');
      assert.ok(limited > 0 && limited < offline && limited < charged, 'the limited branch returns before the badge and the charge');
      const branch = chat.slice(limited, chat.indexOf('return;', limited));
      assert.match(branch, /t\(language, 'coachChat\.rateLimited'\)/);
      assert.match(branch, /setDraft\(\(current\) => \(current\.trim\(\) \? current : trimmed\)\);/);
    },
  },
];
