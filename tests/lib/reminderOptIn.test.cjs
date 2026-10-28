const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { remindersOptedIn } = require('../../src/lib/reminderOptIn');
const { buildNotificationPlan } = require('../../src/lib/notificationPlan');
const { weekdaySchedule } = require('../../src/lib/trainingSchedule');

const ROOT = path.join(__dirname, '..', '..');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...parts) => strip(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));

const FRESH = {
  pushEnabled: false,
  level: 'normal',
  personalRecords: true,
  weeklySummary: true,
  comebackNudge: true,
  sessionReminders: false,
  reminderTime: '17:30',
  weighInReminder: false,
  measurementReminderKind: null,
  measurementReminderDay: 'sun',
  restAlerts: true,
  restWarning: true,
  sessionOngoing: true,
  idleNudge: true,
  restAlertsAsked: false,
};

function planFor(prefs, extra = {}) {
  const nowMs = new Date(2026, 8, 1, 12).getTime();
  return buildNotificationPlan({
    nowMs,
    prefs,
    language: 'en',
    schedule: weekdaySchedule([0, 2, 4]),
    lastSessionAtMs: null,
    weekSessionCount: 0,
    weekVolumeKg: 0,
    latestPr: null,
    onTrainingBreak: false,
    ...extra,
  });
}

/**
 * Asking for one scheduled reminder turns on the switch it waits on (audit
 * 2026-09-16, N3/S7): the coach's "Morning weigh-in is on" and the trial's
 * two-day warning were both promised and never scheduled.
 */
module.exports = [
  {
    name: 'reminder opt-in: the switch goes on with what was asked for, and nothing else',
    run() {
      // The bug, measured: the coach's write alone plans nothing.
      assert.equal(planFor({ ...FRESH, weighInReminder: true }).length, 0);

      const next = remindersOptedIn(FRESH, { weighInReminder: true });
      assert.equal(next.pushEnabled, true);
      assert.equal(next.weighInReminder, true);
      // The recaps that ship on inside the switch were not asked for.
      assert.equal(next.personalRecords, false);
      assert.equal(next.weeklySummary, false);
      assert.equal(next.comebackNudge, false);
      // The workout alerts are not the switch's business.
      assert.equal(next.restAlerts, true);
      const planned = planFor(next);
      assert.ok(planned.length > 0 && planned.every((item) => item.category === 'weighIn'), 'only the weigh-in');

      // The trial asks for its warning alone.
      const trial = remindersOptedIn(FRESH);
      const endsAt = new Date(2026, 8, 10, 12).getTime();
      assert.deepEqual(
        planFor(trial, { proTrialEndsAtMs: endsAt }).map((item) => item.category),
        ['trial'],
      );

      // Reminders left stored from before the switch went off stay off: the
      // switch coming back for one warning is not the reader asking for them.
      const dormant = {
        ...FRESH,
        personalRecords: false,
        weeklySummary: false,
        comebackNudge: false,
        sessionReminders: true,
        weighInReminder: true,
        measurementReminderKind: 'waist',
      };
      assert.deepEqual(
        planFor(remindersOptedIn(dormant), { proTrialEndsAtMs: endsAt }).map((item) => item.category),
        ['trial'],
        'a dormant reminder came back with the trial warning',
      );
      const weighOnly = remindersOptedIn(dormant, { weighInReminder: true });
      assert.deepEqual(
        [weighOnly.sessionReminders, weighOnly.weighInReminder, weighOnly.measurementReminderKind],
        [false, true, null],
      );
      // Only the categories: the reader's times and days are kept for later.
      assert.equal(weighOnly.reminderTime, FRESH.reminderTime);
      assert.equal(weighOnly.measurementReminderDay, FRESH.measurementReminderDay);

      // A switch already on keeps every choice the reader made there.
      const on = { ...FRESH, pushEnabled: true, weeklySummary: true, comebackNudge: false };
      assert.deepEqual(remindersOptedIn(on, { weighInReminder: true }), { ...on, weighInReminder: true });
      // Pure.
      assert.equal(FRESH.pushEnabled, false);
    },
  },
  {
    name: 'reminder opt-in: the coach and the trial ask the phone first and say "on" only after the write',
    run() {
      const home = read('src', 'app', 'renderHomeScreens.tsx');
      const weighIn = home.slice(home.indexOf('onEnableWeighInReminder='), home.indexOf('onCoachSuggestionResolved='));
      assert.match(weighIn, /const granted = await requestNotificationPermission\(preferences\.appLanguage\);/);
      assert.match(weighIn, /if \(!granted\) \{\s*return 'blocked';\s*\}/);
      assert.match(
        weighIn,
        // From the stored prefs: the system dialog came in between (2026-09-26).
        /await updatePreferences\(\(current\) => \(\{\s*notificationPrefs: remindersOptedIn\(current\.notificationPrefs, \{ weighInReminder: true \}\),\s*\}\)\);\s*return 'on';/,
      );

      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      const branch = chat.slice(chat.indexOf("if (offer.type === 'weighIn') {"), chat.indexOf("if (offer.type === 'goal') {"));
      // Awaited, and the reply picked from what happened.
      assert.match(branch, /outcome = await onEnableWeighInReminder\(\);/);
      assert.match(branch, /catch \{\s*outcome = 'failed';\s*\}/);
      assert.ok(
        branch.indexOf('await onEnableWeighInReminder') < branch.indexOf('setMessages'),
        'the confirmation is shown before the write resolves',
      );
      assert.match(branch, /'coachChat\.weighIn\.blocked'/);
      assert.match(branch, /'coachChat\.weighIn\.failed'/);
      assert.match(chat, /onEnableWeighInReminder: \(\) => Promise<'on' \| 'blocked'>;/);

      const profile = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(
        profile,
        /void requestNotificationPermission\(preferences\.appLanguage\)\s*\.then\(\(granted\) =>\s*granted\s*\?[\s\S]{0,160}?updatePreferences\(\(current\) => \(\{ notificationPrefs: remindersOptedIn\(current\.notificationPrefs\) \}\)\)/,
      );
      assert.doesNotMatch(profile, /void requestNotificationPermission\(\);/);

      // Both languages carry both new replies.
      const i18n = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'i18n.ts'), 'utf8');
      for (const key of ['coachChat.weighIn.blocked', 'coachChat.weighIn.failed']) {
        assert.equal((i18n.match(new RegExp(`'${key.replace(/\./g, '\\.')}':`, 'g')) ?? []).length, 2, key);
      }
    },
  },
];
