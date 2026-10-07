const assert = require('node:assert/strict');

const {
  buildProgrammeDraft,
  composeProgrammePreview,
  hasProgrammeBriefOutline,
  liveProposalOrPreview,
  outlineProgrammeBrief,
  parseProgrammeBrief,
  resolveLiveProposal,
} = require('../../.test-dist/lib/programmeBrief.js');
const { createSeedDatabase } = require('../../.test-dist/data/seed.js');
const library = Object.values(require('../../.test-dist/data/generatedExerciseLibrary.js'))[0];

const preferences = createSeedDatabase().preferences;

module.exports = [
  /**
   * The build offer used to quote the brief back as one sentence and ask yes
   * or no; on a five-day request that is six lines of prose and the reader
   * could not see what they were agreeing to (#bugs 2026-08-27).
   */
  {
    name: 'the outline carries the days, the length, the lifts and the focus',
    run() {
      const outline = outlineProgrammeBrief(
        parseProgrammeBrief('4 päivää viikossa, 45 min, penkki ja lantionnosto, rinta painopisteenä.'),
      );
      assert.equal(outline.plannedDays, 4);
      assert.equal(outline.sessionMinutes, 45);
      assert.deepEqual(outline.lifts, ['Bench Press', 'Hip Thrust']);
      assert.ok(outline.focusAreas.includes('chest'));
      assert.ok(hasProgrammeBriefOutline(outline));
    },
  },
  {
    /**
     * The composer lays out at most four days. Saying "you asked for 4, I
     * build 4" is noise; saying nothing when they differ is the app putting a
     * number in the reader's mouth.
     */
    name: 'the requested day count is carried only when the composer cannot meet it',
    run() {
      const trimmed = outlineProgrammeBrief(parseProgrammeBrief('5 päivää viikossa'));
      assert.equal(trimmed.requestedDays, 5);
      assert.notEqual(trimmed.plannedDays, 5);

      const met = outlineProgrammeBrief(parseProgrammeBrief('3 päivää viikossa'));
      assert.equal(met.plannedDays, 3);
      assert.equal(met.requestedDays, null);
    },
  },
  {
    /**
     * A sentence the parser got nothing out of must not draw an empty box
     * under a heading — that reads as the app having understood nothing.
     */
    name: 'a brief with nothing in it draws no outline',
    run() {
      const outline = outlineProgrammeBrief(parseProgrammeBrief('moikka'));
      assert.equal(hasProgrammeBriefOutline(outline), false);
    },
  },
  {
    name: 'a Finnish brief is read for days, the lift, the focus and the caution — each from its own sentence',
    run() {
      const signals = parseProgrammeBrief('3 päivää viikossa, penkki painopisteenä. Olkapää on kipeä.');
      assert.equal(signals.daysPerWeek, 3);
      assert.deepEqual(signals.lifts, ['Bench Press']);
      assert.deepEqual(signals.cautions, ['shoulder']);
      // The shoulder sentence hurts, so it is a caution, not a focus.
      assert.deepEqual(signals.focusBodyParts, []);
      assert.ok(signals.avoidTerms.includes('overhead press'));
      // The bench was asked for explicitly; the shoulder caution does not veto it.
      assert.ok(!signals.avoidTerms.includes('bench press'));
    },
  },
  {
    name: 'an English brief reads the same, and words spell numbers too',
    run() {
      const signals = parseProgrammeBrief('four days a week, strength, squat and deadlift, about 45 min. Knee hurts.');
      assert.equal(signals.daysPerWeek, 4);
      assert.equal(signals.goal, 'strength');
      assert.equal(signals.sessionMinutes, 45);
      assert.deepEqual(signals.lifts, ['Back Squat', 'Deadlift']);
      assert.deepEqual(signals.cautions, ['knee']);
      assert.ok(signals.avoidTerms.includes('lunge'));
    },
  },
  {
    name: 'a squat that is not the back squat is not read as one, and a push-up is not a bench',
    run() {
      assert.deepEqual(parseProgrammeBrief('goblet-kyykky ja punnerrukset').lifts, ['Pushups']);
      assert.deepEqual(parseProgrammeBrief('etukyykky kolmesti viikossa').lifts, []);
      assert.equal(parseProgrammeBrief('etukyykky kolmesti viikossa').daysPerWeek, 3);
      // "warm-up" must not read as an arms focus.
      assert.deepEqual(parseProgrammeBrief('long warm-up please').focusBodyParts, []);
    },
  },
  {
    name: 'more days than the composer plans become four, and it says so instead of misquoting the ask',
    run() {
      // The cap is right — the composer has no fifth split to lay out. What
      // was wrong was the screen then reporting "read from your brief: 4
      // days" about a brief that said five: the app putting a number in the
      // reader's mouth (user 2026-08-26).
      const six = parseProgrammeBrief('6 päivää');
      assert.equal(six.daysPerWeek, 4);
      assert.equal(six.requestedDaysPerWeek, 6, 'the ask survives so the screen can say both');

      // Within the ceiling there is nothing to disclose, and repeating the
      // same number twice would read as a correction that never happened.
      const three = parseProgrammeBrief('3 päivää');
      assert.equal(three.daysPerWeek, 3);
      assert.equal(three.requestedDaysPerWeek, null);

      const empty = parseProgrammeBrief('jotain kivaa');
      assert.deepEqual(empty, {
        daysPerWeek: null,
        requestedDaysPerWeek: null,
        sessionMinutes: null,
        goal: null,
        equipment: null,
        experience: null,
        lifts: [],
        focusBodyParts: [],
        cautions: [],
        avoidTerms: [],
      });
    },
  },
  {
    name: 'the preview composer builds the asked days, includes the asked lift, and every exercise is a library item',
    run() {
      const proposal = composeProgrammePreview('3 päivää, penkki painopisteenä, olkapää kipeä', preferences, library);
      assert.equal(proposal.source, 'preview');
      assert.equal(proposal.sessions.length, 3);
      const ids = new Set(library.map((item) => item.id));
      for (const session of proposal.sessions) {
        assert.ok(session.exercises.length >= 3, `${session.name} has ${session.exercises.length} exercises`);
        for (const exercise of session.exercises) {
          assert.ok(ids.has(exercise.libraryItemId), `${exercise.name} is not a library item`);
          assert.ok(!/overhead press|shoulder press|upright row/i.test(exercise.name), `avoided lift slipped in: ${exercise.name}`);
        }
      }
      assert.deepEqual(proposal.unmetLifts, [], 'the bench was asked for and must be in the week');
      const names = proposal.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name.toLowerCase()));
      assert.ok(names.some((name) => name.includes('bench press')), `no bench in ${names.join(', ')}`);
    },
  },
  {
    name: 'a live proposal is swept: unknown names are dropped and listed, empty days vanish, numbers are clamped',
    run() {
      const proposal = resolveLiveProposal(
        {
          title: 'Bench block',
          sessions: [
            {
              name: 'Day 1',
              exercises: [
                { name: 'Bench Press', sets: 4, repsMin: 5, repsMax: 5 },
                { name: 'Quantum Fly Machine', sets: 3, repsMin: 10, repsMax: 12 },
                { name: 'Barbell Full Squat', sets: 30, repsMin: 0, repsMax: 0 },
              ],
            },
            { name: 'Day 2', exercises: [{ name: 'Made Up Row', sets: 3, repsMin: 8, repsMax: 10 }] },
          ],
        },
        'penkki 2 päivää',
        library,
        90,
        preferences,
      );
      assert.equal(proposal.source, 'live');
      assert.equal(proposal.sessions.length, 1, 'the day with nothing real in it is gone');
      assert.deepEqual(proposal.unresolvedNames, ['Quantum Fly Machine', 'Made Up Row']);
      const squat = proposal.sessions[0].exercises.find((exercise) => exercise.name === 'Barbell Full Squat');
      assert.deepEqual([squat.sets, squat.repsMin, squat.repsMax, squat.restSeconds], [8, 1, 1, 90]);
      assert.deepEqual(proposal.unmetLifts, [], 'the bench came back and resolved');
    },
  },
  {
    name: 'the draft is a programme of the reader own, with a name that does not collide',
    run() {
      const proposal = composeProgrammePreview('2 päivää', preferences, library);
      const draft = buildProgrammeDraft(proposal, [proposal.title, `${proposal.title} 2`]);
      assert.equal(draft.name, `${proposal.title} 3`);
      assert.equal(draft.sessions.length, 2);
      assert.equal(draft.origin, undefined, 'authored, so the cap counts it');
      for (const session of draft.sessions) {
        for (const exercise of session.exercises) {
          assert.ok(exercise.libraryItemId);
          assert.ok(exercise.targetSets >= 1 && exercise.repMin >= 1 && exercise.repMax >= exercise.repMin);
        }
      }
    },
  },
  {
    // #bugs 2026-10-06: specialty movements (car deadlift, Conan's wheel,
    // atlas stones…) are not normal exercises. The composer's slot search
    // ("deadlift") and its fallback must not land on one. Before the gate,
    // 400 of these answers got Axle Deadlift.
    name: 'a composed programme never picks a specialty movement the reader did not name',
    run() {
      const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
      const { isSpecialtyExercise } = require('../../.test-dist/lib/exerciseClassification.js');
      const seeded = createSeedExerciseLibrary();
      const offenders = [];
      const briefs = [
        '4 päivää viikossa, voimaa, maastaveto ja kyykky',
        '3 days a week, deadlift, squat and press, strength',
        '5 päivää, lihasmassa, jalat painopisteenä',
        '2 days, full body, conditioning',
        '6 päivää viikossa, yläkroppa ja selkä',
      ];
      for (const goal of ['strength', 'muscle', 'general', 'lean_athletic', 'general_fitness']) {
        for (const environment of ['full_gym', 'home_gym', 'minimal_equipment', 'bodyweight_only']) {
          for (const days of [2, 3, 4, 5, 6]) {
            for (const brief of briefs) {
              const prefs = { ...preferences, setupGoal: goal, setupTrainingEnvironment: environment, setupDaysPerWeek: days };
              const proposal = composeProgrammePreview(brief, prefs, seeded);
              for (const session of proposal.sessions) {
                for (const exercise of session.exercises) {
                  const item = seeded.find((entry) => entry.id === exercise.libraryItemId);
                  if (item && isSpecialtyExercise(item)) {
                    offenders.push(`${goal} ${environment} ${days}d "${brief}": ${item.name}`);
                  }
                }
              }
            }
          }
        }
      }
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} specialty picks`);
    },
  },
  {
    // User, 2026-10-06: no programme may hold a specialty movement, and the
    // AI must not suggest one unless the reader asks for it.
    name: 'a live proposal drops specialty movements the brief did not ask for, and says so',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
      const seeded = createSeedExerciseLibrary();
      const raw = {
        title: 'Legs',
        sessions: [
          {
            name: 'Day 1',
            exercises: [
              { name: 'Barbell Full Squat', sets: 4, repsMin: 5, repsMax: 5 },
              { name: 'Atlas Stones', sets: 3, repsMin: 3, repsMax: 5 },
              { name: 'Car Deadlift', sets: 3, repsMin: 3, repsMax: 5 },
            ],
          },
        ],
      };
      const plain = resolveLiveProposal(raw, '3 päivää, jalat ja selkä', seeded, 120, preferences);
      assert.deepEqual(plain.sessions[0].exercises.map((exercise) => exercise.name), ['Barbell Full Squat']);
      assert.deepEqual(plain.specialtyLeftOut, ['Atlas Stones', 'Car Deadlift']);
      assert.deepEqual(plain.unresolvedNames, []);

      // Asked for by name, in either language, it stays; asked for as
      // strongman work, they all do.
      const named = resolveLiveProposal(raw, 'jalat ja atlas stones', seeded, 120, preferences);
      assert.deepEqual(named.sessions[0].exercises.map((exercise) => exercise.name), ['Barbell Full Squat', 'Atlas Stones']);
      const strongman = resolveLiveProposal(raw, 'haluan strongman-treeniä', seeded, 120, preferences);
      assert.equal(strongman.sessions[0].exercises.length, 3);
      assert.deepEqual(strongman.specialtyLeftOut, []);

      // A brief that refuses them is not a request for them (review 2026-10-07:
      // "ei erikoisliikkeitä" kept Atlas Stones).
      for (const refusal of [
        '3 päivää, ei erikoisliikkeitä',
        'jalat, en halua strongman-liikkeitä',
        'legs, no strongman or specialty lifts please',
        "legs without specialty stuff, and don't add atlas stones",
        'jalat ilman atlas stonesia',
      ]) {
        const refused = resolveLiveProposal(raw, refusal, seeded, 120, preferences);
        assert.deepEqual(refused.specialtyLeftOut, ['Atlas Stones', 'Car Deadlift'], refusal);
      }
      // A refusal in one clause does not cancel a request in another.
      const mixed = resolveLiveProposal(raw, 'ei koneita. haluan atlas stones', seeded, 120, preferences);
      assert.deepEqual(mixed.specialtyLeftOut, ['Car Deadlift']);
      // An emphatic request is still a request.
      const only = resolveLiveProposal(raw, 'nothing but strongman, 4 days', seeded, 120, preferences);
      assert.deepEqual(only.specialtyLeftOut, []);
      // "ei X vaan Y" asks for Y: the refusal stops at the turn (CI review of
      // #332, 2026-10-07) — and the other way round it still refuses.
      for (const request of ['ei koneita vaan strongman', 'no machines but strongman', 'en halua koneita, mutta strongmania kyllä']) {
        assert.deepEqual(resolveLiveProposal(raw, request, seeded, 120, preferences).specialtyLeftOut, [], request);
      }
      for (const refusal of ['ei strongmania vaan koneita', 'no strongman but machines', 'ilman koneita ja strongmania']) {
        assert.deepEqual(resolveLiveProposal(raw, refusal, seeded, 120, preferences).specialtyLeftOut, ['Atlas Stones', 'Car Deadlift'], refusal);
      }

      // The card says what it left out, and the model is told not to.
      const card = fs.readFileSync(path.join(__dirname, '../../src/components/ProgrammeProposalCard.tsx'), 'utf8');
      assert.match(card, /aiCompose\.specialtyLeftOut/);
      const server = fs.readFileSync(path.join(__dirname, '../../api/ai-coach.ts'), 'utf8');
      const composer = server.slice(server.indexOf('const COMPOSER_SYSTEM_RULES'), server.indexOf('const AI_COACH_RESPONSE_SCHEMA'));
      assert.match(composer, /No strongman or specialty movements/);
      const coach = server.slice(server.indexOf('const COACH_SYSTEM_RULES'));
      assert.match(coach, /Never suggest a strongman or specialty movement/);
    },
  },
  {
    // Review 2026-10-07: when nothing in the live answer resolved, the
    // preview week replaced it and dropped the specialty list the card
    // promises never to hide.
    name: 'a live answer with nothing usable falls back to the preview and keeps what it was refused',
    run() {
      const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
      const seeded = createSeedExerciseLibrary();
      const raw = {
        title: 'Strongman',
        sessions: [{ name: 'Day 1', exercises: [
          { name: 'Atlas Stones', sets: 3, repsMin: 3, repsMax: 5 },
          { name: 'Moon Squat Deluxe', sets: 3, repsMin: 5, repsMax: 5 },
        ] }],
      };
      const brief = '3 päivää, koko keho';
      const resolved = resolveLiveProposal(raw, brief, seeded, 120, preferences);
      assert.equal(resolved.sessions.length, 0);
      const preview = composeProgrammePreview(brief, createSeedDatabase().preferences, seeded);
      const shown = liveProposalOrPreview(resolved, () => preview);
      assert.equal(shown.source, 'preview');
      assert.ok(shown.sessions.length > 0);
      assert.deepEqual(shown.specialtyLeftOut, ['Atlas Stones']);
      assert.deepEqual(shown.unresolvedNames, ['Moon Squat Deluxe']);

      // A usable answer is itself, untouched.
      const usable = resolveLiveProposal(
        { title: 'Legs', sessions: [{ name: 'Day 1', exercises: [{ name: 'Barbell Full Squat', sets: 4, repsMin: 5, repsMax: 5 }] }] },
        brief, seeded, 120, preferences,
      );
      assert.equal(liveProposalOrPreview(usable, () => { throw new Error('preview not needed'); }), usable);
    },
  },
];
