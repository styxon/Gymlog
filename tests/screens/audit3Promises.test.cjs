const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between, functionBody, windowBefore } = require('../helpers/sourceSlices.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const i18n = read('src', 'lib', 'i18n.ts');

function bothLanguages(key) {
  assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} is missing one of its two languages`);
}

/**
 * What the app promises and what it does — audit round 3, 2026-09-19.
 *
 * Wiring guards, comments stripped: every fix below explains the old shape in
 * a comment, and a guard a comment can satisfy guards nothing.
 */
module.exports = [
  {
    name: 'photo import: the notice the privacy policy promises is shown before the photo leaves',
    run() {
      // The photo import over the whole shell: it moves from VinhaApp to a
      // src/app module in phase C (2026-10-01).
      const app = strip(readAppWiring().replace(/\r\n/g, '\n'));

      // The policy, in both languages, says the online mode is entered by
      // reading a notice — and names importing from a photo as one of its
      // three doors. The notice lived only in the chat screen.
      for (const file of ['privacy.en.md', 'privacy.fi.md']) {
        const policy = read('docs', 'legal', file);
        assert.match(policy, /photo|valokuva/i, `${file} no longer mentions the photo path`);
      }

      // One gate, in the one function every entry point goes through: the
      // sheet is rendered from three screens, and a gate placed in it would be
      // missed by a fourth.
      assert.match(app, /function askPhotoOnlineNotice\(\): Promise<boolean> \{/);
      assert.match(
        app,
        // Only the Pro check (2026-09-29) and the coach-question check (2026-10-19) may come first: neither sends anything.
        /async function pickProgramImageForImport\(\): Promise<ProgramImageImportResult> \{\s*(?:if \(!resolveProEntitlement\(preferences\)\.unlocked\) \{\s*return \{ status: 'cancelled' \};\s*\}\s*)?(?:\/\/[^\n]*\n\s*)*if \(resolveCoachQuota\(preferences\.aiCoachProQuota\)\.remaining <= 0\) \{\s*return \{ status: 'spent' \};\s*\}\s*if \(!\(await askPhotoOnlineNotice\(\)\)\) \{/,
        'the notice must be asked before anything else in the import',
      );
      /*
       * Its own flag, one way only.
       *
       * The chat's notice discloses the workouts, the programme, the goals and
       * setup answers, the weight and measurements, height, age, gender and
       * the conversation so far. This one says "one photo, and expressly
       * nothing else about you". Sharing a flag let the narrow answer stand in
       * for the broad disclosure: accept this, never open the coach, then ask
       * it a question — and all of that left the device with no notice ever
       * shown (CI review of #146). The broad one still satisfies the narrow.
       */
      assert.match(
        app,
        /if \(preferences\.aiPhotoNoticeAcknowledged \|\| preferences\.aiOnlineNoticeAcknowledged\) \{/,
      );
      assert.match(app, /void updatePreferences\(\{ aiPhotoNoticeAcknowledged: true \}\);/);
      /*
       * Over the whole shell — App.tsx and the src/app modules the phase-B
       * split (2026-09-30) moved VinhaApp's hooks into — so the photo gate
       * cannot answer the chat's disclosure from a hook either. The chat's own
       * acknowledgement is the one legitimate writer of that flag: it must
       * appear exactly once, as a prop of the chat screen, and it is the only
       * text taken out before the absence is checked.
       */
      const chatAcknowledge =
        'onAcknowledgeOnlineNotice={() => void updatePreferences({ aiOnlineNoticeAcknowledged: true })}';
      const shell = strip(readAppWiring().replace(/\r\n/g, '\n'));
      assert.match(windowBefore(shell, chatAcknowledge, 400), /<AICoachChatScreen\b/, 'the chat no longer acknowledges its own notice');
      assert.doesNotMatch(
        shell.split(chatAcknowledge).join(''),
        /updatePreferences\(\{ aiOnlineNoticeAcknowledged: true \}\)/,
        'the photo notice answers the chat’s disclosure',
      );
      // Stored like every other consent-shaped field: only an exact `true`
      // counts, so a malformed file reads as "not yet shown".
      assert.match(
        strip(read('src', 'storage', 'database.ts')),
        /aiPhotoNoticeAcknowledged: input\?\.preferences\?\.aiPhotoNoticeAcknowledged === true,/,
      );
      for (const file of [['src', 'data', 'seed.ts'], ['src', 'state', 'AppProvider.tsx']]) {
        assert.match(read(...file), /aiPhotoNoticeAcknowledged: false,/, `${file.join('/')} does not start it at no`);
      }
      // And the notice is asked BEFORE the picker opens, not after a photo has
      // been chosen.
      // Inside the import itself, to its own closing brace: over the whole
      // file a missing picker read as -1 and the order as broken, and a
      // missing notice as -1 and the order as kept.
      const importer = functionBody(app, 'async function pickProgramImageForImport()');
      assert.ok(importer.indexOf('askPhotoOnlineNotice()') >= 0, 'the import no longer asks the notice');
      assert.ok(
        importer.indexOf('askPhotoOnlineNotice()') < importer.indexOf('await pickProgramImage()'),
        'the photo is picked only after the notice is answered',
      );

      for (const key of [
        'csv.photo.notice.title',
        'csv.photo.notice.body',
        'csv.photo.notice.continue',
        'csv.photo.notice.cancel',
      ]) {
        bothLanguages(key);
      }
      bothLanguages('toast.planWeekOutOfStep');
    },
  },
  {
    name: 'photo import: a reader who backs out is not told their photo was unreadable',
    run() {
      // The import itself, over the shell, to its own closing brace: it moves
      // to src/app in phase C (2026-10-01).
      const app = functionBody(strip(readAppWiring().replace(/\r\n/g, '\n')), 'async function pickProgramImageForImport()');
      const sheet = strip(read('src', 'components', 'NewProgramSheet.tsx'));

      // Four endings, three answers: read, the reader ended it, or it failed.
      assert.match(read('src', 'utils', 'programImagePicker.ts'), /export type ProgramImageImportResult =/);
      assert.match(app, /if \(picked\.status === 'cancelled'\) \{\s*return \{ status: 'cancelled' \};/);
      assert.match(app, /return \{ status: 'read', csv: programTableToCsv\(rows\) \};/);
      assert.match(app, /if \(!rows \|\| rows\.length === 0\) \{\s*return \{ status: 'failed' \};/);
      // The sheet speaks only for a real failure.
      assert.match(sheet, /if \(result\.status === 'read'\) \{\s*setCsvText\(result\.csv\);\s*\} else if \(result\.status === 'spent'\) \{[^}]*\} else if \(result\.status === 'failed'\) \{/);
      assert.doesNotMatch(sheet, /const csv = await onPickImage\(\)/, 'the sheet reads the old null-for-everything shape');
    },
  },
  {
    name: 'programme import: the free cap keeps the table the photo cost, rather than closing over it',
    run() {
      const sheet = strip(read('src', 'components', 'NewProgramSheet.tsx'));
      const handler = sheet.slice(sheet.indexOf('async function handleImport()'), sheet.indexOf('return (', sheet.indexOf('async function handleImport()')));
      assert.ok(handler.length > 0, 'the import handler moved');
      // `createUnlessAtLimit` shows the limit sheet and RESOLVES, so awaiting
      // it said nothing: the sheet closed and reset() threw the table away.
      assert.match(handler, /const saved = await onImportProgram\(/);
      assert.match(handler, /if \(saved === false\) \{\s*return;\s*\}/);
      assert.ok(handler.indexOf('if (saved === false)') < handler.indexOf('handleClose()'), 'closed only on a save that happened');
      assert.match(handler, /catch \{\s*setImportError\(t\(language, 'csv\.import\.failed'\)\);/);
      bothLanguages('csv.import.failed');
      // And the message renders where this handler runs. `preview` and
      // `hevyPreview` are mutually exclusive, so a message rendered only in
      // the Hevy branch was one nobody could see.
      assert.equal(
        sheet.split('{importError ? <Text style={styles.errorNote}>{importError}</Text> : null}').length - 1,
        2,
        'the import error renders in one branch only',
      );

      // And every caller answers it — found in App.tsx and every src/app
      // module rather than listed by file, since the shell's render tail (the
      // settings sheet's caller) moved into src/app (phase C). Each file is
      // read on its own, so a handler cannot run on into the next file.
      const opener = 'onImportProgram={async (draft) => {';
      const shellFiles = [
        ['App.tsx'],
        ...fs
          .readdirSync(path.join(ROOT, 'src', 'app'))
          .filter((name) => /\.tsx?$/.test(name))
          .sort()
          .map((name) => ['src', 'app', name]),
      ];
      let callers = 0;
      const perFile = new Map();
      for (const file of shellFiles) {
        const source = strip(read(...file));
        for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + opener.length)) {
          callers += 1;
          perFile.set(file.join('/'), (perFile.get(file.join('/')) ?? 0) + 1);
          const wiring = between(source.slice(at), opener, '}}');
          assert.match(wiring, /if \(!workoutTemplateId\) \{[\s\S]{0,200}return false;/, `${file.join('/')} does not report a refusal`);
          assert.match(wiring, /return true;/, `${file.join('/')} does not report a save`);
        }
      }
      // The settings sheet, the profile tab and the workout tab: one each, so
      // a lost caller cannot be made up for by a duplicated one.
      assert.equal(callers, 3, `expected three programme import callers, found ${callers}`);
      assert.equal(perFile.get('src/app/renderProfileTab.tsx'), 1, 'the profile tab no longer imports programmes');
      assert.equal(perFile.get('src/app/renderWorkoutTab.tsx'), 1, 'the workout tab no longer imports programmes');
      assert.equal(
        (perFile.get('App.tsx') ?? 0) + (perFile.get('src/app/renderAppShell.tsx') ?? 0),
        1,
        "the settings sheet's import is not in the shell",
      );
    },
  },
  {
    name: 'progress: a refused weigh-in or measurement write is said out loud',
    run() {
      const tab = strip(read('src', 'app', 'renderProgressTab.tsx'));

      // The success buzz used to fire on the line after a fire-and-forget
      // delete, before the write had resolved, with the rejection dropped.
      assert.doesNotMatch(tab, /void deleteBodyweightEntry\(/);
      assert.doesNotMatch(tab, /void deleteMeasurementEntry\(/);
      for (const call of ['deleteBodyweightEntry', 'deleteMeasurementEntry']) {
        assert.match(
          tab,
          new RegExp(`${call}\\(entryId\\)\\s*\\.then\\(\\(\\) => haptics\\.success\\(\\)\\)\\s*\\.catch\\(`),
          `${call} still buzzes before the write lands`,
        );
      }
      assert.equal(tab.split("'toast.entryDeleteFailed'").length - 1, 2);
      assert.equal(tab.split("'toast.entrySaveFailed'").length - 1, 2);
      assert.equal(tab.split('haptics.error()').length - 1, 4, 'every refused write buzzes as one');
      bothLanguages('toast.entryDeleteFailed');
      bothLanguages('toast.entrySaveFailed');

      // The tab had no way to say anything at all.
      assert.match(tab, /showToast: \(message: string\) => void;/);
      assert.match(strip(read('App.tsx')), /content = renderProgressTab\(\{[\s\S]{0,2000}showToast,/);
    },
  },
  {
    name: 'log export: a share the phone refuses is reported, not swallowed',
    run() {
      const screen = strip(read('src', 'screens', 'ExportPlanScreen.tsx'));
      const handler = screen.slice(screen.indexOf('async function shareLog()'), screen.indexOf('return (', screen.indexOf('async function shareLog()')));
      assert.ok(handler.length > 0, 'the log share moved');
      // A log past what an intent can carry used to land in the same catch as
      // a dismissed sheet, under "nothing to recover from".
      assert.doesNotMatch(handler, /\} catch \{/, 'a bare catch cannot tell a refusal from a dismissal');
      // Dismissing the sheet is still not a failure.
      assert.match(handler, /if \(result\.action === Share\.dismissedAction\) \{\s*return;\s*\}/);
      assert.match(screen, /\{logError \? <Text style=\{styles\.rowError\}>\{logError\}<\/Text> : null\}/);

      /*
       * And size is blamed only when the size can carry the blame.
       *
       * `export.log.tooBig` does not say "it failed" — it names a cause and
       * gives advice premised on it. Building the CSV is its own try, and a
       * refused share on a small log reads as the plain failure, so a reader
       * whose export broke for another reason is not told to wait for a
       * feature that would not help them (CI review of #146).
       */
      assert.match(handler, /csv = buildWorkoutLogCsv\(log\);\s*\} catch \(error\) \{/);
      assert.match(
        handler,
        /t\(language, csv\.length > LOG_SHARE_SIZE_HINT \? 'export\.log\.tooBig' : 'export\.log\.failed'\)/,
      );
      assert.match(screen, /const LOG_SHARE_SIZE_HINT = 200_000;/);
      bothLanguages('export.log.tooBig');
      bothLanguages('export.log.failed');
    },
  },
];
