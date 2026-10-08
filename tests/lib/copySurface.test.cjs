const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const first = require('../../.test-dist/lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { buildReadyProgramFitExplanation } = require('../../.test-dist/lib/readyProgramFit.js');
const { buildCautionAdaptationLine } = require('../../.test-dist/lib/cautionAdaptationLine.js');
const { buildRecommendationReasonLines } = require('../../.test-dist/lib/recommendationExplanation.js');
const { buildReadyProgramDetail } = require('../../.test-dist/lib/programDetails.js');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * Persona hunt, 2026-10-08 (copy surface): what the programme page and the
 * plan-ready screen SAY has to be about the week the reader is handed.
 */

const ENVIRONMENTS = {
  gym: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: [] },
  home: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Dumbbells', 'Bench'] },
  bodyweight: { equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
};

function selectionFor(overrides) {
  const goal = overrides.goal ?? 'muscle';
  return { ...first.DEFAULT_FIRST_RUN_SELECTION, goal, goals: [goal], ...overrides };
}

function pageFor(selection, language = 'en') {
  const recommendation = first.resolveFirstRunRecommendationWithTailoring(selection, null, language);
  const template = getWorkoutTemplateById(recommendation.featuredProgramId);
  const composedWeek = composeProgramWeekForSelection(selection, recommendation.featuredProgramId);
  const text = buildReadyProgramFitExplanation({ selection, recommendation, template, composedWeek, language });
  return { recommendation, template, composedWeek, text };
}

/** Every answer set where the week the reader gets is not the catalogue's. */
function* differingWeeks() {
  for (const goal of ['muscle', 'strength', 'general', 'lean_athletic']) {
    for (const level of ['beginner', 'advanced']) {
      for (const daysPerWeek of [2, 3, 4, 5, 6]) {
        for (const [env, e] of Object.entries(ENVIRONMENTS)) {
          const selection = selectionFor({ goal, level, daysPerWeek, ...e });
          const page = pageFor(selection);
          if (page.composedWeek && page.composedWeek.days !== page.template.daysPerWeek) {
            yield { env, selection, ...page };
          }
        }
      }
    }
  }
}

module.exports = [
  {
    name: 'copy surface: the programme page quotes the days of the week it draws, not the catalogue programme',
    run() {
      let seen = 0;
      for (const { env, selection, template, composedWeek, text } of differingWeeks()) {
        seen += 1;
        const label = `${selection.goal}/${selection.level}/${selection.daysPerWeek}d/${env} -> ${template.id}`;
        const days = composedWeek.days;
        assert.match(text, new RegExp(`^${days} days? for`), `${label}: ${text}`);
        assert.doesNotMatch(
          text,
          new RegExp(`\\b${template.daysPerWeek} days\\b`),
          `${label} quotes the catalogue's ${template.daysPerWeek} days over a ${days}-day week: ${text}`,
        );
        // The note: "lighter than your target" never over a week that meets the
        // days asked for, and "keeps this start at N days" only over N days.
        if (days >= selection.daysPerWeek) {
          assert.doesNotMatch(text, /lighter than your target/, `${label}: ${text}`);
        }
        const closest = text.match(/closest match keeps this start at (\d+) days/);
        if (closest) {
          assert.equal(Number(closest[1]), days, `${label}: ${text}`);
          assert.notEqual(days, selection.daysPerWeek, `${label}: ${text}`);
        }
      }
      assert.ok(seen >= 20, `the sweep found only ${seen} answer sets where the week differs from the catalogue`);

      // And in Finnish.
      const fi = pageFor(selectionFor({ goal: 'muscle', level: 'beginner', daysPerWeek: 3 }), 'fi');
      assert.notEqual(fi.composedWeek.days, fi.template.daysPerWeek, 'the Finnish case no longer differs; pick another');
      assert.match(fi.text, new RegExp(`^${fi.composedWeek.days} päivää`), fi.text);
      assert.doesNotMatch(fi.text, new RegExp(`\\b${fi.template.daysPerWeek} päiv`), fi.text);
    },
  },
  {
    name: 'copy surface: the weekly minutes are the composed week\'s days times its session length',
    run() {
      for (const { selection, composedWeek, text } of differingWeeks()) {
        if (selection.equipment !== 'gym') {
          continue; // the minutes line is the gym reader's; the others get the gear line
        }
        const minutes = Math.round(Math.max(60, composedWeek.days * composedWeek.sessionMinutes) / 10) * 10;
        assert.match(text, new RegExp(`About ${minutes} min this week`), `${selection.goal}/${selection.daysPerWeek}: ${text}`);
      }
    },
  },
  {
    name: 'copy surface: a low-equipment pick whose week meets the days asked for is not also told it is "lighter"',
    run() {
      // The home pick, 3 days a template, 4 asked: the week is 4 days.
      const selection = selectionFor({ goal: 'muscle', level: 'beginner', daysPerWeek: 4, ...ENVIRONMENTS.bodyweight });
      const page = pageFor(selection);
      assert.equal(page.composedWeek.days, 4);
      assert.notEqual(page.template.daysPerWeek, 4, 'the case no longer differs; pick another');
      assert.doesNotMatch(page.text, /lighter equipment|lighter than/i, page.text);
      // The stored note, written before the week was composed, still says it
      // for a reader of the catalogue programme.
      assert.match(page.recommendation.mismatchNote ?? '', /lighter than your target/);

      // A week that really is shorter than the ask keeps saying so.
      const note = first.resolveMismatchNoteForWeek(selection, page.recommendation, 3, null, 'en');
      assert.match(note, /lighter than your target/);

      // The fit sentence is gone from both languages; a self-directed reader
      // gets the one sentence that is still new.
      const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');
      assert.doesNotMatch(i18nSource, /mismatch\.lowEquipment\.fits/);
      const selfDirected = { ...selection, guidanceMode: 'self_directed' };
      const selfNote = first.resolveMismatchNoteForWeek(selfDirected, page.recommendation, 4, null, 'en');
      assert.equal(selfNote, t('en', 'mismatch.lowEquipment.selfDirected'));
      assert.doesNotMatch(selfNote, /lighter|You picked/);
    },
  },
  {
    name: 'copy surface: the page and the onboarding brief hand the days to the same functions',
    run() {
      const root = path.join(__dirname, '..', '..', 'src');
      const page = fs.readFileSync(path.join(root, 'app', 'renderWorkoutTab.tsx'), 'utf8');
      assert.match(page, /buildReadyProgramFitExplanation\(\{[\s\S]*?composedWeek: readyComposedWeek,/);
      assert.doesNotMatch(page, /projectedDaysPerWeek: readyTemplate\.daysPerWeek/);

      const fit = fs.readFileSync(path.join(root, 'lib', 'readyProgramFit.ts'), 'utf8');
      assert.match(fit, /projectedDaysPerWeek: readyProgramWeek\(template, composed\)\.days/);
      assert.match(fit, /resolveMismatchNoteForWeek\(/);
      assert.match(fit, /buildCautionAdaptationLine\(composed, language\)/);

      const onboarding = fs.readFileSync(path.join(root, 'screens', 'OnboardingScreen.tsx'), 'utf8');
      assert.match(onboarding, /resolveMismatchNoteForWeek\(\s*selection,\s*recommendation,\s*composedActiveWeek\?\.days,/);
      assert.match(onboarding, /buildCautionAdaptationLine\(composedActiveWeek, language\)/);
      assert.match(onboarding, /cautionAdaptationLine,\s*\]\.filter\(Boolean\)/);
    },
  },
  {
    name: 'copy surface: the page does not describe the catalogue\'s four days over a three-day week',
    run() {
      const selection = selectionFor({ goal: 'muscle', level: 'beginner', daysPerWeek: 3 });
      const { template, composedWeek } = pageFor(selection);
      assert.notEqual(composedWeek.days, template.daysPerWeek);

      const own = buildReadyProgramDetail(template, undefined, null, [], composedWeek, 'en');
      assert.equal(own.description, '', 'the catalogue summary counts the catalogue days');
      assert.equal(own.daysPerWeek, composedWeek.days);

      const catalogue = buildReadyProgramDetail(template, undefined, null, [], null, 'en');
      assert.notEqual(catalogue.description, '', 'the catalogue programme keeps its own summary');

      // A composed week with the catalogue's own count keeps it too.
      const same = selectionFor({ goal: 'muscle', level: 'beginner', daysPerWeek: template.daysPerWeek });
      const sameWeek = composeProgramWeekForSelection(same, template.id);
      assert.equal(sameWeek.days, template.daysPerWeek);
      assert.notEqual(buildReadyProgramDetail(template, undefined, null, [], sameWeek, 'en').description, '');
    },
  },
  {
    name: 'copy surface: a caution flag that changed the week is named, once, in both languages',
    run() {
      const knees = selectionFor({
        goal: 'muscle',
        level: 'beginner',
        daysPerWeek: 3,
        cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }],
      });
      const week = composeProgramWeekForSelection(knees, first.resolveFirstRunRecommendationWithTailoring(knees, null).featuredProgramId);
      assert.ok(week.cautionRemoved.length > 0, 'the case no longer removes anything; pick another');

      const en = buildCautionAdaptationLine(week, 'en');
      assert.match(en, /^Knees: .* left out\.$/);
      const distinct = [...new Set(week.cautionRemoved.map((entry) => entry.name))];
      assert.ok(week.cautionRemoved.length >= distinct.length);
      for (const name of distinct.slice(0, 2)) {
        assert.equal(en.split(name).length - 1, 1, `${name} named once in: ${en}`);
      }
      if (distinct.length > 2) {
        assert.match(en, new RegExp(`and ${distinct.length - 2} more`));
      }

      const fi = buildCautionAdaptationLine(week, 'fi');
      assert.match(fi, /^Polvet: .* jätetty pois\.$/);

      // Careful: swapped, and the swapped-for lift is not what is named.
      const shoulders = selectionFor({
        goal: 'muscle',
        level: 'advanced',
        daysPerWeek: 5,
        cautionFlags: [{ area: 'shoulders', level: 'careful', refinements: [] }],
      });
      const shoulderWeek = composeProgramWeekForSelection(
        shoulders,
        first.resolveFirstRunRecommendationWithTailoring(shoulders, null).featuredProgramId,
      );
      assert.ok(shoulderWeek.cautionSwapped.length > 0);
      assert.match(buildCautionAdaptationLine(shoulderWeek, 'en'), /^Shoulders: .* swapped\.$/);
      assert.match(buildCautionAdaptationLine(shoulderWeek, 'fi'), /^Olkapäät: .* vaihdettu\.$/);
    },
  },
  {
    name: 'copy surface: no line without a change - no flag, an info-only flag, or a lift the week still has',
    run() {
      const none = selectionFor({ goal: 'muscle', level: 'advanced', daysPerWeek: 5 });
      const info = selectionFor({
        goal: 'muscle',
        level: 'advanced',
        daysPerWeek: 5,
        cautionFlags: [{ area: 'knees', level: 'info', refinements: [] }],
      });
      for (const selection of [none, info]) {
        const week = composeProgramWeekForSelection(selection, first.resolveFirstRunRecommendationWithTailoring(selection, null).featuredProgramId);
        assert.equal(buildCautionAdaptationLine(week, 'en'), null);
        assert.equal(buildCautionAdaptationLine(week, 'fi'), null);
        assert.equal(pageFor(selection).text.includes('left out'), false);
      }
      assert.equal(buildCautionAdaptationLine(null, 'en'), null);

      // The composer records a removal per day; a lift that is still somewhere
      // in the week is not claimed as gone, and one on three days reads once.
      const ex = (exerciseName) => ({ exerciseName });
      const fake = {
        sessions: [{ exercises: [ex('Leg Press')] }, { exercises: [ex('Calf Raise')] }],
        cautionRemoved: [
          { name: 'Back Squat', area: 'knees' },
          { name: 'Back Squat', area: 'knees' },
          { name: 'Back Squat', area: 'knees' },
          { name: 'Leg Press', area: 'knees' },
        ],
        cautionSwapped: [],
      };
      assert.equal(buildCautionAdaptationLine(fake, 'en'), 'Knees: Back Squat left out.');
    },
  },
  {
    name: 'copy surface: the caution line outranks the goal slogan when the list is full, and a focus area outranks neither',
    run() {
      const selection = selectionFor({ goal: 'muscle', level: 'advanced', daysPerWeek: 5 });
      const line = 'Knees: Back Squat left out.';
      const note = "Vinha's closest match keeps this start at 4 days so the week stays coherent.";
      const reasons = buildRecommendationReasonLines(selection, {
        projectedDaysPerWeek: 5,
        mismatchNote: note,
        cautionLine: line,
        language: 'en',
      });
      assert.equal(reasons.length, 4);
      assert.ok(reasons.includes(line), reasons.join(' | '));
      assert.ok(reasons.includes(note), reasons.join(' | '));
      assert.ok(!reasons.includes('Volume for size.'), 'the slogan is what gives way');

      // With room, the slogan stays.
      const roomy = buildRecommendationReasonLines(selection, { projectedDaysPerWeek: 5, cautionLine: line, language: 'en' });
      assert.deepEqual(roomy.slice(2), [line, 'Volume for size.']);

      // A focus area is the reader's own word and is not displaced by it.
      const focus = buildRecommendationReasonLines(
        { ...selection, focusAreas: ['glutes'] },
        { projectedDaysPerWeek: 5, mismatchNote: note, cautionLine: line, language: 'en' },
      );
      assert.ok(focus.some((reason) => /glutes/i.test(reason)), focus.join(' | '));
      assert.ok(focus.includes(line));

      // Without a line nothing moves.
      const plain = buildRecommendationReasonLines(selection, { projectedDaysPerWeek: 5, mismatchNote: note, language: 'en' });
      assert.deepEqual(plain.slice(2), ['Volume for size.', note]);
    },
  },
  {
    name: 'copy surface: "Heavy compounds first" is said only over a week that can have them',
    run() {
      const strength = (env) => selectionFor({ goal: 'strength', level: 'beginner', daysPerWeek: 3, ...env });
      const text = (selection) =>
        buildRecommendationReasonLines(selection, { projectedDaysPerWeek: 3, language: 'en' }).join(' ');
      assert.match(text(strength(ENVIRONMENTS.gym)), /Heavy compounds first/);
      assert.doesNotMatch(text(strength(ENVIRONMENTS.bodyweight)), /Heavy compounds/);
      assert.doesNotMatch(text(strength(ENVIRONMENTS.home)), /Heavy compounds/);
      assert.match(
        text(strength({ equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbells', 'Squat rack'] })),
        /Heavy compounds first/,
      );
      // The strength-and-muscle variant follows the same rule, and the line
      // that takes its place is still a line.
      const both = { ...strength(ENVIRONMENTS.bodyweight), secondaryOutcomes: ['muscle'] };
      const reasons = buildRecommendationReasonLines(both, { projectedDaysPerWeek: 3, language: 'en' });
      assert.doesNotMatch(reasons.join(' '), /Heavy compounds/);
      assert.ok(reasons.length >= 3);
    },
  },
  {
    name: 'copy surface: one Finnish name for the lean and athletic goal, and Programs-tab lines that promise no outcome',
    run() {
      const name = t('fi', 'setup.goal.leanAthletic');
      assert.match(name, /urheilullinen/i);
      assert.match(t('fi', 'recExp.goal.leanAthletic'), /urheilullinen/i);
      const lean = selectionFor({ goal: 'lean_athletic', level: 'beginner' });
      assert.ok(first.buildFirstRunCustomProgramName(lean, 'fi').toLowerCase().includes(name.toLowerCase()));

      const keys = [
        'wf.female_targeted.primary',
        'wf.female_targeted.alt',
        'wf.lean_athletic.primary',
        'wf.lean_athletic.alt',
      ];
      for (const language of ['en', 'fi']) {
        for (const key of keys) {
          assert.doesNotMatch(t(language, key), /fat loss|rasvanpolt|most women|lihaksikas/i, `${language} ${key}`);
        }
        // The home line is shown over a programme that may use none of the
        // reader's gear, so it says what the programme needs, not what it was
        // built for.
        assert.doesNotMatch(t(language, 'wf.home_equipment.primary'), /your equipment|sinulle|rakennettu/i, language);
        // The women's line is true of every programme in the pool, so it names
        // no body area.
        assert.doesNotMatch(t(language, 'wf.female_targeted.primary'), /glute|leg|shoulder|pakar|jalo|olkap/i, language);
      }
    },
  },
];
