const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveLiveProposal } = require('../../.test-dist/lib/programmeBrief.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const i18n = read('src', 'lib', 'i18n.ts');
const bothLanguages = (key) =>
  assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} is missing one of its two languages`);

/**
 * Actions that ran and left nothing behind — audit round 3, 2026-09-19.
 */
module.exports = [
  {
    name: 'coach: a week whose lifts the library does not know is not offered as one',
    run() {
      // The resolver drops what it cannot resolve, then drops any session left
      // with none. The server only promises sessions.length > 0.
      const proposal = resolveLiveProposal(
        {
          title: 'My Week',
          sessions: [
            { name: 'Day 1', focus: 'legs', exercises: [{ name: 'Zercher Kettlebell Wibble', sets: 3, repsMin: 8, repsMax: 10, restSeconds: 90 }] },
          ],
        },
        'kolme kertaa viikossa',
        [{ id: 'l1', name: 'Barbell Back Squat' }],
        90,
      );
      assert.deepEqual(proposal.sessions, [], 'nothing resolvable leaves no sessions');

      assert.ok(proposal.unresolvedNames.includes('Zercher Kettlebell Wibble'), 'and names what it dropped');

      const home = strip(read('src', 'app', 'renderHomeScreens.tsx'));
      // An answer that arrived with nothing usable falls back to the
      // deterministic composer, exactly as an answer that never arrived does.
      // Carrying the names it could not place: they are the one thing the
      // discarded answer knew that the composer does not, and the card that
      // lists them would otherwise be empty in the very case it exists for.
      // The rule lives in lib/programmeBrief (liveProposalOrPreview, tested in
      // tests/lib/programmeBrief); the screen must go through it.
      assert.match(home, /return liveProposalOrPreview\(resolved, \(\) => composeProgrammePreview\(/);
      // And nothing with no days is saved, whatever produced it: the provider
      // would fabricate one empty session out of it.
      assert.match(home, /if \(proposal\.sessions\.length === 0\) \{\s*showToast\(t\(preferences\.appLanguage, 'toast\.aiBuildFailed'\)\);\s*return;\s*\}/);
    },
  },
  {
    name: 'coach: a failed answer hands the question back to the field it was typed in',
    run() {
      const chat = strip(read('src', 'screens', 'AICoachChatScreen.tsx'));
      // The draft is cleared the moment the ask starts, so a failure left the
      // reader with an apology and nothing to retry with.
      assert.match(chat, /setDraft\(\(current\) => \(current\.trim\(\) \? current : trimmed\)\);/);
      // Only when the field is still empty: whatever they have started typing
      // since is theirs and is not overwritten.
      //
      // Bounded to the catch block, not sliced to the end of the file: an
      // open-ended window is satisfied by any later setDraft( the screen
      // grows, which is the guard-that-widens this same batch fixed next door
      // in guidedPlayerReliability.
      const start = chat.indexOf("text: t(language, 'coach.error')");
      assert.notEqual(start, -1, 'the failure message moved');
      const end = chat.indexOf('} finally {', start);
      assert.ok(end > start, 'the failure path no longer ends where this guard thinks');
      assert.match(chat.slice(start, end), /setDraft\(/, 'the restore must sit in the failure path');
    },
  },
  {
    name: 'editor: dropping days that hold lifts asks first',
    run() {
      const screen = strip(read('src', 'screens', 'CreateTemplateScreen.tsx'));
      // The chips are adjacent, so the tap that drops a day is a finger-width
      // from the one that keeps it — and the drop took the last days whole.
      assert.match(screen, /onPress=\{\(\) => requestSessionCount\(option\)\}/);
      assert.doesNotMatch(screen, /onPress=\{\(\) => setSessionCount\(option\)\}/);
      assert.match(screen, /function requestSessionCount\(nextCount: TemplateDayCount\) \{/);
      // Asked only when there is something to lose: three empty days becoming
      // two is not a question.
      assert.match(
        screen,
        /if \(nextCount >= sessions\.length \|\| dropped\.every\(\(session\) => session\.exercises\.length === 0\)\) \{\s*setSessionCount\(nextCount\);\s*return;\s*\}/,
      );
      assert.match(screen, /<ConfirmDialog[\s\S]{0,400}visible=\{pendingDayDrop !== null\}/);
      assert.match(screen, /onConfirm=\{\(\) => \{[\s\S]{0,300}setSessionCount\(target\.nextCount\);/);
      // The number the dialog states is every day the slice takes. Counting
      // only the days that hold lifts said "one day" while two disappeared
      // (review of this batch) — a number disagreeing with what sits beside
      // it, which is what the batch before this one was about.
      assert.match(screen, /const dropped = sessions\.slice\(nextCount\);/);
      assert.match(screen, /setPendingDayDrop\(\{ nextCount, days: dropped\.length \}\);/);
      // And it is one string per count, the way every other counted line in
      // this screen is (tpl.exerciseOne / tpl.exerciseMany above it): "1
      // päivää" is not Finnish.
      assert.match(screen, /dayDropCount === 1 \? 'tpl\.dropDays\.titleOne' : 'tpl\.dropDays\.titleMany'/);
      assert.match(screen, /dayDropCount === 1 \? 'tpl\.dropDays\.bodyOne' : 'tpl\.dropDays\.bodyMany'/);
      // Read past the closing, so the body does not repaint as "0 päivää"
      // while the dialog fades out.
      assert.match(screen, /const dayDropCount = pendingDayDrop\?\.days \?\? lastDayDropCount\.current;/);
      for (const key of [
        'tpl.dropDays.titleOne',
        'tpl.dropDays.titleMany',
        'tpl.dropDays.bodyOne',
        'tpl.dropDays.bodyMany',
        'tpl.dropDays.confirm',
      ]) {
        bothLanguages(key);
      }
      // Back is the reflexive no on Android; the dialog that carries this
      // question has to accept it.
      const dialog = strip(read('src', 'components', 'ConfirmDialog.tsx'));
      assert.match(dialog, /<Modal visible=\{visible\} transparent animationType="fade" onRequestClose=\{onCancel\}>/);
    },
  },
];
