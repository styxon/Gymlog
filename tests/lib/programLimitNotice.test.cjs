const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { programSlotsLineKey, resolveProgramSlots } = require('../../.test-dist/lib/programSlots.js');
const {
  ONBOARDING_PLAN_PREFIX,
  findReplaceableOnboardingTemplateId,
} = require('../../.test-dist/lib/activeProgramSet.js');
const { t } = require('../../.test-dist/lib/i18n.js');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

/**
 * The free programme limits, said before and at the wall (user 2026-09-14).
 *
 * A counter above "your programmes" once one place is left, one sheet for both
 * limits with the count in its title, and answering setup again writes over
 * the programme the last run made instead of filling the limit with copies.
 */

const root = path.join(__dirname, '..', '..');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (...parts) => strip(fs.readFileSync(path.join(root, ...parts), 'utf8'));

function body(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} is gone`);
  const ends = ['\n  function ', '\n  async function ']
    .map((marker) => source.indexOf(marker, start + signature.length))
    .filter((index) => index > 0);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

/**
 * App.tsx and every src/app module, each read on its own so no match can run
 * from one file into the next. Found rather than listed: the phase-B split
 * (2026-09-30) moved VinhaApp's hooks into src/app, and the phase-C split
 * moved the shell's render tail (the sheets included) there too.
 */
function shellSources() {
  const appModules = fs
    .readdirSync(path.join(root, 'src', 'app'))
    .filter((name) => /\.tsx?$/.test(name))
    .sort();
  assert.ok(appModules.length > 0, 'src/app holds no modules');
  return [read('App.tsx'), ...appModules.map((name) => read('src', 'app', name))];
}

const template = (id, createdAt, updatedAt = createdAt) => ({ id, createdAt, updatedAt });

module.exports = [
  {
    name: 'programme limit: the counter shows with one place left and at the wall, never on Pro',
    run() {
      const free = (used) => programSlotsLineKey(resolveProgramSlots(used, false));
      assert.equal(free(0), null);
      assert.equal(free(1), null, 'a count nobody is near is a sign about nothing');
      assert.equal(free(2), 'lastPlace');
      assert.equal(free(3), 'atCap');
      assert.equal(free(4), 'over', 'over the limit from before is still the wall, and says how many it takes');
      assert.equal(programSlotsLineKey(resolveProgramSlots(9, true)), null);

      assert.equal(t('fi', 'programLimit.lastPlace', { used: 2, limit: 3 }), '2/3 omaa ohjelmaa · yksi paikka jäljellä');
      assert.equal(t('fi', 'programLimit.atCap', { used: 3, limit: 3 }), '3/3 omaa ohjelmaa · poista yksi tehdäksesi uuden');
      assert.equal(t('en', 'programLimit.lastPlace', { used: 2, limit: 3 }), '2/3 programmes of your own · one place left');
    },
  },
  {
    name: 'programme limit: the sheet names the wall with its count and offers the free way past it',
    run() {
      assert.equal(t('fi', 'programLimit.title', { used: 3, limit: 3 }), 'Omat ohjelmasi ovat täynnä · 3/3');
      assert.match(t('fi', 'programLimit.body', { limit: 3 }), /^Ilmaisella voit pitää 3 omaa ohjelmaa\. Poista yksi tehdäksesi uuden/);
      assert.equal(t('fi', 'programLimit.cta'), 'Avaa lisää ohjelmia');
      assert.equal(t('fi', 'programLimit.later'), 'Selvä');
      assert.equal(t('fi', 'programLimit.running.title', { used: 2, limit: 2 }), 'Ohjelmapaikkasi ovat täynnä · 2/2');
      assert.match(t('fi', 'programLimit.running.body', { limit: 2 }), /Lopeta yksi aloittaaksesi uuden/);
      assert.equal(t('en', 'programLimit.cta'), 'Unlock more programmes');

      const sheet = read('src', 'components', 'ProgramLimitSheet.tsx');
      // The words are picked in programLimitSheetCopy (at the limit or past it).
      assert.match(sheet, /programLimitSheetCopy\(kind, used, limit, replacingStop\)/);
      assert.doesNotMatch(sheet, /programLimit\.count/, 'the count is in the title now, not said twice');
    },
  },
  {
    name: 'programme limit: a full set of running programmes shows the sheet, then Pro only if asked',
    run() {
      const app = read('App.tsx');
      // The straight-to-paywall branch must not come back anywhere in the
      // shell: App.tsx or a src/app module (phase-B split, 2026-09-30).
      assert.doesNotMatch(
        strip(readAppWiring()),
        /if \(decision\.canUpgrade\) \{\s*navigate\(\{ tab: 'profile', screen: 'premium', reason: 'program_cap' \}\)/,
        'a free reader at the running limit is still sent straight to the paywall',
      );
      // The sheet takes the decision's numbers, or — on a door that can
      // replace a finished programme — the refusal built from them
      // (runningCapRefusal, hunt 10, #20).
      const sheetBlock = /if \(decision\.canUpgrade\) \{\s*setRunningCapSheet\(\{ visible: true, (?:used: decision\.used, cap: decision\.cap, replacingStop: null|\.\.\.refusal) \}\)/g;
      // Both adoption paths, switching a held programme back on — which runs
      // under the same cap (device, 2026-09-16) — and resuming a held one from
      // an adoption, which is the same cap again (audit round 4, 2026-09-20).
      // Counted over the whole shell, and each path by name, to its own
      // closing brace: phase C (2026-10-01) moves two of the four to src/app.
      const shell = strip(readAppWiring());
      assert.equal((shell.match(sheetBlock) ?? []).length, 4, 'every path that starts a programme running shows the sheet');
      for (const signature of [
        'async function resumeHeldProgramme(',
        'async function handleAdoptReadyProgram(',
        'async function handleResumeProgram(',
        'async function handleAdoptCustomProgram(',
      ]) {
        assert.equal((functionBody(shell, signature).match(sheetBlock) ?? []).length, 1, `${signature} shows the sheet`);
      }
      assert.match(functionBody(shell, 'async function handleResumeProgram('), /evaluateProgramAdoption\(/);
      // The sheet itself mounts in the shell's render tail, which may sit in
      // App.tsx or a src/app module; matched within one file.
      assert.ok(
        shellSources().some((source) =>
          /kind="running"[\s\S]{0,400}navigate\(\{ tab: 'profile', screen: 'premium', reason: 'program_cap' \}\)/.test(source),
        ),
        'the running-limit sheet no longer offers Pro on request',
      );

      // The programme page's "take it on" answers only once it is running —
      // and it no longer leaves the page: being carried to Home the moment a
      // programme was adopted read as the app leaving where the reader was
      // (device, 2026-09-16). The toast follows the write.
      const workoutTab = read('src', 'app', 'renderWorkoutTab.tsx');
      for (const adopt of ['handleAdoptReadyProgram', 'handleAdoptCustomProgram']) {
        assert.match(
          workoutTab,
          new RegExp(`void ${adopt}\\(route\\.workoutTemplateId, \\{ lead: true \\}\\)\\.then\\(\\(adopted\\) => \\{\\s*if \\(adopted\\) \\{\\s*showToast\\(t\\(preferences\\.appLanguage, 'toast\\.programStarted'\\)\\);`),
          `${adopt} confirms before the write resolves, or leaves the page`,
        );
      }
      assert.match(body(app, 'async function handleAdoptCustomProgram'), /return false;\s*\}\s*showToast\(programCapFullMessage\(preferences\.appLanguage, decision\.used, decision\.cap\)/);

      const programs = read('src', 'screens', 'ProgramsHomeScreen.tsx');
      assert.match(programs, /\{ownProgramsLine \? <Text style=\{styles\.ownProgramsLine\}>\{ownProgramsLine\}<\/Text> : null\}/);
      const tab = read('src', 'app', 'renderWorkoutTab.tsx');
      assert.match(tab, /ownProgramsLine=\{\(\(\) => \{\s*const key = programSlotsLineKey\(programSlots\)/);
    },
  },
  {
    // A CSV import at the limit awaited the provider's refusal and sat there.
    name: 'programme limit: every import path shows the sheet instead of failing silently',
    run() {
      // App.tsx and every src/app module, not the tabs by name: an import
      // path in any of them is held to the same rule. Each handler runs to
      // the `}}` at its own prop's indentation, whatever that indentation is.
      let imports = 0;
      for (const source of shellSources()) {
        for (const match of source.matchAll(/\n([ \t]*)onImportProgram=\{async \(draft\) => \{([\s\S]*?)\r?\n\1\}\}/g)) {
          imports += 1;
          assert.match(match[2], /createUnlessAtLimit\(\s*\(\) => upsertWorkoutTemplate\(draft\),\s*\(\) => setProgramLimitVisible\(true\),?\s*\)/);
        }
      }
      assert.equal(imports, 3, `expected three import paths, found ${imports}`);
    },
  },
  {
    name: 'programme limit: answering setup again writes over the untouched programme the last run made',
    run() {
      const lead = `${ONBOARDING_PLAN_PREFIX}tpl_old`;
      const at = '2026-09-01T10:00:00.000Z';

      const untrained = [];
      assert.equal(
        findReplaceableOnboardingTemplateId({ activePlanId: lead, activePlanIds: [lead], templates: [template('tpl_old', at)], sessions: untrained }),
        'tpl_old',
      );
      // Trained, never edited: writing over it would regenerate its exercise
      // rows under new ids and cut every "last time" and record lookup off
      // from the sessions logged against the old ones. It stays.
      assert.equal(
        findReplaceableOnboardingTemplateId({
          activePlanId: lead,
          activePlanIds: [lead],
          templates: [template('tpl_old', at)],
          sessions: [{ workoutTemplateId: 'tpl_old' }],
        }),
        null,
      );
      // A session logged against some other programme does not protect this one.
      assert.equal(
        findReplaceableOnboardingTemplateId({
          activePlanId: lead,
          activePlanIds: [lead],
          templates: [template('tpl_old', at)],
          sessions: [{ workoutTemplateId: 'tpl_other' }],
        }),
        'tpl_old',
      );
      // Edited since: the reader's work, kept, and the new run is a new programme.
      assert.equal(
        findReplaceableOnboardingTemplateId({
          activePlanId: lead,
          activePlanIds: [lead],
          templates: [template('tpl_old', at, '2026-09-05T08:00:00.000Z')],
          sessions: untrained,
        }),
        null,
      );
      // A programme adopted by hand is never written over — even one whose id,
      // cut where an onboarding prefix would end, names an untouched template.
      const handAdopted = 'custom_plan_ab12tpl_mine';
      assert.equal(handAdopted.slice(ONBOARDING_PLAN_PREFIX.length), 'tpl_mine');
      assert.equal(
        findReplaceableOnboardingTemplateId({
          activePlanId: handAdopted,
          activePlanIds: [handAdopted],
          templates: [template('tpl_mine', at)],
          sessions: untrained,
        }),
        null,
      );
      // Not running: the last run's programme was already set aside by the reader.
      assert.equal(
        findReplaceableOnboardingTemplateId({ activePlanId: null, activePlanIds: [], templates: [template('tpl_old', at)], sessions: untrained }),
        null,
      );
      // Its template is gone.
      assert.equal(findReplaceableOnboardingTemplateId({ activePlanId: lead, activePlanIds: [lead], templates: [], sessions: untrained }), null);
      // The lead is asked first; an edited lead lets an untouched one behind it go.
      const second = `${ONBOARDING_PLAN_PREFIX}tpl_second`;
      assert.equal(
        findReplaceableOnboardingTemplateId({
          activePlanId: lead,
          activePlanIds: [second, lead],
          templates: [template('tpl_old', at, '2026-09-05T08:00:00.000Z'), template('tpl_second', at)],
          sessions: untrained,
        }),
        'tpl_second',
      );
    },
  },
  {
    name: 'programme limit: both finishes pass the replaceable id, and a replaced programme stays replaceable',
    run() {
      // Over the shell: the finishes move to src/app in phase C (2026-10-01).
      const app = strip(readAppWiring());
      // Each finish to its own closing brace, not on to the next declaration.
      for (const signature of ['async function handleOnboardingCompleteToTraining', 'async function handleSetupCompleteToTraining']) {
        assert.match(functionBody(app, signature), /templateDraft: withReplaceableOnboardingId\(savedPlan\.draft\)/);
      }
      assert.match(
        functionBody(app, 'function withReplaceableOnboardingId('),
        /findReplaceableOnboardingTemplateId\(\{[\s\S]*templates: database\.workoutTemplates,\s*sessions: database\.workoutSessions,/,
      );

      // An in-place write keeps createdAt and moves updatedAt, which would read
      // as "edited" and stop the next run from replacing it.
      const provider = read('src', 'state', 'AppProvider.tsx');
      assert.match(
        body(provider, 'function saveOnboardingResult'),
        /template\.id === built\.workoutTemplateId \? \{ \.\.\.template, createdAt: template\.updatedAt \} : template/,
      );
    },
  },
];
