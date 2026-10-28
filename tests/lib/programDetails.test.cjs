const assert = require('node:assert/strict');

const {
  buildCustomProgramDetail,
  buildCustomSessionRuntimeTemplate,
  buildReadyProgramDetail,
  buildReadySessionRuntimeTemplate,
  composedWeekMatchesPlan,
} = require('../../src/lib/programDetails');
const { getWorkoutTemplateById, WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

module.exports = [
  {
    name: 'ready program detail exposes metadata and info sections',
    run() {
      const template = getWorkoutTemplateById('tpl_3_day_full_body_v1');
      const detail = buildReadyProgramDetail(template);

      assert.equal(detail.title, 'FIT');
      assert.equal(detail.sessions.length, 3);
      assert.ok(detail.badges.includes('Beginner'));
      assert.equal(detail.description.includes('Three full-body sessions'), true);
      assert.equal(detail.infoSections.length, 3);
      assert.equal(detail.infoSections[0].kicker, 'Who it fits');
      assert.equal(detail.sessions[0].name, 'Day 1: Full Body');
      assert.ok(detail.sessions[0].preview.includes('Back Squat'));
      assert.match(detail.sessions[0].guidance.firstAction, /Back Squat.*first work set/i);
      assert.match(detail.sessions[0].guidance.restGuidance, /sec/i);
      // The insight highlights and per-day status lines are gone: no screen
      // drew them, and they were built from a day re-derived from name text
      // (duplicate sweep 13, D5-6, 2026-10-12).
      assert.equal('highlights' in detail, false);
      assert.equal('statusLine' in detail.sessions[0], false);
      assert.match(detail.progressionSummary, /week|easier week|deload|pivot/i);
    },
  },
  {
    name: 'ready program detail can prepend a why-it-fits explanation',
    run() {
      const template = getWorkoutTemplateById('tpl_3_day_full_body_v1');
      const detail = buildReadyProgramDetail(
        template,
        'Built around your general fitness goal with a 3-day rhythm.',
      );

      assert.equal(detail.infoSections[0].kicker, 'Why it fits');
      assert.match(detail.infoSections[0].body, /3-day rhythm/i);
    },
  },
  {
    name: 'ready program detail shows the composed week when one is provided',
    run() {
      const template = getWorkoutTemplateById('tpl_3_day_full_body_v1');
      const composedWeek = {
        programId: template.id,
        days: 2,
        weeks: 4,
        totalWorkouts: 8,
        sessionMinutes: 45,
        composed: true,
        cautionRemoved: [],
        cautionSwapped: [],
        focusAdditions: [],
        equipmentRemoved: [],
        equipmentSwapped: [],
        sessions: [
          {
            id: 'composed_day_1',
            name: 'Day 1: Full Body',
            orderIndex: 0,
            source: 'template',
            exercises: [
              {
                id: 'ex_1',
                exerciseName: 'Goblet Squat',
                slotId: 'slot_1',
                role: 'primary',
                progressionPriority: 'high',
                trackingMode: 'weight_reps',
                sets: 3,
                repsMin: 8,
                repsMax: 10,
              },
            ],
          },
          {
            id: 'composed_day_2',
            name: 'Day 2: Full Body',
            orderIndex: 1,
            source: 'template',
            exercises: [],
          },
        ],
      };

      const detail = buildReadyProgramDetail(template, null, [], composedWeek);

      // The detail describes the plan the user runs: 2 composed days, not the
      // raw 3-day catalog template.
      assert.match(detail.subtitle, /2 days \/ week/);
      assert.ok(detail.badges.includes('2 days'));
      assert.equal(detail.sessions.length, 2);
      assert.equal(detail.sessions[0].id, 'composed_day_1');
      assert.ok(detail.sessions[0].preview.includes('Goblet Squat'));

      // Without a composed week the raw template still renders.
      const rawDetail = buildReadyProgramDetail(template);
      assert.equal(rawDetail.sessions.length, 3);
      assert.match(rawDetail.subtitle, /3 days \/ week/);
    },
  },
  {
    name: 'custom program detail exposes custom metadata',
    run() {
      const detail = buildCustomProgramDetail({
        id: 'custom_1',
        name: 'Upper Focus',
        defaultScheduleMode: 'rolling_sequence',
        sessions: [
          {
            id: 'custom_session_1',
            name: 'Upper Focus',
            orderIndex: 1,
            exercises: [
              {
                id: 'bench',
                exerciseName: 'Bench Press',
                slotId: 'bench_slot',
                role: 'secondary',
                progressionPriority: 'medium',
                trackingMode: 'load_and_reps',
                sets: 3,
                repsMin: 6,
                repsMax: 8,
                restSecondsMin: 90,
                restSecondsMax: 120,
                substitutionGroup: 'horizontal_press',
              },
            ],
          },
        ],
      });

      assert.equal(detail.source, 'custom');
      // Not "start the first session": a program the reader owns but is not
      // running has to be adoptable, or the only way onto Home is the catalog
      // and onboarding — neither of which knows about an imported program.
      assert.equal(detail.primaryActionLabel, 'Start this programme');
      // The same words as Home's button (tests/lib/i18n, 2026-09-28).
      assert.equal(detail.sessionActionLabel, 'Start workout');
      assert.equal(detail.sessions.length, 1);
      assert.equal(detail.sessions[0].guidance, null);
      assert.equal(detail.infoSections.length, 0);
      assert.ok(detail.badges.includes('Own program'));

      // Every string this builder returns follows the reader's language. It
      // used to return English literals, so a Finnish user's own program was
      // described to them in English on the screen that exists to describe it.
      const fi = buildCustomProgramDetail(
        { id: 'tpl_custom', name: 'Rintavoima', sessions: [{ id: 's1', name: 'Day 1', orderIndex: 0, exercises: [{ id: 'e1', name: 'Bench', targetSets: 3, repMin: 5, repMax: 5, restSeconds: 120, trackedDefault: true }] }] },
        'fi',
      );
      assert.ok(fi.badges.includes('Oma ohjelma'));
      // No lead paragraph at all now: the one it used to return was fixed
      // copy that described no programme in particular (#bugs 2026-09-05).
      // A ready programme still gets its own, which the case above pins.
      assert.equal(fi.description, '');
      assert.equal(fi.primaryActionLabel, 'Ota ohjelma käyttöön');

      // Already the plan Home reads: the button offers the next workout
      // instead, the same answer a ready programme gives.
      const running = buildCustomProgramDetail(
        { id: 'tpl_custom', name: 'Rintavoima', sessions: [{ id: 's1', name: 'Day 1', orderIndex: 0, exercises: [{ id: 'e1', name: 'Bench', targetSets: 3, repMin: 5, repMax: 5, restSeconds: 120, trackedDefault: true }] }] },
        'fi',
        true,
      );
      assert.equal(running.primaryActionLabel, 'Aloita seuraava treeni');

      // An empty program is still sent to the editor — there is no plan to
      // adopt, and Home would draw a card with no session behind it.
      const empty = buildCustomProgramDetail(
        { id: 'tpl_empty', name: 'Tyhjä', sessions: [{ id: 's1', name: 'Day 1', orderIndex: 0, exercises: [] }] },
        'fi',
      );
      assert.equal(empty.primaryActionLabel, 'Muokkaa pohjaa');
    },
  },
  {
    name: 'custom session runtime template starts only one custom session at a time',
    run() {
      const runtime = buildCustomSessionRuntimeTemplate(
        {
          id: 'custom_2',
          name: 'Upper Lower',
          defaultScheduleMode: 'rolling_sequence',
          sessions: [
            {
              id: 'upper',
              name: 'Upper',
              orderIndex: 0,
              exercises: [
                {
                  id: 'bench',
                  exerciseName: 'Bench Press',
                  slotId: 'bench_slot',
                  role: 'secondary',
                  progressionPriority: 'medium',
                  trackingMode: 'load_and_reps',
                  sets: 3,
                  repsMin: 6,
                  repsMax: 8,
                  restSecondsMin: 90,
                  restSecondsMax: 120,
                  substitutionGroup: 'horizontal_press',
                },
              ],
            },
            {
              id: 'lower',
              name: 'Lower',
              orderIndex: 1,
              exercises: [
                {
                  id: 'squat',
                  exerciseName: 'Back Squat',
                  slotId: 'squat_slot',
                  role: 'secondary',
                  progressionPriority: 'medium',
                  trackingMode: 'load_and_reps',
                  sets: 3,
                  repsMin: 5,
                  repsMax: 8,
                  restSecondsMin: 120,
                  restSecondsMax: 150,
                  substitutionGroup: 'squat',
                },
              ],
            },
          ],
        },
        'lower',
      );

      assert.equal(runtime.sessions.length, 1);
      assert.equal(runtime.sessions[0].id, 'lower');
      assert.match(runtime.name, /Lower/);
    },
  },
  {
    name: 'the primary action reads whether the programme is already the reader’s',
    run() {
      const template = getWorkoutTemplateById('tpl_3_day_full_body_v1');

      const browsing = buildReadyProgramDetail(template, null, [], null, 'fi');
      assert.equal(browsing.primaryActionLabel, 'Ota ohjelma käyttöön');

      // Adoption returns early for a programme already held, so this label used
      // to name a decision the button could not make.
      const mine = buildReadyProgramDetail(template, null, [], null, 'fi', true);
      assert.equal(mine.primaryActionLabel, 'Aloita seuraava treeni');
    },
  },
  {
    name: 'ready session runtime template starts only one session at a time',
    run() {
      const template = getWorkoutTemplateById('tpl_4_day_upper_lower_v1');
      const runtime = buildReadySessionRuntimeTemplate(template, 'upper_b');

      assert.equal(runtime.id, template.id);
      assert.equal(runtime.sessions.length, 1);
      assert.equal(runtime.sessions[0].id, 'upper_b');
      assert.match(runtime.name, /Upper B/);
    },
  },
  {
    name: 'Strength Foundations 5x5 is three days on three sessions, A-B-A',
    run() {
      // #bugs 2026-09-01: the one catalog entry whose day count (3) and
      // session count (2) differed. The plan engine pins one session to each
      // training day, so every reader that counted sessions — the detail
      // page, adoption, the composer — drew a two-day programme under a
      // catalog row that said "3 ×". The week is stated as data now: the
      // third day is Workout A again, which is what classic 5x5 does.
      const template = getWorkoutTemplateById('tpl_gainer_strength_5x5_v1');
      assert.equal(template.daysPerWeek, 3);
      assert.equal(template.sessions.length, 3);
      assert.deepEqual(
        template.sessions.map((session) => session.name),
        ['Workout A', 'Workout B', 'Workout A'],
      );
      // The repeat is the same prescription, not a paraphrase of it.
      const lifts = (session) => session.exercises.map((exercise) => `${exercise.exerciseName} ${exercise.sets}x${exercise.repsMin}`);
      assert.deepEqual(lifts(template.sessions[2]), lifts(template.sessions[0]));
      // And every exercise id is still unique across the template, because
      // the logger keys on them.
      const ids = template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.id));
      assert.equal(new Set(ids).size, ids.length);

      const detail = buildReadyProgramDetail(template);
      assert.equal(detail.daysPerWeek, 3);
      assert.equal(detail.sessions.length, 3);
      assert.match(detail.subtitle, /3 days \/ week/);

      // A custom programme has no number of its own: one session per day.
      const custom = buildCustomProgramDetail({
        id: 'tpl_custom_x',
        name: 'Mine',
        defaultScheduleMode: 'rolling_sequence',
        sessions: [
          { id: 'a', name: 'A', orderIndex: 1, exercises: [] },
          { id: 'b', name: 'B', orderIndex: 2, exercises: [] },
        ],
      });
      assert.equal(custom.daysPerWeek, 2);
    },
  },
  {
    name: 'every ready programme holds exactly one session per stated training day',
    run() {
      // The guard for the next 5x5. Adoption pins one session to each entry
      // and every week-count on screen reads daysPerWeek, so a template whose
      // two numbers differ is scheduled as one and described as the other —
      // and nothing else in the app fails on it; the calendar just quietly
      // draws the wrong week. A programme that genuinely rotates fewer
      // sessions over more days is a plan-engine feature, not a data entry.
      const offenders = WORKOUT_TEMPLATES_V1.filter(
        (template) =>
          !Number.isInteger(template.daysPerWeek) ||
          template.daysPerWeek < 1 ||
          template.daysPerWeek > 7 ||
          template.sessions.length !== template.daysPerWeek,
      ).map((template) => `${template.id} days=${template.daysPerWeek} sessions=${template.sessions.length}`);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'a composed week stands in only until the plan names its own days',
    run() {
      const composed = ['onboarding_tpl_a_1', 'onboarding_tpl_a_2', 'onboarding_tpl_a_3'];

      // Nothing adopted yet: the composed week is what the reader was shown.
      assert.equal(composedWeekMatchesPlan(composed, []), true);
      assert.equal(composedWeekMatchesPlan(composed, [null, undefined, '']), true);

      // The plan runs the composed days — Home's rows and this page agree.
      assert.equal(composedWeekMatchesPlan(composed, ['onboarding_tpl_a_2', 'onboarding_tpl_a_1']), true);

      // The plan runs the catalog's days. Standing in here is what opened an
      // empty screen from Home's day row: the id it carried was not in the
      // composed week at all.
      assert.equal(composedWeekMatchesPlan(composed, ['full_body_a', 'full_body_b']), false);
      // One stale entry is enough — that day is the one that opens blank.
      assert.equal(composedWeekMatchesPlan(composed, ['onboarding_tpl_a_1', 'full_body_b']), false);
    },
  },
];
