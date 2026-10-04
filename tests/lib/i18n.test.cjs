const assert = require('node:assert/strict');

const { t, I18N_KEYS, SUPPORTED_LANGUAGES } = require('../../.test-dist/lib/i18n.js');

module.exports = [
  {
    // "Pidä tämä puhelin" read as keeping the device (user, 2026-09-16). The
    // button names the data, and the question says the other copy goes.
    name: 'i18n: restore-or-keep names the data it keeps, and says the other is replaced',
    run() {
      assert.equal(t('fi', 'account.restore.keepLocal'), 'Käytä puhelimen tietoja');
      assert.equal(t('en', 'account.restore.keepLocal'), 'Use the data on this phone');
      assert.match(t('fi', 'account.restore.body'), /Kumpi pidetään\? Toinen korvataan\.$/);
      assert.match(t('en', 'account.restore.body'), /Which one do you keep\? The other is replaced\.$/);
    },
  },
  {
    name: 'i18n: every English key has a Finnish translation and neither renders empty',
    run() {
      assert.ok(I18N_KEYS.length >= 12, 'key list should cover at least the Welcome surface');

      for (const key of I18N_KEYS) {
        assert.ok(t('en', key).length > 0, `en missing ${key}`);
        assert.ok(t('fi', key).length > 0, `fi missing ${key}`);
      }

      // Spot checks: translations are real, not copies of the English text.
      assert.equal(t('en', 'common.cancel'), 'Cancel');
      assert.equal(t('fi', 'common.cancel'), 'Peruuta');
      assert.notEqual(t('fi', 'brand.tagline'), t('en', 'brand.tagline'));
      assert.notEqual(t('fi', 'home.startWorkout'), t('en', 'home.startWorkout'));
    },
  },
  {
    name: 'i18n: templates interpolate {name} vars in both languages',
    run() {
      assert.equal(t('en', 'home.hero.sessionsProgress', { done: 2, total: 8 }), '2 sessions logged');
      assert.equal(t('fi', 'home.hero.sessionsProgress', { done: 2, total: 8 }), '2 treeniä kirjattu');
      assert.equal(
        t('en', 'home.section.workoutMeta', { exercises: '4 exercises', sets: '11 sets' }),
        '4 exercises · 11 sets',
      );
      // Unknown placeholders stay literal rather than rendering "undefined".
      assert.equal(t('en', 'guided.autoLoad', {}), 'AUTO +{kg} KG');
    },
  },
  {
    name: 'i18n: unknown language falls back to English',
    run() {
      assert.equal(t('sv', 'common.cancel'), 'Cancel');
      assert.equal(t('sv', 'home.startWorkout'), 'Start workout');
    },
  },
  {
    name: 'i18n: supported languages expose flag chips for the Welcome selector',
    run() {
      assert.deepEqual(
        SUPPORTED_LANGUAGES.map((lang) => lang.key),
        ['fi', 'en'],
      );
      assert.ok(SUPPORTED_LANGUAGES.every((lang) => lang.flag.length > 0 && lang.label.length > 0));
    },
  },
  {
    // Home said "Start workout" and "Warmup", the session overview one tap
    // later "Start session" and "Warm-up" (store screenshots, 2026-09-28).
    // Finnish already said "Aloita treeni" and "Lämmittely" in both places.
    name: 'i18n: one name for starting a workout and for the warm-up, on every screen',
    run() {
      for (const language of ['en', 'fi']) {
        const start = t(language, 'home.startWorkout');
        assert.equal(t(language, 'guided.entry.start'), start, language);
        assert.equal(t(language, 'prog.custom.detail.startSession'), start, language);
        assert.equal(t(language, 'home.section.warmup'), t(language, 'guided.phase.warmup'), language);
      }
      const english = I18N_KEYS.map((key) => t('en', key));
      assert.equal(english.filter((text) => /\bWarmup\b/.test(text)).length, 0, 'English writes Warm-up');
    },
  },
  {
    // Bug hunt, 2026-10-04: these four printed "1 days", "1 exercises" and
    // Finnish "1 päivää" / "1 liikettä · 1 sarjaa". The screens now pick the
    // One key at a count of 1; this holds the copy and the screen wiring.
    name: 'i18n: singular counts have their own copy, and the screens pick it',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
      const expected = {
        en: {
          'onb.days.cycleFrequencyOne': [{ len: 3, perWeek: '2.3' }, 'You train 1 day out of every 3, about 2.3 a week.'],
          'plan.dayCountOne': [{ days: 1, rest: 6 }, '1 training day · 6 rest'],
          'plan.exerciseCountOne': [{ count: 1 }, '1 exercise'],
          'home.section.setOne': [{ count: 1 }, '1 set'],
        },
        fi: {
          'onb.days.cycleFrequencyOne': [{ len: 3, perWeek: '2,3' }, 'Treenaat yhtenä päivänä 3 päivän kierrossa, noin 2,3 kertaa viikossa.'],
          'plan.dayCountOne': [{ days: 1, rest: 6 }, '1 treenipäivä · 6 lepoa'],
          'plan.exerciseCountOne': [{ count: 1 }, '1 liike'],
          'home.section.setOne': [{ count: 1 }, '1 sarja'],
        },
      };
      for (const language of ['en', 'fi']) {
        for (const [key, [vars, text]] of Object.entries(expected[language])) {
          assert.equal(t(language, key, vars), text, `${language} ${key}`);
        }
        assert.equal(
          t(language, 'home.section.workoutMeta', {
            exercises: t(language, 'tpl.exerciseOne', { count: 1 }),
            sets: t(language, 'home.section.setOne', { count: 1 }),
          }),
          language === 'en' ? '1 exercise · 1 set' : '1 liike · 1 sarja',
        );
      }
      assert.match(read('src/screens/OnboardingScreen.tsx'), /cycleOnDays === 1 \? 'onb\.days\.cycleFrequencyOne'/);
      assert.match(read('src/screens/TrainingPlanScreen.tsx'), /count === 1 \? 'plan\.dayCountOne'/);
      assert.match(read('src/screens/TrainingPlanScreen.tsx'), /planExerciseCount === 1 \? 'plan\.exerciseCountOne'/);
      assert.match(read('src/screens/HomeScreen.tsx'), /totalSets === 1 \? 'home\.section\.setOne'/);
    },
  },
];
