const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { exportLogMetaLabel, planSessionMetaLabel, templateSetsRepsLabel } = require('../../.test-dist/lib/repCountCopy.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * Count lines with a count of one (hunt 1.1.1): a one-exercise plan day read
 * "1 exercises · 3 sets", a one-set custom row "1 sets · 8-12 reps" and
 * "1 sarjaa", and an export of one workout "1 sessions". The numeral 1 takes
 * the singular in English and the nominative in Finnish.
 */
module.exports = [
  {
    name: 'singular counts: sets, reps, exercises and sessions of one read in the singular, in both languages',
    run() {
      assert.equal(templateSetsRepsLabel(1, '8-12', 'en'), '1 set · 8-12 reps');
      assert.equal(templateSetsRepsLabel(1, '1', 'en'), '1 set · 1 rep');
      assert.equal(templateSetsRepsLabel(3, '1', 'en'), '3 sets · 1 rep');
      assert.equal(templateSetsRepsLabel(3, '8-12', 'en'), '3 sets · 8-12 reps');
      assert.equal(templateSetsRepsLabel(1, '8-12', 'fi'), '1 sarja · 8-12 toistoa');
      assert.equal(templateSetsRepsLabel(1, '1', 'fi'), '1 sarja · 1 toisto');
      assert.equal(templateSetsRepsLabel(4, '10', 'fi'), '4 sarjaa · 10 toistoa');

      assert.equal(planSessionMetaLabel(1, 3, 'en'), '1 exercise · 3 sets');
      assert.equal(planSessionMetaLabel(5, 1, 'en'), '5 exercises · 1 set');
      assert.equal(planSessionMetaLabel(1, 1, 'fi'), '1 liike · 1 sarja');
      assert.equal(planSessionMetaLabel(5, 15, 'fi'), '5 liikettä · 15 sarjaa');

      assert.equal(exportLogMetaLabel(1, 3, 'en'), '1 session · 3 sets');
      assert.equal(exportLogMetaLabel(12, 140, 'en'), '12 sessions · 140 sets');
      assert.equal(exportLogMetaLabel(1, 1, 'fi'), '1 treeni · 1 sarja');
      assert.equal(exportLogMetaLabel(2, 9, 'fi'), '2 treeniä · 9 sarjaa');

      // Set counts on their own: the recent-session row, the guided start card, the emphasis sheet (second re-check).
      const { setCountLabel } = require('../../.test-dist/lib/repCountCopy.js');
      assert.equal(setCountLabel(1, 'en'), '1 set');
      assert.equal(setCountLabel(1, 'fi'), '1 sarja');
      assert.equal(setCountLabel(12, 'fi'), '12 sarjaa');
    },
  },
  {
    name: 'singular counts wiring: the plan day and the log export lines go through the counted helpers',
    run() {
      assert.match(read('src', 'screens', 'TrainingPlanScreen.tsx'), /planSessionMetaLabel\(session\.exerciseCount, session\.totalSets, language\)/);
      assert.match(read('src', 'screens', 'ExportPlanScreen.tsx'), /exportLogMetaLabel\(logSummary\.sessions, logSummary\.sets, language\)/);
      // The coach's header line: "Reads your 1 logged session".
      assert.match(read('src', 'screens', 'AICoachChatScreen.tsx'), /sessionCount === 1\s*\? t\(language, 'coachChat\.subtitleOne'\)/);
      const { t } = require('../../.test-dist/lib/i18n.js');
      assert.equal(t('en', 'coachChat.subtitleOne'), 'Reads your 1 logged session');
      assert.equal(t('fi', 'coachChat.subtitleOne'), 'Lukee 1 kirjatun treenisi');
      assert.equal(t('fi', 'coachChat.open.loggedOne'), '1 treeni kirjattu tällä viikolla. Kysy siitä mitä vain.');
      assert.equal(t('en', 'coachPreview.lastSession.setsOne'), '1 set logged');
      for (const file of [['src', 'app', 'useRecentSessions.ts'], ['src', 'lib', 'guidedPlayer.ts'], ['src', 'screens', 'GuidedPlayerScreen.tsx'], ['src', 'components', 'EmphasisSheet.tsx']]) {
        assert.match(read(...file), /setCountLabel\(/, file.join('/'));
      }
      assert.match(read('src', 'lib', 'coachChat.ts'), /sessionsThisWeek === 1\s*\? t\(language, 'coachChat\.open\.loggedOne'\)/);
      assert.match(read('src', 'lib', 'aiCoachPreview.ts'), /setsCompleted === 1\s*\? t\(language, 'coachPreview\.lastSession\.setsOne'\)/);
    },
  },
];
