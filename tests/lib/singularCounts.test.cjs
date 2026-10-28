const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { exportLogMetaLabel, planSessionMetaLabel, templateSetsRepsLabel } = require('../../src/lib/repCountCopy');

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
      const { setCountLabel } = require('../../src/lib/repCountCopy');
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
      const { t } = require('../../src/lib/i18n');
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
  {
    name: 'singular counts: training days, workouts, a recent row\'s exercises and programme counts of one (hunt 1.1.1 r2)',
    run() {
      const { countLabel } = require('../../src/lib/repCountCopy');
      // Missed by #440: "1 training days", "1 workouts", "1 exercises",
      // "1 days / week", "1 programs".
      const cases = [
        ['detail.trainingDaysOne', 'detail.trainingDays', {}, '1 training day', '1 treenipäivä', '3 training days'],
        ['detail.workoutCountOne', 'detail.workoutCount', {}, '1 workout', '1 treeni', '3 workouts'],
        ['tpl.exerciseOne', 'recent.exerciseCount', {}, '1 exercise', '1 liike', '3 exercises'],
        ['programs.card.daysOne', 'programs.card.days', {}, '1 day / week', '1 pv / viikko', '3 days / week'],
        ['programs.sheet.countOne', 'programs.sheet.count', { focus: 'Strength' }, '1 program · Strength', '1 ohjelma · Strength', '3 programs · Strength'],
      ];
      for (const [one, many, vars, en, fi, enMany] of cases) {
        assert.equal(countLabel(1, one, many, 'en', vars), en);
        assert.equal(countLabel(1, one, many, 'fi', vars), fi);
        assert.equal(countLabel(3, one, many, 'en', vars), enMany);
      }
      const wiring = [
        [['src', 'screens', 'ProgramDetailScreen.tsx'], /countLabel\(program\.daysPerWeek, 'detail\.trainingDaysOne'/],
        [['src', 'screens', 'ProgramDetailScreen.tsx'], /countLabel\(program\.sessions\.length, 'detail\.workoutCountOne'/],
        [['src', 'app', 'useRecentSessions.ts'], /countLabel\(completedExercises, 'tpl\.exerciseOne', 'recent\.exerciseCount'/],
        [['src', 'app', 'useRunningProgrammeViews.ts'], /countLabel\(days, 'programs\.card\.daysOne'/],
        [['src', 'app', 'useProgramsCustomItems.ts'], /countLabel\(template\.daysPerWeek, 'programs\.card\.daysOne'/],
        [['src', 'screens', 'ProgramsHomeScreen.tsx'], /countLabel\(item\.days, 'programs\.card\.daysOne'/],
        [['src', 'screens', 'ProgramsHomeScreen.tsx'], /countLabel\(items\.length, 'programs\.sheet\.countOne'/],
      ];
      for (const [file, pattern] of wiring) {
        assert.match(read(...file), pattern, file.join('/'));
      }
    },
  },
];
