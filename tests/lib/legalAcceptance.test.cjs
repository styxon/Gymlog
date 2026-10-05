const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  acceptLegal,
  legalAcceptanceDue,
  normalizeLegalAcceptance,
} = require('../../.test-dist/lib/legalAcceptance.js');
const { LEGAL_LAST_UPDATED, LEGAL_VERSION, formatLegalDate } = require('../../.test-dist/lib/legalDocuments.js');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

// Line endings normalised: a Windows checkout is CRLF.
const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');

/** Comments go first: a guard must not be satisfied by its own explanation. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '{}');
}

function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

/**
 * The terms and privacy policy, accepted with a tick box and stored with the
 * version accepted (#bugs 2026-09-22; decided 2026-09-26). The sheet over the
 * app cannot be closed, is asked once per version, and asks again when the
 * documents change — which keeps the documents' own promise to show a change
 * in the app before it takes effect.
 */
module.exports = [
  {
    name: 'legal acceptance: owed until this version is accepted, and again after a change',
    run() {
      assert.equal(legalAcceptanceDue(null, '2026-09-16'), 'first');
      assert.equal(legalAcceptanceDue(undefined, '2026-09-16'), 'first');
      assert.equal(legalAcceptanceDue({ version: '2026-09-16', acceptedAt: 'x' }, '2026-09-16'), null);
      assert.equal(legalAcceptanceDue({ version: '2026-09-04', acceptedAt: 'x' }, '2026-09-16'), 'changed');
      // A backup from a newer build is not a reason to ask.
      assert.equal(legalAcceptanceDue({ version: '2026-10-01', acceptedAt: 'x' }, '2026-09-16'), null);

      const accepted = acceptLegal(LEGAL_VERSION, new Date('2026-09-26T10:00:00Z'));
      assert.deepEqual(accepted, { version: LEGAL_VERSION, acceptedAt: '2026-09-26T10:00:00.000Z' });
      assert.equal(legalAcceptanceDue(accepted, LEGAL_VERSION), null);
    },
  },
  {
    /**
     * A restore keeps the acceptance that covers more. A backup from before
     * the question existed has none, and taking the backup's answer asked a
     * reader again right after they had ticked the box and signed in.
     */
    name: 'legal acceptance: a restore keeps the later acceptance, from either side',
    run() {
      const { laterLegalAcceptance } = require('../../.test-dist/lib/legalAcceptance.js');
      const old = { version: '2026-09-04', acceptedAt: '2026-09-05T08:00:00.000Z' };
      const now = { version: '2026-09-16', acceptedAt: '2026-09-26T08:00:00.000Z' };
      const sameEarlier = { version: '2026-09-16', acceptedAt: '2026-09-20T08:00:00.000Z' };
      assert.deepEqual(laterLegalAcceptance(now, null), now);
      assert.deepEqual(laterLegalAcceptance(null, now), now);
      assert.equal(laterLegalAcceptance(null, undefined), null);
      assert.deepEqual(laterLegalAcceptance(old, now), now);
      assert.deepEqual(laterLegalAcceptance(now, old), now);
      assert.deepEqual(laterLegalAcceptance(now, sameEarlier), sameEarlier, 'the first tap for a version stands');

      const { preferencesForRestore } = require('../../.test-dist/lib/accountBackup.js');
      const { createEmptyDatabase } = require('../../.test-dist/data/seed.js');
      const base = createEmptyDatabase('fi').preferences;
      const restored = preferencesForRestore({ ...base, legalAcceptance: null }, { ...base, legalAcceptance: now }, []);
      assert.deepEqual(restored.legalAcceptance, now, 'the restore threw away the tick this phone just got');
    },
  },
  {
    // Malformed must read as NOT accepted: the safe direction to be wrong in.
    name: 'legal acceptance: a stored value is trusted only whole',
    run() {
      const good = { version: '2026-09-16', acceptedAt: '2026-09-26T10:00:00.000Z' };
      assert.deepEqual(normalizeLegalAcceptance(good), good);
      for (const bad of [
        null,
        undefined,
        true,
        'yes',
        {},
        { version: '2026-09-16' },
        { acceptedAt: good.acceptedAt },
        { version: '16.9.2026', acceptedAt: good.acceptedAt },
        { version: '2026-09-16', acceptedAt: 'not a date' },
        { version: 20260916, acceptedAt: good.acceptedAt },
      ]) {
        assert.equal(normalizeLegalAcceptance(bad), null, JSON.stringify(bad));
      }
      // And the loader actually runs it: a field that skips normalisation is
      // a crash — or here, a forged "yes" — on someone's old install.
      const database = read('src', 'storage', 'database.ts');
      assert.match(database, /legalAcceptance: normalizeLegalAcceptance\(input\?\.preferences\?\.legalAcceptance\),/);
      assert.match(read('src', 'data', 'seed.ts'), /legalAcceptance: null/);
      assert.match(read('src', 'state', 'AppProvider.tsx'), /legalAcceptance: null,/);
    },
  },
  {
    name: 'legal acceptance: the sheet cannot be closed, and leaves only when the answer is stored',
    run() {
      const sheet = stripComments(read('src', 'components', 'LegalConsentSheet.tsx'));
      // No way out but the answer: no close prop, no dismiss, and the scrim
      // is a plain View, not a button.
      assert.doesNotMatch(sheet, /onClose|onDismiss|onRequestClose|<Modal/);
      assert.match(sheet, /<View style=\{styles\.scrim\} \/>/);
      assert.doesNotMatch(sheet, /styles\.scrim\}[^>]*onPress/);
      // Back leaves the app, it does not close the sheet.
      assert.match(sheet, /BackHandler\.exitApp\(\);\s*return true;/);
      // Continue waits for the box and for the write.
      assert.match(sheet, /const canContinue = checked && !saving;/);
      assert.match(sheet, /disabled=\{!canContinue\}/);
      // The sheet has no visibility of its own to flip on the tap.
      assert.doesNotMatch(sheet, /setVisible|visible/);

      const app = read('App.tsx');
      // The terms' state, the tour's gate and the route-level back left App.tsx
      // for src/app hooks in the phase-C split (2026-10-01); the shell's JSX
      // that mounts the sheet is still App.tsx's own.
      const shell = readAppWiring().split('\r\n').join('\n');
      const owed = between(shell, 'const legalConsentOwed =', ';\n');
      assert.match(owed, /appHydrated && brandSplashDone && !onboardingActive && !setupHandoffActive/);
      assert.match(owed, /legalAcceptanceDue\(preferences\.legalAcceptance, LEGAL_VERSION\)/);
      // Held on screen while the answer is written: updatePreferences shows
      // the change before the disk has it (CI review of #184).
      assert.match(shell, /const legalConsentDue = legalConsentOwed \?\? legalSheetHeld;/);
      // The shell's overlay prop moved with the render tail into src/app (phase C).
      assert.match(shell, /legalConsentDue \? renderLegalConsent\(shellSafeAreaEdges\.includes\('bottom'\)\) : tourElement/);
      const overlay = between(shell, 'const renderLegalConsent = (shellPadsBottom: boolean) => (', '\n  );\n');
      // The inset once, not twice: the shell usually pads the bottom already.
      assert.match(overlay, /shellPadsBottom=\{shellPadsBottom\}/);
      assert.match(
        stripComments(read('src', 'components', 'LegalConsentSheet.tsx')),
        /paddingBottom: \(shellPadsBottom \? 0 : Math\.max\(insets\.bottom, GESTURE_BAR_FLOOR\)\) \+ spacing\.lg/,
      );
      assert.match(overlay, /<LegalConsentSheet/);
      assert.match(
        overlay,
        /onAccept=\{async \(\) => \{\s*setLegalSheetHeld\(legalConsentDue\);\s*try \{\s*await updatePreferences\(\{ legalAcceptance: acceptLegal\(LEGAL_VERSION, new Date\(\)\) \}\);\s*\} finally \{[\s\S]*?setLegalSheetHeld\(null\);/,
      );
      // The documents open over it, not instead of it.
      assert.ok(overlay.indexOf('<LegalDocumentScreen') > overlay.indexOf('<LegalConsentSheet'));
      // The tour waits: it would point at a screen the sheet covers.
      assert.match(between(shell, 'const tourActive =', ';\n'), /legalConsentDue === null/);
      // And the route-level back does not walk the screen behind the sheet.
      assert.match(shell, /if \(legalConsentDueRef\.current\) \{\s*return false;\s*\}/);
    },
  },
  {
    name: 'legal acceptance: the hand-off asks with the same box, and its buttons wait for it',
    run() {
      const handoff = stripComments(read('src', 'screens', 'SetupHandoffScreen.tsx'));
      assert.equal(handoff.split('<LegalConsentCheck').length - 1, 2, 'both pages that name the documents carry the box');
      // Sign-in and Done both wait. "Not now" on sign-in does not: the next
      // page, or the sheet over the app, asks.
      // Three: Apple's sign-in button (iPhone), Google's, and Done.
      assert.equal(handoff.split('disabled={!legalReady}').length - 1, 3);
      // Ready means ticked now, or accepted already — a reader running the
      // questions again from Profile is not asked twice for one version.
      assert.match(handoff, /const legalReady = legalAlreadyAccepted \|\| legalChecked;/);
      // The hand-off is mounted from src/app since the phase-C split.
      const wiring = readAppWiring().split('\r\n').join('\n');
      assert.match(
        wiring,
        /legalAlreadyAccepted=\{\s*legalAcceptanceDue\(preferences\.legalAcceptance, LEGAL_VERSION\) === null\s*\}/,
      );
      assert.match(handoff, /legalAccepted: legalChecked,/);
      assert.doesNotMatch(handoff, /handoff\.legal/);

      const app = read('App.tsx');
      // The handler left App.tsx for src/app in the phase-C split (2026-10-01).
      const shell = readAppWiring().split('\r\n').join('\n');
      const done = between(shell, 'const handleSetupHandoffDone = async', 'await updatePreferences(patch);');
      assert.match(done, /if \(choices\.legalAccepted\) \{\s*patch\.legalAcceptance = acceptLegal\(LEGAL_VERSION, new Date\(\)\);/);
      // Skipping the hand-off is not accepting.
      // The hand-off's own onSkip, read from where the screen is mounted.
      const handoffAt = wiring.indexOf('<SetupHandoffScreen');
      assert.ok(handoffAt >= 0, 'the hand-off is no longer mounted');
      assert.match(between(wiring.slice(handoffAt), 'onSkip={() =>', '})'), /legalAccepted: false,/);
    },
  },
  {
    name: 'legal acceptance: the sentence and the change notice exist in both languages',
    run() {
      const i18n = read('src', 'lib', 'i18n.ts');
      for (const key of [
        'legal.consent.title',
        'legal.consent.bodyFirst',
        'legal.consent.bodyChanged',
        'legal.consent.check',
        'legal.consent.saveFailed',
      ]) {
        assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} needs EN and FI`);
      }
      assert.equal(i18n.split("'handoff.legal':").length - 1, 0, 'the "by continuing you accept" line is back');
      // The change notice names the documents' own date.
      assert.equal(formatLegalDate('fi'), LEGAL_LAST_UPDATED.split('-').map(Number).reverse().join('.'));
    },
  },
];
