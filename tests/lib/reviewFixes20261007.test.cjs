const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseProgrammeBrief, briefAsksForSpecialty } = require('../../.test-dist/lib/programmeBrief.js');
const { buildProgramIntakeBrief } = require('../../.test-dist/lib/programIntake.js');
const { matchProgrammeToBrief } = require('../../.test-dist/lib/briefProgrammeMatch.js');
const { getRecommendationProgramDefinition } = require('../../.test-dist/lib/recommendationCatalog.js');
const { recommendPrograms } = require('../../.test-dist/lib/recommendationScoring.js');
const { buildRecommendationInput } = require('../../.test-dist/lib/recommendationInput.js');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
const { mergeStoredWorkoutLogs } = require('../../.test-dist/lib/emptyWorkoutSession.js');
const { effectiveSwapCategory } = require('../../.test-dist/lib/swapBrowsePrefilter.js');
const { listPickerExercises } = require('../../.test-dist/lib/exercisePicker.js');
const { exerciseTypeOf } = require('../../.test-dist/lib/exerciseClassification.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { minutesClockOnStep, stopwatchElapsedMs, stopwatchForSet } = require('../../.test-dist/lib/minutesExercises.js');

/**
 * The review of the 6.–7.10 merges (2026-10-07): each finding as the case
 * that showed it, and where it can be, as a rule over every answer.
 */

const intakeBrief = (answers, language = 'fi') =>
  buildProgramIntakeBrief({ goal: 'muscle', days: 3, minutes: 60, equipment: 'gym', experience: 'intermediate', extra: null, ...answers }, language);

module.exports = [
  {
    name: 'review 10-07: a lift the brief refuses is avoided, not forced into the week',
    run() {
      // The intake's last question is "anything else", and these are the
      // answers it invites. Each forced the refused lift in (#310).
      // The avoid term is matched inside library names, so it has to reach
      // the lift the composer would pick: "back squat" is in no name there.
      const refused = [
        ['ilman maastavetoa', 'Deadlift', 'Barbell Deadlift'],
        ['no deadlifts please', 'Deadlift', 'Barbell Deadlift'],
        ['Älä laita leuanvetoja', 'Pullups', 'Pullups'],
        ['I hate squats', 'Back Squat', 'Barbell Full Squat'],
        ['ei pystypunnerrusta', 'Overhead Press', 'Standing Military Press'],
        ['maastaveto pois', 'Deadlift', 'Barbell Deadlift'],
        ['Dippejä en halua', 'Dips - Triceps Version', 'Dips - Triceps Version'],
        ["don't want bench press", 'Bench Press', 'Barbell Bench Press - Medium Grip'],
      ];
      const names = GENERATED_EXERCISE_LIBRARY.map((item) => item.name);
      for (const [brief, lift, libraryName] of refused) {
        assert.ok(names.includes(libraryName), libraryName);
        const signals = parseProgrammeBrief(brief);
        assert.ok(!signals.lifts.includes(lift), `"${brief}" asked for ${lift}`);
        assert.ok(
          signals.avoidTerms.some((term) => libraryName.toLowerCase().includes(term)),
          `"${brief}" avoids ${signals.avoidTerms}, which miss ${libraryName}`,
        );
      }
      // Every lift the brief can name is avoidable by its library row.
      for (const lift of ['Bench Press', 'Back Squat', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Pullups', 'Hip Thrust', 'Leg Press', 'Pushups', 'Dips - Triceps Version']) {
        const index = findGuidedLibraryIndex(lift, names);
        assert.notEqual(index, null, lift);
      }
      // The requests still read as requests, the turn included.
      for (const [brief, lift] of [
        ['haluan maastavetoa', 'Deadlift'],
        ['Ei strongmania, vain penkkiä', 'Bench Press'],
        ['ei koneita vaan maastavetoa', 'Deadlift'],
        ['maastavetoa ei ole tehty, haluan oppia', 'Deadlift'],
        ['ilman maastavetoa. Lisää maastavetoa kuitenkin', 'Deadlift'],
        // Not done yet is not a refusal: the reader came to learn it.
        ['en ole tehnyt maastavetoa ja haluan oppia', 'Deadlift'],
        ['never done deadlifts but want to learn', 'Deadlift'],
        ['en osaa maastavetoa vielä', 'Deadlift'],
      ]) {
        const signals = parseProgrammeBrief(brief);
        assert.ok(signals.lifts.includes(lift), `"${brief}" lost ${lift}`);
        assert.ok(!signals.avoidTerms.includes(lift.toLowerCase()), `"${brief}" both asks for and avoids ${lift}`);
      }
      // Through the intake: the tapped answers and a refusal in the free text.
      const signals = parseProgrammeBrief(intakeBrief({ extra: 'ilman maastavetoa' }));
      assert.deepEqual(signals.lifts, []);
    },
  },
  {
    name: 'review 10-07: a specialty movement is asked for by its implement, in either language and any case',
    run() {
      for (const [brief, name] of [
        ['haluan atlas stone -nostoja', 'Atlas Stones'],
        ['Atlas-kiviä mukaan', 'Atlas Stones'],
        ['sledgehammer work', 'Sledgehammer Swings'],
        ['moukarilla lyöntejä', 'Sledgehammer Swings'],
        ['yoke carries', 'Yoke Walk'],
        ['tyre flips', 'Tire Flip'],
        ['renkaan kääntöä', 'Tire Flip'],
        ['tukin nostoa', 'Log Lift'],
        ['no problem with strongman, bring it', 'Yoke Walk'],
        ['ei haittaa strongman', 'Yoke Walk'],
        ['en pelkää strongmania', 'Yoke Walk'],
      ]) {
        assert.equal(briefAsksForSpecialty(brief, { name }), true, `"${brief}" did not ask for ${name}`);
      }
      for (const [brief, name] of [
        ['no tyre flips', 'Tire Flip'],
        ['ei renkaita', 'Tire Flip'],
        ['ilman koneita ja strongmania', 'Yoke Walk'],
        ['strongman pois', 'Yoke Walk'],
        ['3 päivää, sali', 'Atlas Stones'],
        // An implement the brief names does not ask for another one.
        ['tyre flips', 'Yoke Walk'],
      ]) {
        assert.equal(briefAsksForSpecialty(brief, { name }), false, `"${brief}" asked for ${name}`);
      }
    },
  },
  {
    name: 'review 10-07: the programme opened in place of the build is one the reader can run, at the days and goal they asked',
    run() {
      const level = { beginner: 'beginner', intermediate: 'advanced', advanced: 'pro' };
      const offenders = [];
      for (const goal of ['strength', 'muscle', 'fat_loss', 'fitness']) {
        for (const days of [5, 6]) {
          for (const equipment of ['gym', 'home_dumbbells', 'bodyweight']) {
            for (const experience of ['beginner', 'intermediate', 'advanced']) {
              for (const language of ['fi', 'en']) {
                const signals = parseProgrammeBrief(intakeBrief({ goal, days, equipment, experience }, language));
                const match = matchProgrammeToBrief(signals);
                if (!match) continue;
                const program = getRecommendationProgramDefinition(match.programId);
                const label = `${goal} ${days}d ${equipment} ${experience} ${language} -> ${match.programId}`;
                if (!program.supportedLevels.includes(level[experience])) offenders.push(`${label}: level`);
                if (equipment !== 'gym' && program.equipmentTier !== 'low_equipment') offenders.push(`${label}: gym programme`);
                if (program.daysPerWeek !== days) offenders.push(`${label}: ${program.daysPerWeek} days`);
                if (!match.matched.goal) offenders.push(`${label}: goal`);
              }
            }
          }
        }
      }
      assert.deepEqual(offenders, []);
      // The case that showed it: a beginner at home with nothing, five days.
      const beginner = parseProgrammeBrief(intakeBrief({ days: 5, minutes: 30, equipment: 'bodyweight', experience: 'beginner' }));
      assert.equal(matchProgrammeToBrief(beginner), null, 'no five-day programme fits; the composer builds and says so');
      // And the goals the catalog names differently are matched at all.
      for (const goal of ['fat_loss', 'fitness']) {
        const signals = parseProgrammeBrief(intakeBrief({ goal, days: 6, equipment: 'gym', experience: 'advanced' }));
        assert.ok(matchProgrammeToBrief(signals)?.matched.goal, `${goal} matched no programme's goal`);
      }
    },
  },
  {
    name: 'review 10-07: the featured programme is never also the second card, whatever the tailoring',
    run() {
      const cards = [
        { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'] },
        { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench', 'Dumbbells'] },
        { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells', 'Bench'] },
        { equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
      ];
      const offenders = [];
      for (const card of cards) {
        for (const goal of ['strength', 'muscle', 'lean_athletic', 'general_fitness']) {
          for (const level of ['beginner', 'advanced', 'pro']) {
            for (const daysPerWeek of [2, 3, 4, 5, 6]) {
              for (const freeWeights of ['neutral', 'prefer', 'avoid']) {
                const selection = { ...DEFAULT_FIRST_RUN_SELECTION, ...card, goal, goals: [goal], level, daysPerWeek, gender: 'unspecified', focusAreas: [], secondaryOutcomes: [], cautionFlags: [], weeklyMinutes: null };
                const result = recommendPrograms(buildRecommendationInput(selection), {
                  setupEquipment: selection.equipment,
                  setupFreeWeightsPreference: freeWeights,
                  setupBodyweightPreference: 'neutral',
                  setupMachinesPreference: freeWeights,
                  setupShoulderFriendlySwaps: 'neutral',
                  setupElbowFriendlySwaps: 'neutral',
                  setupKneeFriendlySwaps: 'neutral',
                });
                const label = `${card.trainingEnvironment} ${goal} ${level} ${daysPerWeek}d ${freeWeights}`;
                if (result.alternativeProgramIds.includes(result.featuredProgramId)) offenders.push(`${label}: featured is an alternative`);
                if (result.waterfall && result.waterfall.alternativeProgramId === result.waterfall.primaryProgramId) offenders.push(`${label}: waterfall twice`);
              }
            }
          }
        }
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'review 10-07: a stored minutes row put back on its own keeps its unit',
    run() {
      // "Spinning" is off the minutes list, so only the stored unit says its
      // 30 is minutes; the re-merge dropped it and re-saved 30 reps.
      const stored = [
        {
          id: 'log_1',
          sessionId: 'session_a',
          exerciseTemplateId: null,
          exerciseNameSnapshot: 'Spinning Class',
          orderIndex: 0,
          tracked: false,
          skipped: false,
          sessionInserted: true,
          status: 'completed',
          slotId: 'spin',
          repsUnit: 'minutes',
          sets: [{ orderIndex: 0, weight: 0, reps: 30, kind: 'working', outcome: 'completed', status: 'completed', completedAt: '2026-10-07T09:30:00.000Z' }],
        },
      ];
      const merged = mergeStoredWorkoutLogs(stored, []);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].repsUnit, 'minutes');
      // A row in reps stays in reps.
      const reps = mergeStoredWorkoutLogs([{ ...stored[0], repsUnit: undefined }], []);
      assert.equal(reps[0].repsUnit, undefined);
    },
  },
  {
    name: 'review 10-07: a stretch\'s swap opens on stretches, every other lift on all types',
    run() {
      const library = GENERATED_EXERCISE_LIBRARY;
      const childsPose = library.find((item) => item.name === "Child's Pose");
      const bench = library.find((item) => item.name === 'Barbell Bench Press - Medium Grip');
      assert.ok(childsPose && bench);
      assert.equal(effectiveSwapCategory(null, childsPose, ''), 'stretch');
      assert.equal(effectiveSwapCategory(null, bench, ''), 'all');
      // Typing searches every type; a chip the reader moved is theirs.
      assert.equal(effectiveSwapCategory(null, childsPose, 'squat'), 'all');
      assert.equal(effectiveSwapCategory('all', childsPose, ''), 'all');
      assert.equal(effectiveSwapCategory(null, null, ''), 'all');
      // And under that chip the list is stretches, not chin-ups.
      const listed = listPickerExercises(library, {
        filters: { category: effectiveSwapCategory(null, childsPose, ''), bodyPart: 'all', equipment: 'all' },
        language: 'fi',
      });
      assert.ok(listed.length > 0);
      assert.ok(listed.every((item) => exerciseTypeOf(item) === 'stretch'), 'a non-stretch under the stretch chip');

      // Both swap sheets read it: Home and the programme day through the
      // hook, the guided player on its own.
      // The default narrows the library, not the programme's own cards: a
      // core slot filed as a stretch (Vacuum) kept none of its four.
      for (const [file, pick] of [['src/hooks/useSwapPickerLists.ts', 'categoryPick'], ['src/screens/GuidedPlayerScreen.tsx', 'swapCategoryPick']]) {
        const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
        assert.match(source, /category: effectiveSwapCategory\(/, `${file} does not open a stretch on stretches`);
        assert.ok(
          source.includes(`category: ${pick} ?? 'all' })`) && /narrowSwapAlternatives\(\w+, \{ \.\.\.\w+, category: \w+ \?\? 'all' \}\)/.test(source),
          `${file}: the default chip narrows the cards`,
        );
      }
    },
  },
  {
    name: 'review 10-07: the live composer takes the equipment and experience the reader tapped over the stored context',
    run() {
      const server = fs.readFileSync(path.join(__dirname, '../../api/ai-coach.ts'), 'utf8');
      const composer = server.slice(server.indexOf('const COMPOSER_SYSTEM_RULES'), server.indexOf('const AI_COACH_RESPONSE_SCHEMA'));
      assert.doesNotMatch(composer, /Only equipment the context says the user has\.'/);
      assert.match(composer, /what the brief says \("Where:" \/ "Paikka:"\)/);
      assert.match(composer, /\("Experience:" \/ "Kokemus:"\)/);
      // The labels the rule names are the ones the intake writes.
      for (const [language, where, experience] of [['en', 'Where:', 'Experience:'], ['fi', 'Paikka:', 'Kokemus:']]) {
        const brief = intakeBrief({ equipment: 'home_dumbbells', experience: 'beginner' }, language);
        assert.ok(brief.includes(where) && brief.includes(experience), `${language}: ${brief}`);
      }
    },
  },
  {
    name: "review 10-07: leaving a bout's step without logging it pauses the clock, and coming back carries on from there",
    run() {
      const start = Date.parse('2026-10-07T09:00:00.000Z');
      const bike = { slotId: 'bike', setIndex: 0, exerciseName: 'Stationary Bike (Easy Pace)' };
      const running = { ...bike, plannedMinutes: 20, accumulatedMs: 0, runningSinceMs: start };
      const fiveIn = start + 5 * 60000;
      const hourLater = start + 60 * 60000;

      // Still on the step: the clock is the same clock, counting.
      assert.equal(minutesClockOnStep(running, bike, fiveIn), running);
      // Stepped on to the next lift five minutes in: paused at five.
      const left = minutesClockOnStep(running, { slotId: 'squat', setIndex: 0, exerciseName: 'Back Squat' }, fiveIn);
      assert.notEqual(left, running);
      assert.equal(left.runningSinceMs, null);
      assert.equal(left.accumulatedMs, 5 * 60000);
      assert.equal(left.slotId, 'bike');
      assert.equal(left.plannedMinutes, 20);
      // A rest or walk-up step is leaving too.
      assert.equal(minutesClockOnStep(running, null, fiveIn).runningSinceMs, null);
      // The same slot's next set, or a swapped-in bout, is another set.
      assert.equal(minutesClockOnStep(running, { ...bike, setIndex: 1 }, fiveIn).runningSinceMs, null);
      assert.equal(minutesClockOnStep(running, { ...bike, exerciseName: 'Rowing, Stationary' }, fiveIn).runningSinceMs, null);

      // Back an hour later: five minutes ridden, not sixty-five, and paused.
      const back = stopwatchForSet(minutesClockOnStep(left, bike, hourLater), bike);
      assert.equal(stopwatchElapsedMs(back, hourLater), 5 * 60000);
      assert.equal(back.runningSinceMs, null);

      // A stopped clock and no clock come back as they were.
      assert.equal(minutesClockOnStep(left, null, hourLater), left);
      assert.equal(minutesClockOnStep(null, bike, hourLater), null);

      // The player asks when the set on screen changes — a move, not the
      // step a mount opens on, so a reopened session's clock keeps running
      // (#337).
      const player = fs.readFileSync(path.join(__dirname, '../../src/screens/GuidedPlayerScreen.tsx'), 'utf8');
      const effect = player.slice(player.indexOf('const lastShownSetKeyRef = useRef(shownSetKey);'), player.indexOf('}, [shownSetKey]);'));
      assert.ok(effect.length > 0, 'the leave-pauses effect is gone');
      assert.match(effect, /if \(lastShownSetKeyRef\.current === shownSetKey\) \{\s*return;\s*\}/);
      assert.match(effect, /const next = minutesClockOnStep\(\s*clock,/);
      assert.match(effect, /if \(next !== clock\) \{\s*workout\.setMinutesClock\(next\);/);
    },
  },
];
