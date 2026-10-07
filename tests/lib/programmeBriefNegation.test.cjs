const assert = require('node:assert/strict');

const {
  briefAsksForSpecialty,
  composeProgrammePreview,
  parseProgrammeBrief,
  resolveLiveProposal,
} = require('../../.test-dist/lib/programmeBrief.js');
const { matchProgrammeToBrief, shouldOfferCatalogInstead } = require('../../.test-dist/lib/briefProgrammeMatch.js');
const { buildProgramIntakeBrief } = require('../../.test-dist/lib/programIntake.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { programFitsEquipment } = require('../../.test-dist/lib/programEquipmentFit.js');
const { displayEquipmentValue } = require('../../.test-dist/lib/libraryLabel.js');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog.js');
const { createSeedDatabase, createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');

const preferences = createSeedDatabase().preferences;
const library = createSeedExerciseLibrary();

/** Every exercise name in a composed week. */
function weekNames(proposal) {
  return proposal.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name));
}

/** Every exercise name in a ready programme. */
function programmeNames(programId) {
  return getWorkoutTemplateById(programId).sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
}

/**
 * The bug hunt of 2026-10-07 (findings 16–22): the brief parser read a
 * refusal outside its three-word window as a request, a pain word anywhere in
 * a comma-joined sentence as pain for all of it, negated goals, places and
 * body parts as asked for, "5x5" as five days — and the catalog shortcut
 * opened a ready programme holding the very lift the brief kept out.
 *
 * One row per brief. `lifts` is the exact ask; `refused` are lifts that must
 * be on the avoid list; `focus` / `cautions` exact; `goal`, `equipment`,
 * `days` exact when given.
 */
const TABLE = [
  // Refusals, the long way round (#18).
  { brief: "I don't want to do deadlifts", lifts: [], refused: ['deadlift'] },
  { brief: 'I do not want deadlifts in my programme', lifts: [], refused: ['deadlift'] },
  { brief: 'En todellakaan halua tehdä maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'En halua maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'En tee maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'En pysty tekemään kyykkyä', lifts: [], refused: ['back squat'] },
  { brief: 'Vältän maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'Jätä pois maastaveto', lifts: [], refused: ['deadlift'] },
  { brief: 'Poista maastaveto ohjelmasta', lifts: [], refused: ['deadlift'] },
  { brief: 'Maastavetoa ei saa olla', lifts: [], refused: ['deadlift'] },
  { brief: 'Maastaveto ei sovi minulle', lifts: [], refused: ['deadlift'] },
  { brief: 'Penkkiä ei', lifts: [], refused: ['bench press'] },
  { brief: 'Ilman leuanvetoja', lifts: [], refused: ['pull-up'] },
  { brief: 'Älä laita pystypunnerrusta', lifts: [], refused: ['overhead press'] },
  { brief: 'Please leave out deadlifts', lifts: [], refused: ['deadlift'] },
  { brief: 'Leave the deadlifts out', lifts: [], refused: ['deadlift'] },
  { brief: 'bench press is not for me', lifts: [], refused: ['bench press'] },
  { brief: "I can't squat", lifts: [], refused: ['back squat'] },
  { brief: 'I cannot do pull-ups', lifts: [], refused: ['pull-up'] },
  { brief: 'Never any deadlifts please', lifts: [], refused: ['deadlift'] },
  { brief: 'Avoid overhead press', lifts: [], refused: ['overhead press'] },
  { brief: 'I hate dips', lifts: [], refused: ['dips'] },
  { brief: 'Without deadlifts', lifts: [], refused: ['deadlift'] },
  { brief: 'Kyykky ei onnistu polven takia', lifts: [], refused: ['back squat'], focus: [] },
  // …and what is NOT a refusal (#339 fix 1 stays fixed).
  { brief: 'En ole tehnyt maastavetoa, haluan oppia', lifts: ['Deadlift'] },
  { brief: 'Never done deadlifts, want to learn', lifts: ['Deadlift'] },
  { brief: "I've never tried squats and I want to learn them", lifts: ['Back Squat'] },
  { brief: 'No problem with deadlifts', lifts: ['Deadlift'] },
  { brief: 'Ei haittaa vaikka maastavetoa on paljon', lifts: ['Deadlift'] },
  { brief: 'Haluan maastavetoa ja kyykkyä', lifts: ['Back Squat', 'Deadlift'] },
  { brief: 'I want deadlifts, not bench', lifts: ['Deadlift'], refused: ['bench press'] },
  { brief: 'En halua koneita ja haluan maastavetoa', lifts: ['Deadlift'] },
  // Pain, clause by clause, and negated pain (#21).
  { brief: 'Sore knee, keep the bench press', lifts: ['Bench Press'], cautions: ['knee'] },
  { brief: 'Polvi kipeä, penkki mukaan', lifts: ['Bench Press'], cautions: ['knee'] },
  { brief: 'Olkapää kipeä, ei maastavetoa', lifts: [], cautions: ['shoulder'], refused: ['deadlift', 'overhead press'] },
  { brief: 'Polvi kipeä, ei kyykkyä', lifts: [], cautions: ['knee'], refused: ['back squat'] },
  { brief: 'No injuries, I want deadlifts', lifts: ['Deadlift'], cautions: [] },
  { brief: 'No injuries, knees are fine', cautions: [], focus: [] },
  { brief: 'No shoulder pain', cautions: [], focus: [] },
  { brief: 'Ei polvikipuja', cautions: [], focus: [] },
  { brief: 'Polvi ei ole kipeä', cautions: [] },
  { brief: 'Polvi, olkapää ja selkä kipeitä', cautions: ['knee', 'back', 'shoulder'], focus: [] },
  { brief: 'Olkapää kipeä, varsinkin penkissä', lifts: [], cautions: ['shoulder'] },
  { brief: 'Knee hurts.', cautions: ['knee'] },
  // Goals, places and body parts named only to rule them out (#22).
  { brief: 'I want to build muscle, not lose weight', goal: 'muscle' },
  { brief: "Strength, I'm not trying to cut", goal: 'strength' },
  { brief: 'Voimaohjelma, ei rasvanpudotusta', goal: 'strength' },
  { brief: 'Haluan voimaa, en pudottaa painoa', goal: 'strength' },
  { brief: 'Haluan pudottaa painoa', goal: 'fat_loss' },
  { brief: 'No gym access', equipment: null },
  { brief: '3 days, no gym', equipment: null, days: 3 },
  { brief: "I don't have a gym membership, only dumbbells", equipment: 'minimal' },
  { brief: 'Salilla', equipment: 'full_gym' },
  { brief: 'Kotisali, käsipainot ja tanko', equipment: 'home_gym' },
  { brief: 'Where: at home, dumbbells.', equipment: 'minimal' },
  { brief: 'Paikka: kotona, käsipainot.', equipment: 'minimal' },
  { brief: 'no leg day', focus: [] },
  { brief: 'skip legs', focus: [] },
  { brief: 'Ilman jalkatreeniä', focus: [] },
  { brief: 'Ei jalkapäivää', focus: [] },
  { brief: 'Älä keskity rintaan', focus: [] },
  { brief: 'Rinta painopisteenä', focus: ['chest'] },
  { brief: 'Legs and glutes, please', focus: ['legs', 'glutes'] },
  // Sets by reps are not days (#17).
  { brief: 'Haluan 5x5 voimaohjelman, 3 päivää viikossa', days: 3, goal: 'strength' },
  { brief: 'I want to try StrongLifts 5x5, three days a week', days: 3 },
  { brief: 'Voimaohjelma 5x5, 3 päivää viikossa', days: 3 },
  { brief: 'Penkki 3x10, 4 päivää viikossa', days: 4, lifts: ['Bench Press'] },
  { brief: '3x viikossa', days: 3 },
  { brief: '4x a week, 45 min', days: 4 },
  { brief: '10 päivää kuukaudessa', days: null },
  { brief: '12 days of rest then 3 days a week', days: 3 },
  // A count with a day unit outranks a bare "2 kertaa" before it.
  { brief: 'Penkkiä 2 kertaa, treeniä 4 päivää viikossa', days: 4 },
];

/** Whether the lift named by a canonical avoid term is kept out. */
function avoids(signals, term) {
  return signals.avoidTerms.includes(term);
}

module.exports = [
  {
    name: 'brief negation: every row of the FI+EN table reads as the reader meant it',
    run() {
      assert.ok(TABLE.length >= 40, `${TABLE.length} rows`);
      const failures = [];
      for (const row of TABLE) {
        const signals = parseProgrammeBrief(row.brief);
        const check = (label, actual, expected) => {
          try {
            assert.deepEqual(actual, expected);
          } catch {
            failures.push(`"${row.brief}" ${label}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
          }
        };
        if (row.lifts) check('lifts', [...signals.lifts].sort(), [...row.lifts].sort());
        for (const term of row.refused ?? []) check(`avoids ${term}`, avoids(signals, term), true);
        if (row.focus) check('focus', signals.focusBodyParts, row.focus);
        if (row.cautions) check('cautions', [...signals.cautions].sort(), [...row.cautions].sort());
        if ('goal' in row) check('goal', signals.goal, row.goal);
        if ('equipment' in row) check('equipment', signals.equipment, row.equipment);
        if ('days' in row) check('days', signals.daysPerWeek, row.days);
      }
      assert.deepEqual(failures, []);
    },
  },
  {
    // #18: the refused lift reached the composed week as a main lift.
    name: 'brief negation: a refused lift stays out of the composed week, in either language',
    run() {
      for (const brief of [
        "3 days a week. I don't want to do deadlifts.",
        '3 päivää viikossa. En todellakaan halua tehdä maastavetoa.',
        '3 päivää viikossa. Jätä pois maastaveto.',
      ]) {
        const names = weekNames(composeProgrammePreview(brief, preferences, library));
        assert.ok(!names.includes('Barbell Deadlift'), `${brief}: ${names.join(', ')}`);
      }
      // A lift asked for in the clause after a pain is in the week (#21).
      const kept = composeProgrammePreview('3 days a week. Sore knee, keep the deadlift.', preferences, library);
      assert.deepEqual(kept.signals.lifts, ['Deadlift']);
      assert.ok(weekNames(kept).includes('Barbell Deadlift'), weekNames(kept).join(', '));
      // Negated pain does not strip the lift the reader asked for.
      const press = composeProgrammePreview('3 days a week. No shoulder pain, I want overhead press.', preferences, library);
      assert.deepEqual(press.signals.cautions, []);
      assert.deepEqual(press.unmetLifts, []);
    },
  },
  {
    // #19: the live path's specialty safety net failed open on these.
    name: 'brief negation: a specialty refusal however phrased leaves the movement out of a live answer',
    run() {
      const raw = {
        title: 'Week',
        sessions: [
          {
            name: 'Day 1',
            exercises: [
              { name: 'Tire Flip', sets: 3, repsMin: 3, repsMax: 5 },
              { name: 'Yoke Walk', sets: 3, repsMin: 3, repsMax: 5 },
              { name: 'Barbell Full Squat', sets: 4, repsMin: 5, repsMax: 5 },
            ],
          },
        ],
      };
      for (const brief of [
        "3 days a week. I don't want to do any strongman stuff",
        'En halua tehdä mitään erikoisliikkeitä',
        'Vältä erikoisliikkeitä',
        'Jätä pois erikoisliikkeet',
        'Leave out the strongman stuff',
        'Erikoisliikkeet eivät kiinnosta',
        'Basic lifts only, nothing like tire flips',
      ]) {
        const proposal = resolveLiveProposal(raw, brief, library, 120);
        assert.deepEqual(proposal.specialtyLeftOut, ['Tire Flip', 'Yoke Walk'], brief);
      }
      // A request is still a request.
      assert.equal(briefAsksForSpecialty('I want to try tire flips', { name: 'Tire Flip' }), true);
      assert.equal(briefAsksForSpecialty('haluan strongman-treeniä', { name: 'Yoke Walk' }), true);
    },
  },
  {
    // #16: 'home_gym' carries a barbell; "Koti (käsipainot)" composed a barbell week.
    name: 'brief negation: the intake answer "home, dumbbells" composes no barbell, machine or cable work',
    run() {
      const byId = new Map(library.map((item) => [item.id, item]));
      const offenders = [];
      for (const language of ['fi', 'en']) {
        for (const goal of ['muscle', 'strength', 'fat_loss', 'fitness']) {
          for (const days of [2, 3, 4, 5, 6]) {
            const brief = buildProgramIntakeBrief(
              { goal, days, minutes: 60, equipment: 'home_dumbbells', experience: 'intermediate', extra: null },
              language,
            );
            const proposal = composeProgrammePreview(brief, preferences, library);
            assert.equal(proposal.signals.equipment, 'minimal', brief);
            for (const session of proposal.sessions) {
              for (const exercise of session.exercises) {
                const gear = displayEquipmentValue(byId.get(exercise.libraryItemId));
                if (gear === 'barbell' || gear === 'machine' || gear === 'cable') {
                  offenders.push(`${language} ${goal} ${days}d: ${exercise.name} (${gear})`);
                }
              }
            }
          }
        }
      }
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} heavy-gear picks`);
    },
  },
  {
    // #17: "5x5 … 3 päivää" opened a five-day ready programme in place of the build.
    name: 'brief negation: a sets-by-reps brief for three days is built, not swapped for a five-day programme',
    run() {
      for (const brief of ['Voimaohjelma 5x5, 3 päivää viikossa', '5x5 strength programme, 3 days a week', 'Penkki 5x5, 2 päivää viikossa']) {
        const signals = parseProgrammeBrief(brief);
        assert.equal(signals.requestedDaysPerWeek, null, brief);
        assert.equal(shouldOfferCatalogInstead(signals), false, brief);
      }
    },
  },
  {
    /**
     * #20: the catalog shortcut never opens a ready programme holding a lift
     * the brief keeps out, needing gear the reader does not have, or running
     * more days than asked. Nothing left is an answer: the composer builds
     * the week and honours the avoid list.
     */
    name: 'brief negation: the catalog match never opens a programme holding an avoided lift, missing gear or extra days',
    run() {
      const violations = [];
      const extras = [
        '',
        ', olkapää kipeä',
        ', ei maastavetoa',
        ', selkä kipeä, ei maastavetoa',
        ', no deadlifts, no overhead press',
        ", I don't want to do squats",
        ', polvi kipeä',
        ', ilman leuanvetoja',
      ];
      const places = ['', ' Paikka: kotona, käsipainot.', ' Where: bodyweight only, no equipment.', ' Where: the gym.'];
      for (const days of [5, 6]) {
        for (const extra of extras) {
          for (const place of places) {
            for (const goal of ['', ' Goal: build muscle.', ' Tavoite: voima.']) {
              const brief = `${days} päivää viikossa${extra}.${place}${goal}`;
              const signals = parseProgrammeBrief(brief);
              const match = matchProgrammeToBrief(signals);
              if (!match) {
                continue;
              }
              const names = programmeNames(match.programId).map((name) => name.toLowerCase());
              const hit = names.find((name) => signals.avoidTerms.some((term) => name.includes(term)));
              if (hit) violations.push(`${brief} → ${match.programId} holds ${hit}`);
              if (match.daysPerWeek !== days) violations.push(`${brief} → ${match.programId} runs ${match.daysPerWeek} days`);
              if (signals.equipment === 'minimal' && !programFitsEquipment(match.programId, ['Dumbbells', 'Resistance bands'])) {
                violations.push(`${brief} → ${match.programId} needs more than dumbbells`);
              }
              if (signals.equipment === 'bodyweight' && !programFitsEquipment(match.programId, [])) {
                violations.push(`${brief} → ${match.programId} needs equipment`);
              }
            }
          }
        }
      }
      assert.deepEqual(violations.slice(0, 10), [], `${violations.length} violations`);

      // The finding's own briefs: each opened a programme with the avoided lift.
      for (const brief of ['5 päivää viikossa, olkapää kipeä', '6 päivää viikossa, ei maastavetoa', '5 days a week, no deadlifts, no overhead press']) {
        const signals = parseProgrammeBrief(brief);
        assert.ok(signals.avoidTerms.length > 0, brief);
        const match = matchProgrammeToBrief(signals);
        assert.ok(!['tpl_5_day_hybrid_v1', 'tpl_6_day_ppl_v1'].includes(match?.programId), `${brief} → ${match?.programId}`);
      }
      // A sore shoulder keeps out the presses overhead by any of their names.
      for (const brief of ['5 päivää viikossa, olkapää kipeä', '5 days a week, my shoulder hurts', '6 päivää viikossa, olkapää kipeä']) {
        const match = matchProgrammeToBrief(parseProgrammeBrief(brief));
        const overhead = match ? programmeNames(match.programId).filter((name) => /overhead|shoulder press|seated dumbbell press|arnold|push press|thruster|military/i.test(name)) : [];
        assert.deepEqual(overhead, [], `${brief} → ${match?.programId}`);
      }
      // A refused squat keeps out the catalog's "Back Squat", not only the library's names.
      for (const brief of ['5 päivää viikossa, ei kyykkyä', "6 days a week, I don't want to do squats"]) {
        const match = matchProgrammeToBrief(parseProgrammeBrief(brief));
        const squats = match ? programmeNames(match.programId).filter((name) => /back squat/i.test(name)) : [];
        assert.deepEqual(squats, [], `${brief} → ${match?.programId}`);
      }
      // Every five- and six-day home programme runs on dumbbells today, so the
      // gear rule is held on one that does not: a pull-up bar programme is no
      // answer to "home, dumbbells".
      const calisthenics = RECOMMENDATION_PROGRAMS.filter((definition) => definition.programId === 'tpl_gainer_calisthenics_mastery_v1');
      assert.equal(calisthenics.length, 1);
      const plain = parseProgrammeBrief('4 päivää viikossa. Tavoite: lihasmassa.');
      assert.equal(matchProgrammeToBrief({ ...plain, equipment: 'bodyweight' }, calisthenics), null);
      assert.equal(
        matchProgrammeToBrief(parseProgrammeBrief('4 päivää viikossa. Tavoite: lihasmassa. Paikka: kotona, käsipainot.'), calisthenics),
        null,
      );
      assert.equal(matchProgrammeToBrief(plain, calisthenics)?.programId, 'tpl_gainer_calisthenics_mastery_v1');
      // With nothing kept out, the shortcut still answers.
      assert.equal(matchProgrammeToBrief(parseProgrammeBrief('6 päivää lihasmassaa')).programId, 'tpl_6_day_ppl_v1');
      assert.ok(RECOMMENDATION_PROGRAMS.length > 0);
    },
  },
  {
    // #22: "not trying to lose weight" opened the shred programme.
    name: 'brief negation: a goal named only to rule it out does not pick the catalog programme',
    run() {
      const signals = parseProgrammeBrief('5 days a week, build muscle, not trying to lose weight');
      assert.equal(signals.goal, 'muscle');
      assert.notEqual(matchProgrammeToBrief(signals)?.programId, 'tpl_shred_elite_v1');
      assert.equal(parseProgrammeBrief('5 päivää viikossa, voimaa, ei rasvanpudotusta').goal, 'strength');
    },
  },
];
