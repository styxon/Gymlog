const assert = require('node:assert/strict');

const {
  PROGRAM_INTAKE_STEPS,
  answerProgramIntake,
  buildProgramIntakeBrief,
  buildProgramIntakeFrame,
  currentProgramIntakeStep,
  programIntakeAnswerText,
  programIntakeOptions,
  programIntakePresetValue,
  startProgramIntake,
} = require('../../.test-dist/lib/programIntake.js');
const { parseProgrammeBrief } = require('../../.test-dist/lib/programmeBrief.js');
const { shouldOfferCatalogInstead } = require('../../.test-dist/lib/briefProgrammeMatch.js');

const BLANK_PREFERENCES = {
  aiPlannerGoal: null,
  aiPlannerDaysPerWeek: null,
  aiPlannerExperience: null,
  aiPlannerEquipment: null,
  setupGoal: null,
  setupDaysPerWeek: null,
  setupLevel: null,
  setupTrainingEnvironment: null,
  setupEquipment: null,
};

function answerAll(values, preferences = BLANK_PREFERENCES) {
  return values.reduce((state, value) => answerProgramIntake(state, value), startProgramIntake(preferences));
}

const GOAL_SIGNAL = { muscle: 'muscle', strength: 'strength', fat_loss: 'fat_loss', fitness: 'fitness' };
const EQUIPMENT_SIGNAL = { gym: 'full_gym', home_dumbbells: 'home_gym', bodyweight: 'bodyweight' };

module.exports = [
  {
    name: 'programIntake: the six questions come one at a time, in order, and then stop',
    run() {
      let state = startProgramIntake(BLANK_PREFERENCES);
      const seen = [];
      for (const value of ['strength', '3', '45', 'gym', 'beginner', '']) {
        seen.push(currentProgramIntakeStep(state));
        state = answerProgramIntake(state, value);
      }
      assert.deepEqual(seen, [...PROGRAM_INTAKE_STEPS]);
      assert.equal(currentProgramIntakeStep(state), null);
      // A tap after the end changes nothing.
      assert.equal(answerProgramIntake(state, 'muscle'), state);
    },
  },
  {
    name: 'programIntake: a value the open step does not offer is ignored, not written to another field',
    run() {
      const start = startProgramIntake(BLANK_PREFERENCES);
      // "3" is a days answer; tapped while the goal is open it must not land.
      assert.equal(answerProgramIntake(start, '3'), start);
      const afterGoal = answerProgramIntake(start, 'muscle');
      assert.equal(answerProgramIntake(afterGoal, '7'), afterGoal);
      assert.equal(answerProgramIntake(afterGoal, '1'), afterGoal);
      assert.equal(answerProgramIntake(afterGoal, 'gym'), afterGoal);
    },
  },
  {
    name: 'programIntake: the options are the ones the spec lists',
    run() {
      assert.deepEqual(programIntakeOptions('goal').map((o) => o.value), ['muscle', 'strength', 'fat_loss', 'fitness']);
      assert.deepEqual(programIntakeOptions('days').map((o) => o.value), ['2', '3', '4', '5', '6']);
      assert.deepEqual(programIntakeOptions('minutes').map((o) => o.value), ['30', '45', '60', '75']);
      assert.deepEqual(programIntakeOptions('equipment').map((o) => o.value), ['gym', 'home_dumbbells', 'bodyweight']);
      assert.deepEqual(programIntakeOptions('experience').map((o) => o.value), ['beginner', 'intermediate', 'advanced']);
      assert.deepEqual(programIntakeOptions('extra'), []);
    },
  },
  {
    name: 'programIntake: known answers are preselected, never answered on the reader\'s behalf',
    run() {
      const state = startProgramIntake({
        ...BLANK_PREFERENCES,
        setupGoal: 'muscle',
        setupDaysPerWeek: 5,
        setupLevel: 'pro',
        setupTrainingEnvironment: 'bodyweight_only',
      });
      assert.equal(currentProgramIntakeStep(state), 'goal');
      assert.equal(programIntakePresetValue(state, 'goal'), 'muscle');
      assert.equal(programIntakePresetValue(state, 'days'), '5');
      assert.equal(programIntakePresetValue(state, 'equipment'), 'bodyweight');
      assert.equal(programIntakePresetValue(state, 'experience'), 'advanced');
      // Session length is not stored anywhere the spec trusts: asked fresh.
      assert.equal(programIntakePresetValue(state, 'minutes'), null);
      assert.equal(programIntakePresetValue(state, 'extra'), null);
    },
  },
  {
    name: 'programIntake: the planner\'s own values win over onboarding, and one day presets nothing',
    run() {
      const state = startProgramIntake({
        ...BLANK_PREFERENCES,
        aiPlannerGoal: 'fat_loss',
        setupGoal: 'strength',
        aiPlannerDaysPerWeek: 1,
        setupDaysPerWeek: 4,
        aiPlannerEquipment: 'full_gym',
        setupEquipment: 'home',
        aiPlannerExperience: 'beginner',
        setupLevel: 'pro',
      });
      assert.equal(programIntakePresetValue(state, 'goal'), 'fat_loss');
      // 1 is not an option; it falls through to nothing rather than to onboarding's 4,
      // which is what the planner context reads too (aiPlannerDaysPerWeek ?? setup).
      assert.equal(programIntakePresetValue(state, 'days'), null);
      assert.equal(programIntakePresetValue(state, 'equipment'), 'gym');
      assert.equal(programIntakePresetValue(state, 'experience'), 'beginner');

      const blank = startProgramIntake(BLANK_PREFERENCES);
      for (const step of PROGRAM_INTAKE_STEPS) {
        assert.equal(programIntakePresetValue(blank, step), null, step);
      }
    },
  },
  {
    name: 'programIntake: every answer survives the round trip through the brief parser, in both languages',
    run() {
      for (const language of ['fi', 'en']) {
        for (const goal of programIntakeOptions('goal').map((o) => o.value)) {
          for (const days of ['2', '3', '4', '5', '6']) {
            for (const minutes of ['30', '45', '60', '75']) {
              for (const equipment of programIntakeOptions('equipment').map((o) => o.value)) {
                for (const experience of programIntakeOptions('experience').map((o) => o.value)) {
                  const state = answerAll([goal, days, minutes, equipment, experience, '']);
                  const brief = buildProgramIntakeBrief(state.answers, language);
                  const signals = parseProgrammeBrief(brief);
                  const label = `${language}: ${brief}`;
                  assert.equal(signals.goal, GOAL_SIGNAL[goal], label);
                  assert.equal(signals.sessionMinutes, Number(minutes), label);
                  assert.equal(signals.equipment, EQUIPMENT_SIGNAL[equipment], label);
                  assert.equal(signals.experience, experience, label);
                  // The composer's ceiling is four; five and six are read as asked.
                  assert.equal(signals.daysPerWeek, Math.min(4, Number(days)), label);
                  assert.equal(signals.requestedDaysPerWeek, Number(days) > 4 ? Number(days) : null, label);
                  // Nothing the frame said may read as a focus, a lift or a caution.
                  assert.deepEqual(signals.focusBodyParts, [], label);
                  assert.deepEqual(signals.lifts, [], label);
                  assert.deepEqual(signals.cautions, [], label);
                }
              }
            }
          }
        }
      }
    },
  },
  {
    name: 'programIntake: five or six days hand over to the catalog, as a typed brief would',
    run() {
      for (const days of ['5', '6']) {
        const state = answerAll(['muscle', days, '60', 'gym', 'intermediate', '']);
        assert.equal(shouldOfferCatalogInstead(parseProgrammeBrief(buildProgramIntakeBrief(state.answers, 'fi'))), true);
      }
      const four = answerAll(['muscle', '4', '60', 'gym', 'intermediate', '']);
      assert.equal(shouldOfferCatalogInstead(parseProgrammeBrief(buildProgramIntakeBrief(four.answers, 'fi'))), false);
    },
  },
  {
    name: 'programIntake: the free text goes last and is read like a typed brief',
    run() {
      const state = answerAll(['strength', '3', '45', 'gym', 'beginner', '  Polvi on kipeä,   penkki mukaan  ']);
      assert.equal(state.answers.extra, 'Polvi on kipeä, penkki mukaan');
      const brief = buildProgramIntakeBrief(state.answers, 'fi');
      assert.ok(brief.endsWith('Polvi on kipeä, penkki mukaan.'), brief);
      const signals = parseProgrammeBrief(brief);
      assert.ok(signals.cautions.includes('knee'), JSON.stringify(signals));
      // The tapped days, not a number in the free text.
      const withNumber = answerAll(['strength', '3', '45', 'gym', 'beginner', '5 kertaa olen loukannut olkapään']);
      assert.equal(parseProgrammeBrief(buildProgramIntakeBrief(withNumber.answers, 'fi')).daysPerWeek, 3);
      // Skipped: nothing added.
      const skipped = answerAll(['strength', '3', '45', 'gym', 'beginner', '   ']);
      assert.equal(skipped.answers.extra, '');
      assert.ok(buildProgramIntakeBrief(skipped.answers, 'fi').endsWith('Kokemus: alle vuosi.'));
    },
  },
  {
    name: 'programIntake: a word in the free text cannot outrank a tapped goal, place or experience',
    run() {
      const cases = [
        ['fi', 'haluan vahvat jalat, kuminauhat mukana, olen kokenut'],
        ['en', 'I want to get strong and lean, bands at home, beginner at squats'],
      ];
      for (const [language, extra] of cases) {
        const state = answerAll(['muscle', '3', '60', 'gym', 'intermediate', extra]);
        const signals = parseProgrammeBrief(buildProgramIntakeBrief(state.answers, language));
        assert.equal(signals.goal, 'muscle', extra);
        assert.equal(signals.equipment, 'full_gym', extra);
        assert.equal(signals.experience, 'intermediate', extra);
      }
      // Without the labels the parser behaves as it did for typed briefs:
      // priority over the whole text, and no experience read from prose.
      const typed = parseProgrammeBrief('3 päivää, lihasmassaa ja vahvat jalat, olen treenannut yli 3 vuotta');
      assert.equal(typed.goal, 'strength');
      assert.equal(typed.experience, null);
    },
  },
  {
    name: 'programIntake: a labelled experience is read only when it is unambiguous',
    run() {
      const read = (text) => parseProgrammeBrief(text).experience;
      assert.equal(read('Kokemus: alle vuosi.'), 'beginner');
      assert.equal(read('Experience: under a year.'), 'beginner');
      assert.equal(read('Kokemus: 1–3 vuotta.'), 'intermediate');
      assert.equal(read('Experience: 1-3 years.'), 'intermediate');
      assert.equal(read('Experience: 1—3 years.'), 'intermediate');
      assert.equal(read('Kokemus: yli 3 vuotta.'), 'advanced');
      assert.equal(read('Experience: over 3 years.'), 'advanced');
      assert.equal(read('Kokemus: 3+ vuotta.'), 'advanced');
      // More than ONE year, a negation, "over" inside a word: no signal, so
      // the stored level stands rather than a wrong one replacing it.
      assert.equal(read('Kokemus: yli vuoden.'), null);
      assert.equal(read('Kokemus: en ole kokenut.'), null);
      assert.equal(read('Experience: intermediate, discovered it late.'), null);
      assert.equal(read('Experience: over 30 years.'), null);
    },
  },
  {
    name: 'programIntake: the free-text answer meets the crisis rule before anything is built from it',
    run() {
      // The last answer never goes through send(), so the chat applies
      // send()'s first rule itself: a reader in trouble is answered offline,
      // and no build offer carries their words to the composer.
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'), 'utf8');
      const start = screen.indexOf('const answerIntake = useCallback(');
      assert.ok(start !== -1, 'the chat has an intake answer handler');
      const handler = screen.slice(start, screen.indexOf('setIntakeDraft(', start));
      const crisisAt = handler.indexOf("classifyCoachScope(value) === 'crisis'");
      const offerAt = handler.indexOf('buildProgramIntakeBrief(');
      assert.ok(crisisAt !== -1, 'the intake answer is classified');
      assert.ok(offerAt !== -1 && crisisAt < offerAt, 'the crisis check comes before the build offer');
      assert.ok(/crisisAnswer\s*\?/.test(handler), 'a crisis answer replaces the offer');
      const { classifyCoachScope } = require('../../.test-dist/lib/aiCoachScope.js');
      assert.equal(classifyCoachScope('mietin itsemurhaa'), 'crisis');
    },
  },
  {
    name: 'programIntake: the frame is one line of the answers',
    run() {
      const state = answerAll(['muscle', '3', '60', 'gym', 'intermediate', '']);
      assert.equal(buildProgramIntakeFrame(state.answers, 'fi'), 'Lihasmassa · 3 pv/vko · 60 min · Sali · 1–3 v');
      assert.equal(buildProgramIntakeFrame(state.answers, 'en'), 'Muscle · 3 d/wk · 60 min · Gym · 1–3 yrs');
      const long = answerAll(['fitness', '2', '75', 'home_dumbbells', 'advanced', 'polvi kipeä']);
      assert.equal(
        buildProgramIntakeFrame(long.answers, 'fi'),
        'Yleiskunto · 2 pv/vko · 75+ min · Koti (käsipainot) · Yli 3 v · polvi kipeä',
      );
      assert.ok(!buildProgramIntakeFrame(long.answers, 'fi').includes('\n'));
    },
  },
  {
    name: 'programIntake: the reader\'s bubble says the answer in words',
    run() {
      assert.equal(programIntakeAnswerText('days', '4', 'fi'), '4 päivää viikossa');
      assert.equal(programIntakeAnswerText('goal', 'fat_loss', 'fi'), 'Rasvanpudotus');
      assert.equal(programIntakeAnswerText('extra', '  ', 'fi'), 'Ohita');
      assert.equal(programIntakeAnswerText('extra', 'kyykky mukaan', 'en'), 'kyykky mukaan');
    },
  },
];
