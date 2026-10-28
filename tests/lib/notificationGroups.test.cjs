const assert = require('node:assert/strict');

const {
  NOTIFICATION_GROUPS,
  notificationGroupsFor,
  notificationGroupSummary,
  readNotificationGroup,
  rememberNotificationGroup,
  toggleNotificationGroup,
} = require('../../src/lib/notificationGroups');
const { buildFeedbackMailto } = require('../../src/lib/feedbackLink');
const { t } = require('../../src/lib/i18n');
const { DAILY_CAP_BY_LEVEL } = require('../../src/lib/notificationPlan');

/**
 * Ten switches in two flat lists became three groups (design "Vinha —
 * Settings, Notifications & My data", user 2026-09-03). The switches are the
 * same ones and write the same fields — that is the point of the suite.
 */
const prefs = (overrides = {}) => ({
  pushEnabled: true,
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
  ...overrides,
});

const group = (key) => NOTIFICATION_GROUPS.find((item) => item.key === key);
const everySwitch = () => NOTIFICATION_GROUPS.flatMap((item) => item.switches);

module.exports = [
  {
    /**
     * iOS hunt 2026-10-17, S6-4. iOS has no ongoing notification, so "Keep
     * session on lock screen" was a switch that did nothing, on by default;
     * and the 10-second warning is a silent notification there, not the
     * haptic tick the line promised.
     */
    name: 'notificationGroups: iOS shows only what it can send, and says what the warning is there',
    run() {
      assert.equal(notificationGroupsFor('android'), NOTIFICATION_GROUPS);
      const ios = notificationGroupsFor('ios');
      assert.equal(notificationGroupsFor('ios'), ios, 'built once');
      const workout = ios.find((item) => item.key === 'workout');
      assert.deepEqual(
        workout.switches.map((item) => item.key),
        ['restAlerts', 'restWarning', 'idleNudge'],
      );
      assert.equal(workout.switches.find((item) => item.key === 'restWarning').subKey, 'notif.rest.warningSubIos');
      assert.equal(t('en', 'notif.rest.warningSubIos'), 'A silent notification');
      assert.doesNotMatch(t('fi', 'notif.rest.warningSubIos'), /värinä/i);
      // The other groups are the same switches, and the shared list is untouched.
      assert.deepEqual(
        ios.filter((item) => item.key !== 'workout').map((item) => item.switches),
        NOTIFICATION_GROUPS.filter((item) => item.key !== 'workout').map((item) => item.switches),
      );
      assert.deepEqual(
        group('workout').switches.map((item) => item.key),
        ['restAlerts', 'restWarning', 'sessionOngoing', 'idleNudge'],
      );
      assert.equal(group('workout').switches[1].subKey, 'notif.rest.warningSub');

      // The group's summary and toggle read only what is shown, and a group
      // turned off on iOS leaves the hidden switch as it was stored.
      const stored = prefs({ restAlerts: false, restWarning: false, idleNudge: false, sessionOngoing: true });
      assert.equal(readNotificationGroup(workout, stored).isOn, false);
      const off = toggleNotificationGroup(workout, false, null);
      assert.equal('sessionOngoing' in off, false);
      assert.deepEqual(Object.keys(toggleNotificationGroup(workout, true, null)).sort(), ['idleNudge', 'restAlerts', 'restWarning']);
    },
  },
  {
    name: 'notificationGroups: the workout alerts are their own switch; the master governs what is scheduled',
    run() {
      // User decision 2026-09-17. The four workout switches were under the
      // master, which ships off — so the end-of-rest alert was silent on most
      // phones. Everything the planner schedules stays under it.
      assert.deepEqual(
        NOTIFICATION_GROUPS.map((item) => [item.key, item.scheduled]),
        [
          ['workout', false],
          ['wins', true],
          ['nudges', true],
        ],
      );
      assert.deepEqual(
        group('workout').switches.map((item) => item.key),
        ['restAlerts', 'restWarning', 'sessionOngoing', 'idleNudge'],
      );
      // And every switch the workout group owns ships on.
      assert.ok(group('workout').switches.every((item) => item.restoreDefault));
    },
  },
  {
    name: 'notificationGroups: three groups hold every switch the flat list had, each exactly once',
    run() {
      assert.deepEqual(NOTIFICATION_GROUPS.map((item) => item.key), ['workout', 'wins', 'nudges']);
      const keys = everySwitch().map((item) => item.key);
      assert.equal(new Set(keys).size, keys.length, 'a switch is in two groups');
      // The ten the screen shipped with: the four rest switches, the two
      // recaps, and the four reminders. Losing one here loses it from the UI.
      assert.deepEqual(keys.sort(), [
        'comebackNudge',
        'idleNudge',
        'measurement',
        'personalRecords',
        'restAlerts',
        'restWarning',
        'sessionOngoing',
        'sessionReminders',
        'weeklySummary',
        'weighInReminder',
      ]);
      // Every switch reads and writes its own field, and nothing else.
      for (const item of everySwitch()) {
        if (item.key === 'measurement') {
          continue;
        }
        assert.deepEqual(item.patch(true), { [item.key]: true }, `${item.key} writes elsewhere`);
        assert.equal(item.isOn(prefs({ [item.key]: true })), true);
        assert.equal(item.isOn(prefs({ [item.key]: false })), false);
      }
      // The measurement's kind IS its switch — there is no boolean to set.
      const measurement = everySwitch().find((item) => item.key === 'measurement');
      assert.deepEqual(measurement.patch(true), { measurementReminderKind: 'hips' });
      assert.deepEqual(measurement.patch(false), { measurementReminderKind: null });
      assert.equal(measurement.isOn(prefs({ measurementReminderKind: 'waist' })), true);
      assert.equal(measurement.isOn(prefs()), false);
    },
  },
  {
    name: 'notificationGroups: a group is on when any switch is, and the count is what the disclosure prints',
    run() {
      const all = readNotificationGroup(group('workout'), prefs());
      assert.equal(all.isOn, true);
      assert.equal(all.onCount, 4);
      assert.equal(all.total, 4);

      const some = readNotificationGroup(group('workout'), prefs({ restWarning: false, idleNudge: false }));
      assert.equal(some.isOn, true);
      assert.equal(some.onCount, 2);
      assert.deepEqual(some.onSwitches.map((item) => item.key), ['restAlerts', 'sessionOngoing']);

      const none = readNotificationGroup(
        group('workout'),
        prefs({ restAlerts: false, restWarning: false, sessionOngoing: false, idleNudge: false }),
      );
      assert.equal(none.isOn, false);
      assert.equal(none.onCount, 0);

      // The nudges group is off on a fresh install except the comeback nudge.
      assert.equal(readNotificationGroup(group('nudges'), prefs()).onCount, 1);
    },
  },
  {
    name: 'notificationGroups: the summary names what will be sent, and the blurb stands in when nothing will',
    run() {
      const en = (key, state) => notificationGroupSummary(group(key), state, 'en', t);
      assert.equal(en('workout', prefs()), 'Rest alerts · 10-second warning · Lock screen · Idle reminder');
      // The long title is shortened for the one line, not truncated by the view.
      assert.equal(en('workout', prefs({ restAlerts: false, restWarning: false, idleNudge: false })), 'Lock screen');
      assert.equal(en('wins', prefs({ weeklySummary: false })), 'Personal records');
      assert.equal(
        en('workout', prefs({ restAlerts: false, restWarning: false, sessionOngoing: false, idleNudge: false })),
        'The rest timer and the live session.',
      );

      const fi = (key, state) => notificationGroupSummary(group(key), state, 'fi', t);
      assert.equal(fi('wins', prefs()), 'Ennätykset · Viikkokooste');
      assert.equal(fi('nudges', prefs({ comebackNudge: false })), 'Ne harvat kerrat, kun me aloitamme keskustelun.');
    },
  },
  {
    name: 'notificationGroups: turning a group off remembers the switches, and turning it back on restores them',
    run() {
      const wins = group('wins');
      const before = prefs({ personalRecords: true, weeklySummary: false });
      const memo = rememberNotificationGroup(wins, before);
      assert.deepEqual(memo.on, { personalRecords: true, weeklySummary: false });
      assert.deepEqual(memo.values, { personalRecords: true, weeklySummary: false });

      const off = toggleNotificationGroup(wins, false, null);
      assert.deepEqual(off, { personalRecords: false, weeklySummary: false });

      // Restored, not lit up: the summary that stood before comes back.
      const restored = toggleNotificationGroup(wins, true, memo);
      assert.deepEqual(restored, { personalRecords: true, weeklySummary: false });

      // Nothing remembered (the screen was left in between) falls back to the
      // app's own defaults rather than leaving the group on with no switches.
      assert.deepEqual(toggleNotificationGroup(wins, true, null), { personalRecords: true, weeklySummary: true });
      // A memo where everything was off would do exactly that, so it is
      // treated as no memo at all.
      assert.deepEqual(
        toggleNotificationGroup(wins, true, { on: { personalRecords: false, weeklySummary: false }, values: {} }),
        { personalRecords: true, weeklySummary: true },
      );

      // The restore replays the STORED values, not "it was on": a boolean
      // memo turned a reader's waist reminder into hips (review 2026-09-03).
      const nudges = group('nudges');
      const chosen = prefs({ measurementReminderKind: 'waist', measurementReminderDay: 'wed', comebackNudge: false });
      const kindMemo = rememberNotificationGroup(nudges, chosen);
      assert.equal(kindMemo.values.measurementReminderKind, 'waist');
      assert.equal(kindMemo.values.measurementReminderDay, 'wed');
      const restoredKind = toggleNotificationGroup(nudges, true, kindMemo);
      assert.equal(restoredKind.measurementReminderKind, 'waist', 'the chosen kind was reset');
      assert.equal(restoredKind.measurementReminderDay, 'wed');
      assert.equal(restoredKind.comebackNudge, false, 'a switch the reader had off came back on');

      // The nudges group's defaults are the fresh install's, not "all on".
      assert.deepEqual(toggleNotificationGroup(group('nudges'), true, null), {
        sessionReminders: false,
        comebackNudge: true,
        weighInReminder: false,
        measurementReminderKind: null,
      });
      // Off clears the measurement's kind, which is how that one turns off.
      assert.deepEqual(toggleNotificationGroup(group('nudges'), false, null), {
        sessionReminders: false,
        comebackNudge: false,
        weighInReminder: false,
        measurementReminderKind: null,
      });
    },
  },
  {
    name: 'notificationGroups: the level copy is a promise the planner keeps, and rest alerts are outside it',
    run() {
      // "max 1 / 2 / 3 a day" is the real per-day cap, not a mood.
      assert.equal(DAILY_CAP_BY_LEVEL.quiet, 1);
      assert.equal(DAILY_CAP_BY_LEVEL.normal, 2);
      assert.equal(DAILY_CAP_BY_LEVEL.motivating, 3);
      for (const language of ['en', 'fi']) {
        // The rest-alert note follows this sentence on one line, so it has to
        // end like a sentence — otherwise the card reads "max 1 a day Rest
        // alerts are never counted".
        for (const key of ['notif.level.quietSub', 'notif.level.normalSub', 'notif.level.motivatingSub']) {
          assert.match(t(language, key), /\.$/, `${key} (${language}) does not end a sentence`);
        }
        assert.match(t(language, 'notif.level.quietSub'), /1/);
        assert.match(t(language, 'notif.level.normalSub'), /2/);
        assert.match(t(language, 'notif.level.motivatingSub'), /3/);
      }
      // And the note under them: no rest alert is scheduled by the planner, so
      // none of them is counted against the cap.
      const planned = require('../../src/lib/notificationPlan');
      const categories = ['record', 'comeback', 'reminder', 'weekly', 'weighIn', 'measure'];
      assert.equal(typeof planned.buildNotificationPlan, 'function');
      const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', '..', 'src', 'lib', 'notificationPlan.ts'),
        'utf8',
      );
      const declared = source.match(/export type NotificationCategory =([^;]+);/)[1];
      for (const category of categories) {
        assert.ok(declared.includes(`'${category}'`), `${category} is not a planned category`);
      }
      assert.doesNotMatch(declared, /rest|idle|ongoing/i, 'a rest alert became a planned, capped notification');
    },
  },
  {
    name: 'feedbackLink: Send feedback opens a mail draft to the support address',
    run() {
      const en = buildFeedbackMailto('en', '1.1.0');
      assert.match(en, /^mailto:support@vinha\.app\?subject=/);
      assert.equal(decodeURIComponent(en.split('subject=')[1]), 'Vinha feedback (v1.1.0)');
      // The version rides along: the first question about any report is which
      // build it came from.
      assert.equal(decodeURIComponent(buildFeedbackMailto('fi', '1.2.3').split('subject=')[1]), 'Vinha-palaute (v1.2.3)');
      // Encoded, so the subject's spaces and parens cannot break the URL.
      assert.equal(en.includes(' '), false);
    },
  },
];
