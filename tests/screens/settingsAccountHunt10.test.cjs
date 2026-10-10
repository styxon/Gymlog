const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const { t } = require(path.join(root, '.test-dist', 'lib', 'i18n.js'));

/** The onResetAllData handler's body, comments removed. */
function resetHandler() {
  const source = strip(read('src/app/renderProfileTab.tsx'));
  const start = source.indexOf('onResetAllData={async () => {');
  assert.ok(start > 0, 'onResetAllData handler not found');
  return source.slice(start, source.indexOf('<ProfileScreen', start));
}

/**
 * Bug hunt 10 (2026-10-09), settings and account.
 */
module.exports = [
  {
    // The dialog promised "your cloud backup stays - sign in again to restore it" over a copy
    // that could be a day behind (offline) or still waiting out the quiet window.
    name: 'reset: a cloud copy older than the phone is backed up before the sign-out, and a backup that fails is put to the reader',
    run() {
      const handler = resetHandler();
      const behind = handler.indexOf('accountBackup.cloudCopyBehind()');
      const backup = handler.indexOf('handleAccountBackupNow()');
      const confirmAnyway = handler.indexOf("'settings.resetBehind.confirm'");
      const signOut = handler.indexOf('accountBackup.signOut()');
      const wipe = handler.indexOf('resetAllData()');
      assert.ok(behind > 0 && backup > behind, 'Reset does not look at the cloud copy before backing up');
      assert.ok(confirmAnyway > backup && confirmAnyway < signOut, 'a failed backup is not put to the reader before the sign-out');
      assert.ok(signOut > confirmAnyway && wipe > signOut, 'the sign-out must still precede the wipe');
      // Only a landed backup (or a restore) lets Reset go on unasked.
      assert.match(handler, /outcome !== 'backed_up' && outcome !== 'restored'/);
      // A cancelled prompt does not wipe.
      assert.match(handler, /if \(!goOn\) \{\s*return;\s*\}/);
    },
  },
  {
    name: 'reset: the dialog does not promise a restorable copy when the cloud copy is behind',
    run() {
      const settings = strip(read('src/screens/SettingsScreen.tsx'));
      assert.match(settings, /cloudCopyState\(\)/);
      assert.match(settings, /resetDialogMessageKey\(/);
      for (const language of ['en', 'fi']) {
        const text = t(language, 'settings.resetDialog.message.signedInBehind');
        assert.notEqual(text, t(language, 'settings.resetDialog.message.signedIn'));
        assert.ok(!/stays|säilyy/i.test(text), `${language}: still promises the copy stays`);
        assert.ok(t(language, 'settings.resetBehind.message').length > 20);
        assert.ok(t(language, 'settings.resetBehind.confirm').length > 3);
      }
    },
  },
  {
    // A storage step that threw left a closed dialog and silence (and an unhandled rejection).
    name: 'reset: a step the phone refused is said, not swallowed',
    run() {
      const handler = resetHandler();
      assert.match(handler, /catch \(error\) \{[\s\S]{0,400}toast\.resetFailed[\s\S]{0,100}return;/);
      // The try wraps the sign-out and both wipes; the follow-ups after a landed wipe are not reported as a failed reset.
      const tryAt = handler.indexOf('try {');
      assert.ok(tryAt > 0 && tryAt < handler.indexOf('accountBackup.signOut()'));
      assert.ok(handler.indexOf('catch (error)') > handler.indexOf('await resetAllData()'));
      assert.ok(handler.indexOf('catch (error)') < handler.indexOf('deletePendingAiLogs'));
      const settings = strip(read('src/screens/SettingsScreen.tsx'));
      assert.match(settings, /onResetAllData: \(\) => void \| Promise<void>/);
      assert.match(settings, /void onResetAllData\(\)/);
      for (const language of ['en', 'fi']) {
        assert.ok(t(language, 'toast.resetFailed').length > 10);
      }
    },
  },
  {
    name: 'sign out: the tap reports a sign-out that did not hold, and the provider session is ended either way',
    run() {
      const source = strip(read('src/app/renderProfileTab.tsx'));
      assert.match(source, /accountBackup\.signOut\(\)\.catch\(/);
      assert.match(source, /account\.signOutFailed/);
      const hook = strip(read('src/features/account/useAccountBackup.ts'));
      assert.match(hook, /try \{\s*await persistAccount\(null\);\s*\} finally \{\s*await signOutAccount\(\);\s*\}/);
      for (const language of ['en', 'fi']) {
        assert.ok(t(language, 'account.signOutFailed').length > 10);
      }
    },
  },
  {
    name: 'preferences: Edit profile, My data, language/toggles and Replay tour wait for the write and report a refused one',
    run() {
      const profileTab = strip(read('src/app/renderProfileTab.tsx'));
      assert.match(profileTab, /onSave=\{\(name\) => savePreferences\(\{ profileName: name \}\)\}/);
      assert.match(profileTab, /onSaveBasics=\{\(patch\) => savePreferences\(patch\)\}/);
      assert.match(profileTab, /await savePreferences\(patch\)/);
      assert.match(profileTab, /if \(await savePreferences\(\{ firstRunToursSeen: \[\] \}\)\) \{\s*deps\.resetToRoute\(ROOT_ROUTES\.home\);/);
      assert.match(profileTab, /catch \(error\) \{[\s\S]{0,400}toast\.prefsSaveFailed[\s\S]{0,100}return false;/);
      assert.ok(!/void updatePreferences\(\{ profileName/.test(profileTab));
      assert.ok(!/void deps\.updatePreferences\(\{ firstRunToursSeen/.test(profileTab));

      const edit = strip(read('src/screens/EditProfileScreen.tsx'));
      assert.match(edit, /const saved = await onSave\(/);
      assert.match(edit, /if \(saved\) \{\s*onBack\(\);/);
      assert.ok(edit.indexOf('await onSave(') < edit.indexOf('onBack();'), 'the editor closes before the write resolved');

      const myData = strip(read('src/screens/MyDataScreen.tsx'));
      assert.match(myData, /if \(await onSaveBasics\(patch\)\) \{\s*setEditing\(null\);/);
      for (const language of ['en', 'fi']) {
        assert.ok(t(language, 'toast.prefsSaveFailed').length > 10);
      }
    },
  },
  {
    name: 'export plan: the holder templates of free workouts are not offered as plans',
    run() {
      const source = strip(read('src/app/usePlanReadouts.tsx'));
      assert.match(source, /workoutTemplates\s*\.filter\(\(template\) => template\.origin !== 'freestyle'\)\s*\.map\(/);
    },
  },
];
