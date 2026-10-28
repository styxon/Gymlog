const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FREE_CUSTOM_PROGRAM_LIMIT,
  ProgramLimitReachedError,
  resolveProgramSlots,
} = require('../../src/lib/programSlots');

const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

module.exports = [
  {
    name: 'programSlots: three of your own on free, unlimited on Pro',
    run() {
      assert.equal(FREE_CUSTOM_PROGRAM_LIMIT, 3);

      const empty = resolveProgramSlots(0, false);
      assert.equal(empty.canCreate, true);
      assert.equal(empty.limit, 3);

      // The cap binds at the limit, not past it: with three you cannot make a
      // fourth. PPL is exactly three, so the most common split in the world
      // sits on the ceiling with no room for a deload or a travel variant —
      // which is the point, and a deliberate step tighter than Hevy's four.
      assert.equal(resolveProgramSlots(2, false).canCreate, true);
      assert.equal(resolveProgramSlots(3, false).canCreate, false);

      for (const count of [0, 3, 9]) {
        const pro = resolveProgramSlots(count, true);
        assert.equal(pro.canCreate, true, `pro at ${count}`);
        assert.equal(pro.limit, null, `pro at ${count}`);
        assert.equal(pro.overLimit, false, `pro at ${count}`);
      }
    },
  },
  {
    name: 'programSlots: a user already over the cap keeps everything and can still edit',
    run() {
      // Hevy's rule, deliberately. Taking something back is the one move that
      // turns a pricing change into a grievance — Hevy removed a shipped
      // feature once and had to restore it after the backlash. So a lapsed or
      // migrated user with nine programs keeps all nine; only the tenth is
      // refused, and nothing in this shape can express "delete some".
      const over = resolveProgramSlots(9, false);
      assert.equal(over.used, 9);
      assert.equal(over.canCreate, false);
      assert.equal(over.overLimit, true);
      assert.equal(over.limit, 3);

      // Negative counts cannot make a slot appear.
      assert.equal(resolveProgramSlots(-4, false).used, 0);
    },
  },
  {
    name: 'the cap is enforced where programs are made, not where they are asked for',
    run() {
      const provider = read('src', 'state', 'AppProvider.tsx');

      // One choke point. Five screens can ask for a program; a check on each
      // is a check that can be forgotten, and forgetting it hands out a paid
      // slot silently.
      assert.match(
        provider,
        /if \(!existingTemplate && draft\.origin !== 'freestyle'\) \{[\s\S]{0,400}ProgramLimitReachedError/,
      );
      // No exemption for a copy that replaces a running ready programme. There
      // was one, on the grounds that the reader ends with as many programmes
      // as before — but the ready one was never theirs, so each edit → adopt
      // the next → edit round added a copy past the cap (audit 2026-09-16).
      const code = provider.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.doesNotMatch(code, /replacesPlanId|replacesRunningPlan/);
      // Counted over AUTHORED templates: a freestyle log leaves a template
      // behind, and counting those meant three ad-hoc sessions filled the free
      // tier without the user authoring anything.
      assert.match(provider, /resolveProgramSlots\(\s*countAuthoredPrograms\(current\.workoutTemplates\)/);
      assert.match(provider, /isProUnlocked\(current\.preferences\)/);

      // Editing must never be blocked — the guard sits inside the
      // "no existing template" branch, which is the create case only.
      const gate = provider.slice(
        provider.indexOf("if (!existingTemplate && draft.origin !== 'freestyle') {"),
        provider.indexOf('const workoutTemplateId ='),
      );
      assert.ok(gate.includes('ProgramLimitReachedError'), 'the throw belongs to the create branch');

      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      // The two authoring entries check before navigating, so the wall lands
      // where the user pressed rather than after they have filled in a form.
      assert.match(app, /programSlots\.canCreate[\s\S]{0,120}setProgramLimitVisible\(true\)/);
      // And the create path still catches the throw, because a screen can be
      // reached by a route the button did not open.
      assert.match(app, /error instanceof ProgramLimitReachedError/);
    },
  },
  {
    name: 'the cap is on authoring: the catalog and the log stay uncapped',
    run() {
      // The Pro page (v3) dropped the free/premium table, and v6 moved the
      // rows out of the screen into lib/proTiers. What this checks has not
      // moved with them: the number in the sales copy is interpolated from the
      // constant that enforces the cap, not typed next to it.
      const premium = read('src', 'lib', 'proTiers.ts');
      assert.match(
        premium,
        /titleKey: 'pro\.v6\.free\.own\.t',[\s\S]{0,200}?vars: \{ cap: FREE_CUSTOM_PROGRAM_LIMIT \}/,
        'the programs row must take its free number from FREE_CUSTOM_PROGRAM_LIMIT',
      );
      const copy = read('src', 'lib', 'i18n.ts')
        .split('\n')
        .filter((line) => line.includes("'pro.v6.free.own.t':"));
      assert.equal(copy.length, 2, 'both languages');
      for (const line of copy) {
        assert.match(line, /\{cap\}/, 'the cap must be a placeholder, never a typed digit');
      }

      // Ready programs and logging are identical in both tiers. v6 lists both
      // on the Free tab, which is the honest place for them; what must never
      // happen is either appearing among the things Pro adds. If one ever
      // becomes a real difference that is a decision, not a drift.
      const proRows = premium.match(/pro: \{[\s\S]*?\n  \},/);
      assert.ok(proRows, 'the Pro tier block should be findable');
      assert.doesNotMatch(proRows[0], /pro\.v6\.[a-z]+\.(ready|logging)/);

      // The wall says what it does not touch. "Three programs" alone reads as
      // a limit on training. And since 2026-09-14 it also says the free way
      // past it: deleting one makes room.
      const i18n = read('src', 'lib', 'i18n.ts');
      const body = i18n.split('\n').filter((line) => line.includes("'programLimit.body':"));
      assert.equal(body.length, 2, 'both languages');
      assert.match(body[0], /Ready-made programmes and your training history stay free/);
      assert.match(body[0], /Delete one to make a new one/);
      assert.match(body[1], /Valmiit ohjelmat ja treenihistoriasi pysyvät ilmaisina/);
      assert.match(body[1], /Poista yksi tehdäksesi uuden/);
    },
  },
  {
    name: 'changing a ready programme copies it, in its place, and the copy counts toward the free limit',
    run() {
      const plan = read('src', 'screens', 'TrainingPlanScreen.tsx');
      const detail = read('src', 'screens', 'ProgramDetailScreen.tsx');
      const day = read('src', 'screens', 'ProgramDayScreen.tsx');
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();

      // "Tee tästä oma versio" stood on all three screens and was removed
      // (user 2026-08-26): it asked the reader to understand that catalog
      // programmes are fixed and theirs are not, before they could change one
      // lift — and the reader hunting for a way to drop an exercise never
      // found it. The duplication still happens, underneath the change.
      for (const source of [plan, detail, day]) {
        assert.doesNotMatch(source, /copyToCustom|ownVersion/);
      }
      assert.doesNotMatch(app, /handleCopyReadyProgramToCustom/);

      // It still reuses the one duplication path rather than a second copier.
      assert.match(app, /buildDuplicatedCustomProgramDraft\([\s\S]{0,80}template\.name/);
      // And the copy replaces the running plan instead of joining it, so the
      // reader runs the number of programmes they ran.
      assert.match(app, /removeActiveProgram\(preferences\.activePlanIds, readyPlanId\)/);
      // But it is a programme of their own either way, so it takes a slot:
      // running or browsed, the copy is refused at the limit — with the same
      // sheet a new programme opens, before anything is built. Editing the
      // copy afterwards is an edit and goes down the custom path uncapped.
      const copy = app.slice(
        app.indexOf('const existingCopyId = await findWorkoutTemplateIdBySource(programId);'),
        app.indexOf('const draft = buildDuplicatedCustomProgramDraft('),
      );
      assert.ok(copy.length > 0, 'the ready-programme copy path should be findable');
      assert.match(copy, /if \(existingCopyId\) \{[\s\S]*?return false;\s*\}/);
      assert.match(copy, /if \(!programSlots\.canCreate\) \{\s*setProgramLimitVisible\(true\);\s*return false;\s*\}/);
      assert.ok(
        copy.indexOf('if (existingCopyId) {') < copy.indexOf('if (!programSlots.canCreate) {'),
        'an existing copy is opened before the cap is asked',
      );
      assert.doesNotMatch(copy, /wasRunning && !programSlots|!wasRunning/);
      assert.match(app, /const workoutTemplateId = await upsertWorkoutTemplate\(draft\);/);
    },
  },
  {
    name: 'ProgramLimitReachedError carries the limit it hit',
    run() {
      const error = new ProgramLimitReachedError(3);
      assert.equal(error.limit, 3);
      assert.equal(error.name, 'ProgramLimitReachedError');
      assert.ok(error instanceof Error);
    },
  },
  {
    name: 'the free-tier claim about ready programs counts the catalog it names',
    run() {
      // The block above the cap said 55 while the catalog held 57, and
      // nothing broke — which is exactly why it drifted. That sentence is
      // the one lifted into store copy, so the number in it is a claim,
      // and a claim in this repo has to be checkable against the thing it
      // counts rather than against the last time someone looked.
      const source = read('src', 'lib', 'programSlots.ts');
      const match = source.match(/Ready programs\. All (\d+) stay free/);
      assert.ok(match, 'the ready-program claim was reworded — repoint or drop this guard');
      assert.equal(
        Number(match[1]),
        WORKOUT_TEMPLATES_V1.length,
        'programSlots.ts names a ready-program count the catalog no longer has',
      );
    },
  },
];
