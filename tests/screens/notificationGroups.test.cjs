const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const screen = read('src', 'screens', 'NotificationsScreen.tsx');
const settings = read('src', 'screens', 'SettingsScreen.tsx');
const profile = read('src', 'screens', 'ProfileScreen.tsx');
const tab = read('src', 'app', 'renderProfileTab.tsx');
const i18n = read('src', 'lib', 'i18n.ts');

/** Slices between two anchors, failing loudly when one is missing. */
function between(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

/**
 * Settings / Notifications / My data (design 2026-09-03). Settings and My data
 * are marked unchanged in the design except for one row; the work is the
 * Notifications restructure.
 */
module.exports = [
  {
    name: 'notifications: the flat lists are gone and the three groups render from the lib',
    run() {
      // The two old section labels and their hand-rolled arrays.
      assert.doesNotMatch(screen, /REST_TOGGLES|TRAINING_TOGGLES/);
      assert.doesNotMatch(screen, /'notif\.rest\.section'|'notif\.training'/);
      // The platform's groups: iOS drops what it cannot send (iOS hunt
      // 2026-10-17, S6-4; lib/notificationGroups notificationGroupsFor).
      assert.match(screen, /const groups = notificationGroupsFor\(Platform\.OS\);/);
      assert.match(screen, /const workoutGroups = groups\.filter\(\(group\) => !group\.scheduled\);/);
      assert.match(screen, /const scheduledGroups = groups\.filter\(\(group\) => group\.scheduled\);/);
      assert.doesNotMatch(screen, /NOTIFICATION_GROUPS/);
      assert.match(screen, /workoutGroups\.map\(renderGroup\)/);
      assert.match(screen, /scheduledGroups\.map\(renderGroup\)/);
      assert.match(screen, /<SectionLabel label=\{t\(language, 'notif\.section\.what'\)\} \/>/);
      assert.match(screen, /<SectionLabel label=\{t\(language, 'notif\.section\.workout'\)\} \/>/);
      // The reading, the summary and the toggle all come from the lib rather
      // than being recomputed in the view.
      assert.match(screen, /readNotificationGroup\(group, prefs\)/);
      assert.match(screen, /notificationGroupSummary\(group, prefs, language, t\)/);
      assert.match(screen, /toggleNotificationGroup\(group, next, next \? memos\[group\.key\] \?\? null : null\)/);
      assert.match(screen, /rememberNotificationGroup\(group, prefs\)/);
    },
  },
  {
    name: 'notifications: every switch is still reachable, one tap in, and still writes its own field',
    run() {
      // Details opens the same switches; the row toggle writes the switch's
      // own patch, not a group-level guess.
      assert.match(screen, /group\.switches\.map\(\(item, index\) =>/);
      assert.match(screen, /onChange=\{\(next\) => handleSwitchToggle\(group, item, next\)\}/);
      assert.match(screen, /onChange\(item\.patch\(next\)\)/);
      assert.match(screen, /value=\{governed && item\.isOn\(prefs\)\}/);
      // Turning off the last switch by hand empties the group, which closes
      // the card — so it remembers first, or the next group-on would restore
      // the defaults over the reader's own choices.
      const emptying = between(screen, 'const handleSwitchToggle', 'const remindersWithoutDays');
      assert.match(emptying, /readNotificationGroup\(group, prefs\)\.onCount === 1 && item\.isOn\(prefs\)/);
      assert.match(emptying, /rememberNotificationGroup\(group, prefs\)/);
      assert.match(screen, /'notif\.group\.details'/);
      assert.match(screen, /'notif\.group\.hide'/);
      // The pickers that belong to a switch moved with it.
      assert.match(screen, /item\.key === 'sessionReminders' && prefs\.sessionReminders/);
      assert.match(screen, /item\.key === 'measurement' && measureKind/);
      assert.match(screen, /'notif\.noDaysTitle'/);
      assert.match(screen, /REMINDER_TIMES\.map/);
      assert.match(screen, /MEASUREMENT_REMINDER_KINDS\.map/);
      assert.match(screen, /WEEKDAY_KEYS\.map/);
    },
  },
  {
    name: 'notifications: the master and a break gate the scheduled groups; the workout alerts answer to their own switch',
    run() {
      // The permission rules for the master are untouched.
      assert.match(screen, /const effectiveEnabled = prefs\.pushEnabled && !onTrainingBreak/);
      assert.match(screen, /void requestPermission\(\)\.then\(\(granted\) => \{/);
      assert.match(screen, /onChange\(\{ pushEnabled: granted \}\)/);
      assert.match(screen, /checkPermission\(\)\.then\(\(granted\) => \{/);
      assert.match(screen, /pointerEvents=\{effectiveEnabled \? 'auto' : 'none'\}/);
      // A scheduled card reads off during a break or with the master off, like
      // the switches inside it; the workout card does not (user 2026-09-17).
      assert.match(screen, /const governed = group\.scheduled \? effectiveEnabled : true;/);
      assert.match(screen, /const groupOn = governed && reading\.isOn/);
      assert.match(screen, /'notif\.breakNote'/);
      // The workout card sits above the master, outside the dimmed area.
      const layout = between(screen, 'contentContainerStyle={styles.body}', "t(language, 'notif.footer')");
      assert.ok(
        layout.indexOf('workoutGroups.map(renderGroup)') < layout.indexOf("t(language, 'notif.push')"),
        'the workout alerts are rendered under the master again',
      );
      assert.ok(layout.indexOf('workoutGroups.map(renderGroup)') < layout.indexOf('styles.dimmable'));
      assert.ok(layout.indexOf('scheduledGroups.map(renderGroup)') > layout.indexOf('styles.dimmable'));
      // The copy stops promising that the master silences everything.
      for (const key of ['notif.pushOff', 'notif.breakNote', 'notif.footer']) {
        const rows = i18n.split('\n').filter((row) => row.includes(`'${key}':`));
        assert.equal(rows.length, 2, key);
        for (const row of rows) {
          assert.doesNotMatch(row, /everything|kaikki/i, `${key} still says the master silences everything`);
        }
      }
    },
  },
  {
    name: 'notifications: the workout card says when the phone keeps its alerts quiet, and offers the way out',
    run() {
      const access = between(screen, 'const renderWorkoutAccess', 'const renderGroup');
      assert.match(access, /access !== null && access !== 'granted' && allowWorkoutAlerts/);
      assert.match(access, /onPress=\{\(\) => void allowWorkoutAlerts\(\)\.then\(setAccess\)\}/);
      assert.match(access, /access === 'granted' && prefs\.restAlerts && exactAllowed === false && onAllowExactAlarms/);
      assert.match(access, /onPress=\{onAllowExactAlarms\}/);
      assert.match(screen, /\{!group\.scheduled && groupOn \? renderWorkoutAccess\(\) : null\}/);
      // Read again on the way back from system settings.
      assert.match(screen, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) \{\s*readWorkoutAccess\(\);/);
      // Wired to the real checks, as stable functions the effect can depend on.
      assert.match(tab, /allowWorkoutAlerts=\{allowWorkoutAlerts\}/);
      assert.match(tab, /checkExactAlarms=\{canScheduleExactAlarms\}/);
      assert.match(tab, /onAllowExactAlarms=\{allowExactAlarms\}/);
      assert.match(tab, /async function allowWorkoutAlerts\(\): Promise<NotificationAccessState> \{\s*if \(\(await getRestAlertPermission\(\)\) === 'denied'\) \{\s*await Linking\.openSettings\(\)/);
    },
  },
  {
    name: 'notifications: a rest-alert channel switched off in Android settings names the channel, not "not allowed"',
    run() {
      // Native audit, 2026-09-21: the card read the app-wide permission only,
      // so a reader who muted "Rest alerts" in system settings was told
      // nothing while every alert was dropped. #bugs, 2026-09-26: once the
      // card DID read the channel, it still said the same "phone has not
      // allowed notifications" a refused permission gets, and its "Allow"
      // button opened the app's general settings rather than the channel's
      // own page. The channel read itself is tested in
      // tests/utils/sessionNotifications.test.cjs; this is the wiring.
      const read = between(screen, 'const readWorkoutAccess = useCallback(', '}, [');
      assert.match(read, /void checkWorkoutAlerts\?\.\(\)\.then\(\(result\) => \{/);
      assert.match(read, /setAccess\(result\)/);
      assert.doesNotMatch(read, /checkPermission/, 'the card reads the permission alone again');
      assert.match(tab, /checkWorkoutAlerts=\{getRestAlertAccessState\}/);
      // Turning the master on reads the card's answer rather than assuming it.
      const master = between(screen, 'const handleMasterChange', 'const handleGroupToggle');
      assert.doesNotMatch(master, /setAccess\(granted\)/);
      assert.match(master, /readWorkoutAccess\(\);/);
      // The card names which of the two states it is in.
      const access = between(screen, 'const renderWorkoutAccess', 'const renderGroup');
      assert.match(access, /const channelMuted = access === 'channelMuted';/);
      assert.match(access, /'notif\.workout\.channelMutedTitle', \{ channel: t\(language, 'notif\.rest\.alerts'\) \}/);
      assert.match(access, /'notif\.workout\.channelMutedBody'/);
      // Allow cannot unmute a channel with a dialog: it opens the channel's
      // OWN settings page, not the app's general one, and says "not yet" so
      // the card stays until the channel is back on.
      const allow = between(tab, 'async function allowWorkoutAlerts', 'function allowExactAlarms');
      assert.match(
        allow,
        /if \(await isRestAlertChannelBlocked\(\)\) \{\s*await openRestAlertChannelSettings\(\);\s*return 'channelMuted';\s*\}\s*return 'granted';/,
      );
      assert.match(tab, /openRestAlertChannelSettings,/);
      // Both languages carry the new copy.
      assert.equal((i18n.match(/'notif\.workout\.channelMutedTitle':/g) ?? []).length, 2);
      assert.equal((i18n.match(/'notif\.workout\.channelMutedBody':/g) ?? []).length, 2);
    },
  },
  {
    name: 'notifications: the level is one segmented control, not three radio rows',
    run() {
      assert.match(screen, /import \{ Seg \} from '\.\.\/components\/Seg'/);
      const level = between(screen, "t(language, 'notif.howMuch')", "styles.footer");
      assert.match(level, /<Seg\s+grow/);
      assert.match(level, /value=\{prefs\.level\}/);
      assert.match(level, /onChange=\{\(next\) => onChange\(\{ level: next \}\)\}/);
      assert.match(level, /'notif\.level\.restNote'/);
      // The hand-built radio is gone.
      assert.doesNotMatch(screen, /RadioDot|radioOuter|radioInner/);
    },
  },
  {
    name: 'settings: Rate Vinha leaves the About card for Send feedback, and keeps its place on the Profile',
    run() {
      const about = between(settings, "t(language, 'settings.section.about')", "'settings.section.dangerZone'");
      assert.match(about, /'settings\.feedback'/);
      assert.match(about, /buildFeedbackMailto\(language, appInfo\.version\)/);
      assert.doesNotMatch(about, /settings\.rate|onOpenRating/);
      // The star is not gone from the app — the Profile still offers it.
      assert.match(profile, /t\(language, 'settings\.rate'\)/);
      assert.match(tab, /onOpenRating=\{\(\(\) => \{[\s\S]*?return \(\) => setRatingSheetVisible\(true\);/);
      // And Settings no longer asks for a prop it does not use.
      assert.doesNotMatch(settings, /onOpenRating/);
      // The rating row's subtitle went with it rather than lingering unused.
      assert.equal(i18n.includes("'settings.rate.sub'"), false);
      // Both languages carry the new row.
      assert.equal((i18n.match(/'settings\.feedback':/g) ?? []).length, 2);
      assert.equal((i18n.match(/'notif\.group\.workout':/g) ?? []).length, 2);
    },
  },
];
