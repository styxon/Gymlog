const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

const {
  evaluateProgramAdoption,
  addActiveProgram,
  placesToFree,
  resolveActiveProgramCap,
} = require('../../.test-dist/lib/activeProgramSet.js');
const { runningSetWithout } = require('../../.test-dist/lib/runningProgrammes.js');
const {
  carryCompletionDismissal,
  forgetCompletionDismissals,
  resolveCompletionCard,
} = require('../../.test-dist/lib/programCompletion.js');
const {
  describeProgramCap,
  programCapFullMessage,
  programCapLineKey,
  programLimitSheetCopy,
} = require('../../.test-dist/lib/programCapNotice.js');
const { programSlotsLineKey, resolveProgramSlots } = require('../../.test-dist/lib/programSlots.js');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * Three findings about a programme's life (hunt 9, 2026-10-09):
 *
 * - #56 "Start next" on the completion card left the finished programme
 *   running, and it kept a cap slot: a free reader at 2/2 met the paywall
 *   sheet after one step-up. The next programme REPLACES the finished one.
 * - #57 The completion card's dismissal is keyed by plan id, so a removed and
 *   re-adopted programme (same deterministic id) never showed its second
 *   round's card, and the copy a lift edit mints inherited the finished block
 *   under a new id and asked again.
 * - #58 A lapsed Pro keeps every programme it was running, and the cap text
 *   said "stop one" at 5/2, then refused again at 4/2. It names how many now.
 *
 * The handlers are React, so the rules are tested where they live (src/lib)
 * and the wiring is pinned by source, comments stripped.
 */

const root = path.join(__dirname, '..', '..');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (...parts) => strip(fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n'));
const shell = strip(readAppWiring());

const plan = (id, templateId) => ({ id, name: id, entries: [{ workoutTemplateId: templateId }] });

module.exports = [
  // ---- #56 ----
  {
    name: 'start next: the finished programme gives its slot up, so a free reader at 2/2 is not sent to the paywall',
    run() {
      const plans = [plan('ready_plan_a', 'a'), plan('ready_plan_b', 'b')];
      const running = { activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a', 'ready_plan_b'] };

      // The finding: measured against the full set, the step-up is refused.
      const before = evaluateProgramAdoption({
        activePlanIds: running.activePlanIds,
        targetPlanId: 'ready_plan_next',
        proUnlocked: false,
      });
      assert.equal(before.kind, 'blocked');

      const without = runningSetWithout({ ...running, plans, replacingPlanId: 'ready_plan_a' });
      assert.deepEqual(without.activePlanIds, ['ready_plan_b']);
      const after = evaluateProgramAdoption({
        activePlanIds: without.activePlanIds,
        targetPlanId: 'ready_plan_next',
        proUnlocked: false,
      });
      assert.equal(after.kind, 'adopt');
      assert.deepEqual(addActiveProgram(without.activePlanIds, 'ready_plan_next'), ['ready_plan_b', 'ready_plan_next']);
    },
  },
  {
    name: 'start next: the programme is stopped under every plan id that held it, and the lead passes on',
    run() {
      // Onboarding wrote one id and adoption another for the same programme.
      const plans = [plan('onboarding_plan_a', 'a'), plan('ready_plan_a', 'a'), plan('ready_plan_b', 'b')];
      const without = runningSetWithout({
        activePlanId: 'onboarding_plan_a',
        activePlanIds: ['onboarding_plan_a', 'ready_plan_a', 'ready_plan_b'],
        plans,
        replacingPlanId: 'ready_plan_a',
      });
      assert.deepEqual(without.activePlanIds, ['ready_plan_b']);
      assert.equal(without.activePlanId, 'ready_plan_b');

      // Another programme leading stays the lead.
      const kept = runningSetWithout({
        activePlanId: 'ready_plan_b',
        activePlanIds: ['ready_plan_a', 'ready_plan_b'],
        plans,
        replacingPlanId: 'ready_plan_a',
      });
      assert.equal(kept.activePlanId, 'ready_plan_b');
    },
  },
  {
    name: 'start next: nothing replaced leaves the set as it was, and a plan record that is gone is dropped by id',
    run() {
      const plans = [plan('ready_plan_a', 'a')];
      const same = runningSetWithout({
        activePlanId: 'ready_plan_a',
        activePlanIds: ['ready_plan_a', 'ready_plan_a'],
        plans,
        replacingPlanId: undefined,
      });
      assert.deepEqual(same, { activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a'] });

      const notRunning = runningSetWithout({
        activePlanId: 'ready_plan_a',
        activePlanIds: ['ready_plan_a'],
        plans: [...plans, plan('ready_plan_old', 'old')],
        replacingPlanId: 'ready_plan_old',
      });
      assert.deepEqual(notRunning, { activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a'] });

      const noRecord = runningSetWithout({
        activePlanId: 'ghost',
        activePlanIds: ['ghost', 'ready_plan_a'],
        plans,
        replacingPlanId: 'ghost',
      });
      assert.deepEqual(noRecord, { activePlanId: 'ready_plan_a', activePlanIds: ['ready_plan_a'] });
    },
  },
  {
    name: 'start next: the card names the finished plan, and every adoption door measures and writes the replaced set',
    run() {
      const edits = read('src', 'app', 'programmePlanEdits.tsx');
      assert.match(
        functionBody(edits, 'async function handleCompletionStartNext'),
        /handleAdoptReadyProgram\(nextTemplateId, \{ lead: true, replacingPlanId: planId \}\)/,
      );

      // The cap is measured against what will be running, and the one write
      // carries the replaced set plus the new plan.
      const adopt = functionBody(shell, 'async function handleAdoptReadyProgram(');
      assert.match(adopt, /const running = runningSetWithout\(\{[^}]*replacingPlanId: options\.replacingPlanId/);
      assert.match(adopt, /evaluateProgramAdoption\(\{\s*activePlanIds: running\.activePlanIds,\s*targetPlanId: planId/);
      assert.match(adopt, /addActiveProgram\(running\.activePlanIds, plan\.id\)/);
      assert.doesNotMatch(adopt, /addActiveProgram\(preferences\.activePlanIds/);
      assert.match(adopt, /promoteHeldProgramToLead\(workoutTemplateId, options\.replacingPlanId\)/);
      assert.match(adopt, /promoteHeldProgramToLead\(copyTemplateId, options\.replacingPlanId\)/);

      // Resuming a held programme is the same door, same treatment.
      const starts = read('src', 'app', 'programmeStarts.tsx');
      const resume = functionBody(starts, 'async function resumeHeldProgramme(');
      assert.match(resume, /runningSetWithout\(\{[^}]*replacingPlanId: options\?\.replacingPlanId/);
      assert.match(resume, /evaluateProgramAdoption\(\{\s*activePlanIds: running\.activePlanIds/);
      assert.match(resume, /resumeProgramme\(\{\s*activePlanId: running\.activePlanId,\s*activePlanIds: running\.activePlanIds/);

      // A programme already running is promoted AND the finished one stopped, in one write.
      const switches = read('src', 'app', 'programmeSwitches.tsx');
      const promote = functionBody(switches, 'async function promoteHeldProgramToLead(');
      assert.match(promote, /runningSetWithout\(/);
      assert.match(promote, /updatePreferences\(\{\s*\.\.\.\(running \? \{ activePlanIds: running\.activePlanIds \} : \{\}\),\s*activePlanId: plan\.id/);
    },
  },

  // ---- #57 ----
  {
    name: 'completion card: a removed programme forgets its dismissal, so the second round is congratulated',
    run() {
      const input = (dismissedPlanIds) => ({
        planId: 'ready_plan_x',
        sessionsDone: 24,
        sessionsTotal: 24,
        activeTemplate: null,
        catalog: [],
        dismissedPlanIds,
      });
      // The finding: the stale answer outlives the plan record.
      assert.equal(resolveCompletionCard(input(['ready_plan_x'])), null);
      const forgotten = forgetCompletionDismissals(['ready_plan_x', 'ready_plan_y'], ['ready_plan_x']);
      assert.deepEqual(forgotten, ['ready_plan_y']);
      assert.notEqual(resolveCompletionCard(input(forgotten)), null);
      // Nothing to forget is not an error.
      assert.deepEqual(forgetCompletionDismissals(['ready_plan_y'], ['ready_plan_x']), ['ready_plan_y']);
    },
  },
  {
    name: 'completion card: the copy of a dismissed finished programme is dismissed too, a fresh one is not',
    run() {
      assert.deepEqual(
        carryCompletionDismissal(['ready_plan_x'], 'ready_plan_x', 'custom_plan_copy'),
        ['ready_plan_x', 'custom_plan_copy'],
      );
      // Never dismissed: the copy is a card still to be answered.
      assert.deepEqual(carryCompletionDismissal(['other'], 'ready_plan_x', 'custom_plan_copy'), ['other']);
      // Once only.
      assert.deepEqual(
        carryCompletionDismissal(['ready_plan_x', 'custom_plan_copy'], 'ready_plan_x', 'custom_plan_copy'),
        ['ready_plan_x', 'custom_plan_copy'],
      );
    },
  },
  {
    name: 'completion card: removing or deleting a programme and copying a ready one all move the dismissal in the same write',
    run() {
      const provider = read('src', 'state', 'AppProvider.tsx');
      const forget = functionBody(provider, '  function forgetHeldProgramme(');
      assert.match(
        forget,
        /await commit\(\{[\s\S]*?dismissedCompletionPlanIds: forgetCompletionDismissals\(\s*nextDatabase\.preferences\.dismissedCompletionPlanIds,\s*removedPlanIds,?\s*\)/,
        'forgetHeldProgramme leaves the removed plans\' dismissals behind',
      );
      const del = functionBody(provider, '  function deleteWorkoutTemplate(');
      assert.match(
        del,
        /dismissedCompletionPlanIds: forgetCompletionDismissals\(\s*nextDatabase\.preferences\.dismissedCompletionPlanIds,\s*planIdsHoldingTemplate\(current\.workoutPlans, workoutTemplateId\)/,
        'deleteWorkoutTemplate leaves the removed plans\' dismissals behind',
      );

      // The copy path: the dismissal travels in the write that places the copy.
      const edit = read('src', 'app', 'useProgramExerciseEdit.tsx');
      assert.match(
        edit,
        /await updatePreferences\(\{[\s\S]*?activePlanIds: addActiveProgram\([\s\S]*?\.\.\.\(wasHeld && preferences\.dismissedCompletionPlanIds\.includes\(readyPlanId\)[\s\S]*?dismissedCompletionPlanIds: carryCompletionDismissal\(\s*preferences\.dismissedCompletionPlanIds,\s*readyPlanId,\s*plan\.id,?\s*\)/,
        'the copy of a dismissed ready programme asks the completion question again',
      );
    },
  },

  // ---- #58 ----
  {
    name: 'cap text: past the cap it names how many to stop, and stopping that many is exactly what lets one more in',
    run() {
      assert.equal(placesToFree(2, 2), 1);
      assert.equal(placesToFree(5, 2), 4);
      assert.equal(placesToFree(0, 2), 1);
      // The text and the gate agree: give up `count` and the next adoption passes.
      for (const cap of [2, 5]) {
        for (let used = cap; used <= cap + 5; used += 1) {
          const ids = Array.from({ length: used }, (_, index) => `p${index}`);
          const kept = ids.slice(placesToFree(used, cap));
          const decision = evaluateProgramAdoption({
            activePlanIds: kept,
            targetPlanId: 'next',
            proUnlocked: cap === resolveActiveProgramCap(true),
          });
          assert.equal(decision.kind, 'adopt', `${used}/${cap}: stopping ${placesToFree(used, cap)} still refuses`);
          if (placesToFree(used, cap) > 1) {
            const one = evaluateProgramAdoption({
              activePlanIds: ids.slice(1),
              targetPlanId: 'next',
              proUnlocked: cap === resolveActiveProgramCap(true),
            });
            assert.equal(one.kind, 'blocked', `${used}/${cap}: stopping one is not enough, the text must not say so`);
          }
        }
      }
    },
  },
  {
    name: 'cap text: the running sheet past the cap says how many, in both languages; at the cap it still says one',
    run() {
      const at = programLimitSheetCopy('running', 2, 2);
      assert.equal(at.titleKey, 'programLimit.running.title');
      assert.equal(at.bodyKey, 'programLimit.running.body');
      assert.equal(t('en', at.bodyKey, at.vars).includes('Stop one to start another'), true);

      const over = programLimitSheetCopy('running', 5, 2);
      assert.equal(over.titleKey, 'programLimit.running.overTitle');
      assert.equal(over.bodyKey, 'programLimit.running.overBody');
      assert.deepEqual(over.vars, { used: 5, limit: 2, count: 4 });
      assert.equal(t('en', over.titleKey, over.vars), 'Programme places over the limit · 5/2');
      assert.match(t('en', over.bodyKey, over.vars), /Free runs 2 programmes at the same time, and 5 are running\. Stop 4 to start another/);
      assert.equal(t('fi', over.titleKey, over.vars), 'Ohjelmapaikat yli rajan · 5/2');
      assert.match(t('fi', over.bodyKey, over.vars), /sinulla on 5 käynnissä\. Lopeta 4 aloittaaksesi uuden/);

      const own = programLimitSheetCopy('own', 5, 3);
      assert.equal(own.bodyKey, 'programLimit.overBody');
      assert.match(t('en', own.bodyKey, own.vars), /Delete 3 to make a new one/);
      assert.match(t('fi', own.bodyKey, own.vars), /Poista 3 tehdäksesi uuden/);
      assert.equal(programLimitSheetCopy('own', 3, 3).bodyKey, 'programLimit.body');

      const sheet = read('src', 'components', 'ProgramLimitSheet.tsx');
      assert.match(sheet, /programLimitSheetCopy\(kind, used, limit\)/);
      assert.doesNotMatch(sheet, /'programLimit\.running\.body'/, 'the sheet picks its own words again');
    },
  },
  {
    name: 'cap text: the list line and the refusal toast name the excess instead of assuming used equals the cap',
    run() {
      const free = (ids) => describeProgramCap({ activePlanIds: ids, proUnlocked: false });
      assert.equal(programCapLineKey(free(['a', 'b'])), 'atCap');
      assert.equal(programCapLineKey(free(['a', 'b', 'c', 'd', 'e'])), 'over');
      const over = free(['a', 'b', 'c', 'd', 'e']);
      assert.equal(
        t('en', 'programs.cap.over', { used: over.used, cap: over.cap, count: placesToFree(over.used, over.cap) }),
        '5/2 programmes running · drop 4 to take on another',
      );
      assert.equal(
        t('fi', 'programs.cap.over', { used: 5, cap: 2, count: 4 }),
        '5/2 ohjelmaa käynnissä · poista 4 ottaaksesi uuden',
      );

      assert.equal(programCapFullMessage('en', 5, 5), 'You are running 5 programmes. Drop one to take on another.');
      assert.equal(programCapFullMessage('en', 6, 5), 'You are running 6 programmes, and 5 fit. Drop 2 to take on another.');
      assert.equal(programCapFullMessage('fi', 6, 5), 'Sinulla on 6 ohjelmaa käynnissä, ja 5 mahtuu. Poista 2 ottaaksesi uuden.');

      assert.equal(programSlotsLineKey(resolveProgramSlots(3, false)), 'atCap');
      assert.equal(programSlotsLineKey(resolveProgramSlots(5, false)), 'over');
      assert.equal(t('en', 'programLimit.over', { used: 5, limit: 3, count: 3 }), '5/3 programmes of your own · delete 3 to make another');
      assert.equal(t('fi', 'programLimit.over', { used: 5, limit: 3, count: 3 }), '5/3 omaa ohjelmaa · poista 3 tehdäksesi uuden');

      // Every door that refuses uses the one message.
      for (const file of [['App.tsx'], ['src', 'app', 'programmeStarts.tsx'], ['src', 'app', 'programmeSwitches.tsx']]) {
        const source = read(...file);
        assert.doesNotMatch(source, /'programs\.cap\.full'/, `${file.join('/')} builds its own refusal toast`);
        assert.match(source, /programCapFullMessage\(preferences\.appLanguage, decision\.used, decision\.cap\)/);
      }
    },
  },
];
