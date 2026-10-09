const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\r\n/g, '\n');

/**
 * Bug hunt 9 (2026-10-09): the wiring half of the copy / session / today
 * cluster. The pure halves are in tests/lib/hunt9CopySession.
 */
module.exports = [
  {
    name: 'hunt 9 #13: the ready programme\'s first edit moves today\'s holds and pick onto the copy, from the commit on',
    run() {
      const hook = read('src/app/useProgramExerciseEdit.tsx');
      const app = read('App.tsx');
      assert.match(hook, /planHeldMovesToCopy\(\{/, 'the hook plans the move from the catalogue days to the copied ones');
      assert.match(hook, /moveHeldAdaptations\(moves\)/, 'and applies it');
      assert.match(hook, /movePickToCopy\(current\.todaySession, programId, workoutTemplateId, copiedDayIds\)/, 'and rewrites the pick');
      assert.match(hook, /draftRowOrigins\[sessionIndex\] = exercises\.map/, 'rows are matched by the catalogue row each came from');
      assert.ok(
        hook.indexOf('committed = true;') < hook.indexOf('moveHeldAdaptations(moves)'),
        'after the copy is the reader\'s programme, never before it can be taken back',
      );
      // The held swap the edit spends is the copy\'s now, not the catalogue\'s.
      assert.match(hook, /adaptSession\(\{ programId: workoutTemplateId, sessionId: copiedSessions\[dayIndex\]\.id \}/);
      assert.match(app, /moveHeldAdaptations: \(moves\) => setHeldSessionAdaptations\(\(held\) => moveHeldAdaptations\(held, moves\)\)/);
    },
  },
  {
    name: 'hunt 9 #59: both programme starts refuse a session with every lift left out, before the cardio guard and before anything is spent',
    run() {
      const ready = read('src/app/programmeStarts.tsx');
      const app = read('App.tsx');
      for (const [name, source] of [['programmeStarts', ready], ['App', app]]) {
        const refuse = source.indexOf('if (sessionHasNoExercises(runtimeTemplate))');
        assert.ok(refuse > 0, `${name} checks the adapted session`);
        const tail = source.slice(refuse);
        assert.match(tail.slice(0, 250), /showToast\(t\(preferences\.appLanguage, 'toast\.everyLiftDropped'\)\);\n\s+return;/);
        assert.ok(
          source.indexOf('guardStrengthStartOverCardio(() => {', refuse) > refuse,
          `${name}: the refusal comes before the guard, the start and the spend`,
        );
      }
    },
  },
  {
    name: 'hunt 9 #60: a landed backup restore clears the held swaps and drops, as Reset does',
    run() {
      const app = read('App.tsx');
      const restored = app.slice(app.indexOf('onRestored: async () => {'));
      const body = restored.slice(0, restored.indexOf('clearCoachAdviceMemory();'));
      assert.match(body, /setHeldSessionAdaptations\(NO_HELD_SESSION_ADAPTATIONS\);/);
    },
  },
  {
    name: 'hunt 9 #65: a free workout\'s board counts as a live strength session for the cardio conflict, both ways out of it',
    run() {
      const home = read('src/app/renderHomeScreens.tsx');
      const app = read('App.tsx');
      assert.match(home, /hasActiveStrengthSession=\{isWorkoutInProgress\(workout\.activeSession\) \|\| hasFreestyleBoard\}/);
      assert.match(home, /navigate\(\{ tab: 'workout', screen: 'empty' \}\)/, 'resume goes to the board');
      assert.match(home, /if \(hasFreestyleBoard\) \{\n\s+discardFreestyleBoard\(\);/, 'discard takes the board');
      assert.match(app, /hasFreestyleBoard: freestyleDraft != null,\n\s+discardFreestyleBoard: workout\.clearFreestyleDraft,/);
    },
  },
  {
    name: 'hunt 9 #16: the free workout\'s Finish saves under the stale-finish rule, from the board\'s last edit',
    run() {
      const screen = read('src/screens/EmptyWorkoutScreen.tsx');
      assert.match(screen, /resolveFreestyleLastEdit\(freestyleDraft, startedAtMs, Date\.now\(\)\)/);
      assert.match(screen, /const finish = resolveFreestyleFinish\(\{\n\s+startedAtMs,\n\s+lastEditMs: lastEditMsRef\.current \?\? Date\.now\(\),/);
      assert.match(screen, /performedAtIso: new Date\(finish\.performedAtMs\)\.toISOString\(\),\n\s+elapsedSeconds: finish\.elapsedSeconds,/);
      assert.doesNotMatch(screen, /performedAtIso: new Date\(\)\.toISOString\(\)/, 'the tap is no longer the end by itself');
    },
  },
  {
    name: 'hunt 9 #51: the screens that print a count pick the singular copy at one',
    run() {
      const pins = [
        ['src/screens/HistoryScreen.tsx', /group\.items\.length === 1 \? 'history\.browse\.metaOne' : 'history\.browse\.meta'/],
        ['src/screens/ExerciseDetailScreen.tsx', /history\?\.bestReps === 1 \? 'exDetail\.bestRepsOne' : 'exDetail\.bestReps'/],
        ['src/screens/SeasonScreen.tsx', /weeksLeft === 1 \? 'season\.weeksLeftOne' : 'season\.weeksLeft'/],
        ['src/app/renderAppShell.tsx', /'hevy\.doneWithDuplicatesOne'[\s\S]*'hevy\.doneOne'/],
        ['src/app/useSessionNotifications.ts', /completedSetCount === 1 \? 'rest\.notify\.idleBodyOne' : 'rest\.notify\.idleBody'/],
        ['src/screens/EmptyWorkoutScreen.tsx', /totalSetCount === 1 \? 'rest\.notify\.sessionBodyOne' : 'rest\.notify\.sessionBody'/],
        ['src/screens/GuidedPlayerScreen.tsx', /total === 1 \? 'rest\.notify\.sessionBodyOne' : 'rest\.notify\.sessionBody'/],
      ];
      for (const [file, pattern] of pins) {
        assert.match(read(file), pattern, file);
      }
    },
  },
  {
    name: 'hunt 9 #12: the receipt note and the Pro moment sheet\'s fine print follow whether payments are live',
    run() {
      const receipt = read('src/screens/PremiumUnlockScreen.tsx');
      const sheet = read('src/components/ProMomentSheet.tsx');
      assert.match(receipt, /paymentsAreLive\(isDemoBuild\(\), isStoreBillingConfigured\(\)\) \? null : \(\n\s+<Text style=\{styles\.receiptNote\}>\{t\(language, 'pro\.v3\.notice'\)\}/);
      assert.match(sheet, /paymentsAreLive\(isDemoBuild\(\), isStoreBillingConfigured\(\)\) \? 'pro\.sheet\.fineLive' : 'pro\.sheet\.fine'/);
    },
  },
];
