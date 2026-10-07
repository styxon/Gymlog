const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const { matchProgrammeToBrief } = require(path.join(DIST, 'lib', 'briefProgrammeMatch.js'));
const { composeProgrammePreview, parseProgrammeBrief, resolveLiveProposal } = require(path.join(DIST, 'lib', 'programmeBrief.js'));
const { buildProgramIntakeBrief } = require(path.join(DIST, 'lib', 'programIntake.js'));
const { getRecommendationProgramDefinition } = require(path.join(DIST, 'lib', 'recommendationCatalog.js'));
const { getExerciseTemplateDefaults } = require(path.join(DIST, 'lib', 'exerciseSuggestions.js'));
const { displayEquipmentValue } = require(path.join(DIST, 'lib', 'libraryLabel.js'));
const { createSeedDatabase, createSeedExerciseLibrary } = require(path.join(DIST, 'data', 'seed.js'));

/**
 * The catalog shortcut answers the reader's gear and level: what the brief
 * says, and where it is silent, what the stored profile says — the same
 * merge the composers use (applyBriefToPreferences). A gym reader whose
 * brief avoided a lift was sent to a home bodyweight, calisthenics or
 * mobility-flow week because every gym programme held it (re-hunt,
 * 2026-10-07). And a live week is dosed in each lift's own unit.
 */

const library = createSeedExerciseLibrary();
const seed = createSeedDatabase().preferences;
const profile = (patch) => ({ ...seed, ...patch });
const gymAdvanced = profile({ setupEquipment: 'gym', setupLevel: 'advanced' });

const intakeBrief = (answers, language = 'fi') =>
  buildProgramIntakeBrief({ goal: 'muscle', days: 5, minutes: 60, equipment: 'gym', experience: 'intermediate', extra: null, ...answers }, language);

function tierOf(match) {
  return match ? getRecommendationProgramDefinition(match.programId).equipmentTier : null;
}

module.exports = [
  {
    name: 'brief match: a gym reader whose brief avoids a lift gets a gym programme or the composer, never a home or mobility week',
    run() {
      const offenders = [];
      const extras = [null, 'Olkapää kipeä', 'Ei maastavetoa', 'No deadlifts', 'Selkä kipeä', 'Polvi kipeä', 'ilman leuanvetoja'];
      for (const goal of ['strength', 'muscle', 'fat_loss', 'fitness']) {
        for (const days of [5, 6]) {
          for (const experience of ['beginner', 'intermediate', 'advanced']) {
            for (const extra of extras) {
              for (const language of ['fi', 'en']) {
                const brief = intakeBrief({ goal, days, experience, extra }, language);
                // Whatever the stored profile says: the brief said the gym.
                for (const stored of [seed, gymAdvanced, profile({ setupEquipment: 'minimal', setupLevel: 'beginner' })]) {
                  const match = matchProgrammeToBrief(parseProgrammeBrief(brief), stored);
                  if (match && tierOf(match) !== 'full_gym') offenders.push(`${goal} ${days}d ${experience} ${extra} ${language} -> ${match.programId}`);
                }
              }
            }
          }
        }
      }
      assert.deepEqual(offenders.slice(0, 8), [], `${offenders.length} gym briefs opened a low-equipment programme`);

      // The finding's typed briefs: the gym is named, the avoid empties the gym programmes.
      for (const brief of ['6 days a week at the gym, no deadlifts', '5 päivää viikossa salilla, olkapää kipeä']) {
        const match = matchProgrammeToBrief(parseProgrammeBrief(brief), gymAdvanced);
        assert.ok(match === null || tierOf(match) === 'full_gym', `${brief} -> ${match?.programId}`);
      }
      // A gym profile and a silent brief is a gym reader too.
      for (const brief of ['5 päivää viikossa, olkapää kipeä', '6 päivää viikossa, ei maastavetoa', '5 days a week, no deadlifts']) {
        const match = matchProgrammeToBrief(parseProgrammeBrief(brief), gymAdvanced);
        assert.ok(match === null || tierOf(match) === 'full_gym', `${brief} -> ${match?.programId}`);
      }
      // With nothing kept out, the gym reader still gets the gym programme.
      assert.equal(matchProgrammeToBrief(parseProgrammeBrief('6 päivää lihasmassaa'), gymAdvanced)?.programId, 'tpl_6_day_ppl_v1');
    },
  },
  {
    name: 'brief match: where the brief is silent on gear and level, the stored profile decides; what it says wins',
    run() {
      const silent = parseProgrammeBrief('5 päivää viikossa, lihasmassa');
      assert.equal(silent.equipment, null);
      assert.equal(silent.experience, null);

      // Stored at home with dumbbells: no barbell programme.
      const home = profile({ setupEquipment: 'minimal', setupLevel: 'advanced' });
      const atHome = matchProgrammeToBrief(silent, home);
      assert.ok(atHome === null || tierOf(atHome) === 'low_equipment', `home profile -> ${atHome?.programId}`);
      // Stored bodyweight-only through the planner's own answer.
      const bodyweight = profile({ aiPlannerEquipment: 'bodyweight', setupLevel: 'advanced' });
      assert.equal(matchProgrammeToBrief(silent, bodyweight), null, 'no five-day muscle programme runs on bodyweight alone');
      // Stored beginner: no programme a beginner cannot run.
      const beginner = matchProgrammeToBrief(silent, profile({ setupEquipment: 'gym', setupLevel: 'beginner' }));
      assert.ok(
        beginner === null || getRecommendationProgramDefinition(beginner.programId).supportedLevels.includes('beginner'),
        `beginner profile -> ${beginner?.programId}`,
      );

      // The brief overrides the stored gear and level.
      const said = parseProgrammeBrief('5 päivää viikossa, lihasmassa. Paikka: sali. Kokemus: yli 3 vuotta.');
      const overridden = matchProgrammeToBrief(said, profile({ aiPlannerEquipment: 'bodyweight', setupLevel: 'beginner' }));
      assert.equal(tierOf(overridden), 'full_gym', `the brief's gym and level win -> ${overridden?.programId}`);

      // The composer reads the same merge: a silent brief keeps the stored bodyweight gear, a named gym replaces it.
      const allowed = new Set(['bodyweight']);
      const week = composeProgrammePreview('3 päivää viikossa, lihasmassa', bodyweight, library);
      const gear = week.sessions.flatMap((session) =>
        session.exercises.map((exercise) => displayEquipmentValue(library.find((item) => item.id === exercise.libraryItemId))),
      );
      assert.ok(gear.length > 0);
      assert.deepEqual(gear.filter((value) => !allowed.has(value)), [], 'the stored bodyweight-only profile holds');
      const gym = composeProgrammePreview('3 päivää viikossa salilla, lihasmassa', bodyweight, library);
      assert.ok(
        gym.sessions.some((session) =>
          session.exercises.some((exercise) => displayEquipmentValue(library.find((item) => item.id === exercise.libraryItemId)) !== 'bodyweight'),
        ),
        'the brief\'s gym wins over the stored bodyweight',
      );

      // The chat hands the stored profile to the match.
      const chat = fs.readFileSync(path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'), 'utf8');
      assert.match(chat, /matchProgrammeToBrief\(signals, preferences\)/);
      const home2 = fs.readFileSync(path.join(__dirname, '../../src/app/renderHomeScreens.tsx'), 'utf8');
      assert.match(home2, /<AICoachChatScreen[\s\S]*?\n\s+preferences=\{preferences\}/);
    },
  },
  {
    name: 'live proposal: a hold is dosed in seconds and a cardio machine as one bout, by the add sheet\'s own defaults',
    run() {
      const raw = {
        title: 'Week',
        sessions: [
          {
            name: 'Day 1',
            exercises: [
              { name: 'Plank', sets: 3, repsMin: 10, repsMax: 15 },
              { name: 'Hamstring Stretch', sets: 2, repsMin: 12, repsMax: 12, restSeconds: 30 },
              { name: 'Elliptical Trainer', sets: 3, repsMin: 10, repsMax: 12, restSeconds: 60 },
              { name: 'Barbell Bench Press', sets: 3, repsMin: 8, repsMax: 10 },
            ],
          },
        ],
      };
      const proposal = resolveLiveProposal(raw, '3 päivää viikossa', library, 90, gymAdvanced);
      const rows = Object.fromEntries(proposal.sessions[0].exercises.map((exercise) => [exercise.name, exercise]));
      const defaults = (name) => getExerciseTemplateDefaults(library.find((item) => item.name === name), 90);

      // Seconds: the model's sets and rest, the add sheet's hold.
      const plank = defaults('Plank');
      assert.deepEqual(
        [rows.Plank.sets, rows.Plank.repsMin, rows.Plank.repsMax, rows.Plank.restSeconds],
        [3, plank.repMin, plank.repMax, 90],
      );
      assert.ok(plank.repMin >= 30, 'a hold of seconds, not of the model\'s reps');
      const stretch = defaults('Hamstring Stretch');
      assert.deepEqual(
        [rows['Hamstring Stretch'].sets, rows['Hamstring Stretch'].repsMin, rows['Hamstring Stretch'].repsMax, rows['Hamstring Stretch'].restSeconds],
        [2, stretch.repMin, stretch.repMax, 30],
      );
      // Minutes: one bout, no rest — the model's "3 x 10-12" is not minutes.
      const elliptical = defaults('Elliptical Trainer');
      assert.deepEqual(
        [rows['Elliptical Trainer'].sets, rows['Elliptical Trainer'].repsMin, rows['Elliptical Trainer'].repsMax, rows['Elliptical Trainer'].restSeconds],
        [elliptical.targetSets, elliptical.repMin, elliptical.repMax, elliptical.restSeconds],
      );
      assert.deepEqual([elliptical.targetSets, elliptical.restSeconds], [1, 0]);
      // Reps stay the model's.
      const bench = rows['Barbell Bench Press - Medium Grip'];
      assert.deepEqual([bench.sets, bench.repsMin, bench.repsMax, bench.restSeconds], [3, 8, 10, 90]);
    },
  },
];
