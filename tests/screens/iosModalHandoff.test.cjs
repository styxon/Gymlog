const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const player = readGuidedPlayerSource();
const hook = read('src', 'hooks', 'useModalHandoff.ts');

/**
 * #bugs 2026-10-17, iOS build 4: "Ohita tämä liike" froze the whole app.
 * React Native presents every Modal from the root view controller on iOS, and
 * UIKit refuses a second presentation while that controller is still showing a
 * sheet, or still animating it away — yet React Native records the second
 * modal as shown, and touches stop. The confirmation was opened over the open
 * actions sheet. These pin the handoff: a modal opened from the actions or
 * exit sheet opens only after that sheet has gone.
 */
module.exports = [
  {
    name: 'iOS modal handoff: the actions and exit sheets open no modal in the same tick as they close',
    run() {
      // Each opener that starts from one of the two sheets goes through handOff.
      for (const open of [
        'setConfirmingSkipExercise(true)',
        'setConfirmingEnd(true)',
        'setRunSheetOpen(true)',
        'setSwapOpen(true)',
      ]) {
        const escaped = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const handed = new RegExp(`handOff\\(\\s*\\(\\) => set(?:PauseSheet|Exit)Open\\(false\\),\\s*\\(\\) => ${escaped},?\\s*\\)`);
        if (open === 'setRunSheetOpen(true)' || open === 'setSwapOpen(true)') {
          // These are also opened from the screen itself, with no sheet up.
          assert.match(player, handed, `${open} from a sheet goes through handOff`);
        } else {
          assert.match(player, handed, `${open} goes through handOff`);
          assert.equal(player.split(open).length - 1, 1, `${open} is opened only through handOff`);
        }
      }
      // No sheet is closed and another modal opened on the next line. The
      // contents sheet joined (iOS hunt 2026-10-17): its pencil closed it and
      // opened the set correction in one handler.
      assert.doesNotMatch(
        player,
        /set(?:PauseSheet|Exit|RunSheet)Open\(false\);\s*(?:moveOnFromMenu\(\);\s*)?set(?:\w+Open\(true\)|Confirming\w+\(true\)|RestEdit\(\{)/,
        'a sheet closes and the next modal opens in the same tick',
      );
      // The correction opens from the pencil only, and only through handOff.
      assert.match(player, /handOff\(\s*\(\) => setRunSheetOpen\(false\),\s*\(\) =>\s*setRestEdit\(\{/);
      assert.equal(player.split('setRestEdit({').length - 1, 1, 'the correction is opened only through handOff');
      // The skip confirmation is not asked over the open sheet either.
      assert.doesNotMatch(player, /onPress=\{\(\) => setConfirmingSkipExercise\(true\)\}/);
    },
  },
  {
    name: 'iOS modal handoff: the two sheets stay mounted and report their dismissal',
    run() {
      assert.match(player, /<GPSheet\s+visible=\{pauseSheetOpen\}\s+onDismissed=\{onSheetDismissed\}/);
      assert.match(player, /<GPSheet\s+visible=\{exitOpen\}\s+onDismissed=\{onSheetDismissed\}/);
      assert.doesNotMatch(player, /\{pauseSheetOpen && \(/);
      assert.doesNotMatch(player, /\{exitOpen && \(/);
      // GPSheet hands both to its Modal: iOS reports onDismiss only for a
      // Modal whose visible turned false, never for one that unmounted.
      assert.match(player, /<Modal\s+visible=\{visible\}\s+transparent\s+animationType="fade"\s+onRequestClose=\{onClose\}\s+onDismiss=\{onDismissed\}/);
      // A sheet closed by a pull opens again at rest.
      assert.match(player, /if \(visible\) \{\s*dragY\.setValue\(0\);/);
      // Cancelling the skip, with the sheet already gone, closes the menu.
      assert.match(player, /onCancel=\{\(\) => \{\s*setConfirmingSkipExercise\(false\);\s*closeActionsMenu\(\);/);
    },
  },
  {
    name: 'iOS modal handoff: the hook waits on iOS only, and never forever',
    run() {
      assert.match(hook, /if \(Platform\.OS !== 'ios'\) \{\s*close\(\);\s*open\(\);\s*return;/);
      assert.match(hook, /pending\.current = open;\s*close\(\);/);
      assert.match(hook, /setTimeout\(onSheetDismissed, MODAL_HANDOFF_FALLBACK_MS\)/);
      assert.match(hook, /export const MODAL_HANDOFF_FALLBACK_MS = \d+;/);
      // Run once: the dismissal and the timer both call it.
      assert.match(hook, /const next = pending\.current;\s*pending\.current = null;\s*next\?\.\(\);/);
    },
  },
  {
    /**
     * iOS hunt 2026-10-17 (P0-3, S4-2): the contents sheet's pencil opened
     * "Correct set" in the same tick as the sheet unmounted, iOS refused it,
     * and the rest clock stood still behind a correction that never showed.
     * Once it opened, a tap on another set row changed the editor's key,
     * which closed its Modal and presented a new one in one tick: the same
     * refusal.
     */
    name: 'iOS modal handoff: the contents sheet reports its dismissal, and the correction keeps its Modal',
    run() {
      assert.match(player, /<GPSheet\s+visible=\{runSheetOpen\}\s+onDismissed=\{onSheetDismissed\}/);
      assert.doesNotMatch(player, /\{runSheetOpen && \(/);
      // Its rows are built only while it is drawn: the player renders every
      // second, and a kept-mounted sheet's children are built on each render.
      assert.match(player, /<Deferred render=\{\(\) => buildGuidedRunSheet\(stepPlan, stepIndex\)/);
      assert.match(player, /function Deferred\(\{ render \}: \{ render: \(\) => React\.ReactNode \}\) \{\s*return <>\{render\(\)\}<\/>;/);
      // No key on the editor; its fields are keyed instead, inside the Modal.
      const call = player.slice(player.indexOf('<LoggedSetEditor\n'), player.indexOf('onCancel={() => setRestEdit(null)}'));
      assert.ok(call.length > 0 && call.length < 2600, 'the correction sheet moved');
      assert.doesNotMatch(call, /\bkey=/);
      const editor = player.slice(player.indexOf('function LoggedSetEditor('), player.indexOf('function LoggedSetEditorFields('));
      assert.match(editor, /<Modal visible transparent animationType="fade" onRequestClose=\{onCancel\}>/);
      assert.match(editor, /<LoggedSetEditorFields\s+key=\{fieldsKey\}/);
      assert.doesNotMatch(editor, /useState\(/, 'the drafts live in the keyed fields, not beside the Modal');
    },
  },
  {
    /**
     * iOS hunt 2026-10-17 (S5b-1): iOS does not lift a Modal's content for
     * the keyboard. The number pad covered the correction's fields and Save,
     * it has no return key, and the only thing left to tap was the dimmed
     * page, which cancelled.
     */
    name: 'iOS modal handoff: the correction rises over the keyboard and has a way off the number pad',
    run() {
      const editor = player.slice(player.indexOf('function LoggedSetEditor('), player.indexOf('function MinutesClockText('));
      assert.match(
        editor,
        /<KeyboardAvoidingView\s+behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}\s+style=\{styles\.editVeil\}\s*>/,
      );
      assert.match(editor, /onPress=\{\(\) => \(Keyboard\.isVisible\(\) \? Keyboard\.dismiss\(\) : onCancel\(\)\)\}/);
      const pads = [...editor.matchAll(/<TextInput\b[\s\S]*?\/>/g)].map((match) => match[0]);
      assert.equal(pads.length, 2, 'reps and weight');
      for (const input of pads) {
        assert.match(input, /keyboardType="(?:number|decimal)-pad"/);
        assert.match(input, /returnKeyType="done"/);
        assert.match(input, /inputAccessoryViewButtonLabel=\{t\(language, 'common\.done'\)\}/);
      }
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.match(i18n, /'common\.done': 'Done',/);
      assert.match(i18n, /'common\.done': 'Valmis',/);
    },
  },
  {
    /**
     * iOS hunt 2026-10-17. S4-4: an interval bout ran out under the contents
     * sheet, the rest-alert ask opened over it, iOS refused it, and its open
     * flag held every step clock after it. X2-1: the ask slides up by itself
     * just after the tap that logged a set; a second tap closed it mid-slide,
     * iOS dropped that dismissal, and the sheet stayed on screen with the app
     * thinking it closed.
     */
    name: 'iOS modal handoff: the rest-alert ask waits for a clear screen and for its own arrival',
    run() {
      assert.match(player, /blocked: runSheetOpen \|\| setPanelsOpen,/);
      const moment = read('src', 'hooks', 'useRestAlertPermissionMoment.ts');
      assert.match(moment, /restAlertMoment\(\{ permission, asked, alertsWanted, channelMuted, blocked \}\)/);
      const sheet = read('src', 'components', 'RestAlertsSheet.tsx');
      assert.match(sheet, /onShow=\{\(\) => setShown\(true\)\}/);
      assert.match(sheet, /const allow = \(\) => \{\s*if \(shown\) \{\s*onAllow\(\);/);
      assert.match(sheet, /const later = \(\) => \{\s*if \(shown\) \{\s*onLater\(\);/);
      assert.match(sheet, /if \(!visible\) \{\s*setShown\(false\);/);
      assert.match(sheet, /setTimeout\(\(\) => setShown\(true\), REST_ALERTS_SHOW_FALLBACK_MS\)/);
      // Every way out goes through the gate.
      assert.doesNotMatch(sheet, /\{onAllow\}|\{onLater\}/);
      assert.equal((sheet.match(/onPress=\{later\}/g) || []).length, 2, 'the scrim and Not now');
      assert.match(sheet, /onPress=\{allow\}/);
      assert.match(sheet, /onRequestClose=\{later\}/);
    },
  },
];
