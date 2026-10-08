const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const {
  composeProgrammePreview,
  liveProposalOrPreview,
  parseProgrammeBrief,
  proposalLeftSomethingOut,
  resolveLiveProposal,
} = require(path.join(DIST, 'lib', 'programmeBrief.js'));
const { displayEquipmentValue } = require(path.join(DIST, 'lib', 'libraryLabel.js'));
const { createSeedDatabase, createSeedExerciseLibrary } = require(path.join(DIST, 'data', 'seed.js'));
const { t } = require(path.join(DIST, 'lib', 'i18n.js'));

/**
 * A live week is held to the brief the way the preview composer is: a lift
 * whose name carries a term the brief avoids (a refusal, or a lift that loads
 * a sore area) and a lift that needs gear the reader does not have are left
 * out and listed. Only the model's prompt stood between the reader and a
 * refused deadlift (bug hunt, 2026-10-07).
 */

const library = createSeedExerciseLibrary();
const preferences = createSeedDatabase().preferences;

const RAW = {
  title: 'Week',
  sessions: [
    {
      name: 'Day 1',
      exercises: [
        { name: 'Barbell Deadlift', sets: 3, repsMin: 5, repsMax: 5 },
        { name: 'Barbell Bench Press', sets: 3, repsMin: 5, repsMax: 5 },
        { name: 'Lat Pulldown', sets: 3, repsMin: 8, repsMax: 10 },
      ],
    },
  ],
};

function kept(proposal) {
  return proposal.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name));
}

module.exports = [
  {
    name: 'live limits: a lift the brief refuses is left out of the live week and listed',
    run() {
      const proposal = resolveLiveProposal(RAW, '3 päivää viikossa. Ei maastavetoa.', library, 90, preferences);
      assert.deepEqual(kept(proposal), ['Barbell Bench Press - Medium Grip', 'Wide-Grip Lat Pulldown']);
      assert.deepEqual(proposal.briefLeftOut, ['Barbell Deadlift']);
      assert.deepEqual(proposal.gearLeftOut, []);
      assert.equal(proposalLeftSomethingOut(proposal), true);
    },
  },
  {
    name: 'live limits: a sore back and bodyweight-only gear empty the week, and the preview stands in carrying both lists',
    run() {
      const brief = '3 days a week. Where: bodyweight only, no equipment. Back hurts.';
      const resolved = resolveLiveProposal(RAW, brief, library, 90, preferences);
      assert.deepEqual(resolved.sessions, []);
      assert.deepEqual(resolved.briefLeftOut, ['Barbell Deadlift']);
      assert.deepEqual(resolved.gearLeftOut, ['Barbell Bench Press - Medium Grip', 'Wide-Grip Lat Pulldown']);
      const shown = liveProposalOrPreview(resolved, () => composeProgrammePreview(brief, preferences, library));
      assert.equal(shown.source, 'preview');
      assert.ok(shown.sessions.length > 0);
      assert.deepEqual(shown.briefLeftOut, resolved.briefLeftOut);
      assert.deepEqual(shown.gearLeftOut, resolved.gearLeftOut);
    },
  },
  {
    name: 'live limits: the stored gear stands when the brief names none, and a place the brief names overrides it',
    run() {
      const home = { ...preferences, setupEquipment: 'home' };
      const silent = resolveLiveProposal(RAW, '3 päivää', library, 90, home);
      assert.deepEqual(kept(silent), ['Barbell Deadlift', 'Barbell Bench Press - Medium Grip']);
      assert.deepEqual(silent.gearLeftOut, ['Wide-Grip Lat Pulldown']);
      const gym = resolveLiveProposal(RAW, '3 päivää salilla', library, 90, home);
      assert.equal(kept(gym).length, 3);
      assert.deepEqual(gym.gearLeftOut, []);
    },
  },
  {
    name: 'live limits: what the live week keeps passes the preview composer\'s own test, brief after brief',
    run() {
      const all = {
        title: 'Everything',
        sessions: [
          {
            name: 'Day 1',
            exercises: library
              .filter((item, index) => index % 7 === 0)
              .map((item) => ({ name: item.name, sets: 3, repsMin: 8, repsMax: 8 })),
          },
        ],
      };
      const allowed = {
        bodyweight: new Set(['bodyweight']),
        minimal: new Set(['dumbbell', 'kettlebells', 'band', 'foam roll', 'bodyweight']),
      };
      for (const [brief, gear] of [
        ['Olkapää kipeä, ei maastavetoa. Paikka: kotona käsipainot.', 'minimal'],
        ['No bench press, knees hurt. Where: bodyweight only.', 'bodyweight'],
      ]) {
        const signals = parseProgrammeBrief(brief);
        assert.equal(signals.equipment, gear, brief);
        assert.ok(signals.avoidTerms.length > 0, brief);
        const proposal = resolveLiveProposal(all, brief, library, 90, preferences);
        const keptItems = proposal.sessions.flatMap((session) => session.exercises).map((exercise) => library.find((item) => item.id === exercise.libraryItemId));
        assert.ok(keptItems.length > 0, `${brief}: something is left to keep`);
        for (const item of keptItems) {
          const name = item.name.trim().toLowerCase();
          assert.ok(!signals.avoidTerms.some((term) => name.includes(term)), `${brief}: kept ${item.name}`);
          assert.ok(allowed[gear].has(displayEquipmentValue(item)), `${brief}: kept ${item.name} (${displayEquipmentValue(item)})`);
        }
        assert.ok(proposal.briefLeftOut.length > 0 && proposal.gearLeftOut.length > 0, brief);
      }
    },
  },
  {
    name: 'live limits: a week the coach wrote within the brief comes back whole and says nothing was left out',
    run() {
      const proposal = resolveLiveProposal(
        { title: 'Upper', sessions: [{ name: 'Day 1', exercises: [{ name: 'Barbell Bench Press', sets: 3, repsMin: 5, repsMax: 5 }] }] },
        '3 päivää, penkki',
        library,
        90,
        preferences,
      );
      assert.deepEqual(kept(proposal), ['Barbell Bench Press - Medium Grip']);
      assert.deepEqual([proposal.briefLeftOut, proposal.gearLeftOut, proposal.unresolvedNames, proposal.specialtyLeftOut], [[], [], [], []]);
      assert.equal(proposalLeftSomethingOut(proposal), false);
    },
  },
  {
    name: 'live limits: the card lists both, and its source line stops saying the week passed whole when something was left out',
    run() {
      for (const language of ['en', 'fi']) {
        for (const key of ['aiCompose.briefLeftOut', 'aiCompose.gearLeftOut']) {
          const text = t(language, key, { names: 'X' });
          assert.notEqual(text, key, `${language} ${key} missing`);
          assert.match(text, /X/);
        }
        assert.notEqual(t(language, 'aiCompose.source.liveTrimmed'), t(language, 'aiCompose.source.live'));
      }
      const card = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'ProgrammeProposalCard.tsx'), 'utf8');
      assert.match(card, /proposal\.briefLeftOut\?\.length \?[\s\S]*?'aiCompose\.briefLeftOut'/);
      assert.match(card, /proposal\.gearLeftOut\?\.length \?[\s\S]*?'aiCompose\.gearLeftOut'/);
      assert.match(card, /proposalLeftSomethingOut\(proposal\)\s*\?\s*'aiCompose\.source\.liveTrimmed'\s*:\s*'aiCompose\.source\.live'/);
      // The one caller passes the reader's preferences, so the stored gear is the one the week is held to.
      const caller = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'renderHomeScreens.tsx'), 'utf8');
      assert.match(caller, /resolveLiveProposal\(live, brief, exerciseLibrary, preferences\.defaultRestSeconds, preferences\)/);
    },
  },
];
