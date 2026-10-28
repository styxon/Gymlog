const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { describeProgramCap, programCapLineKey } = require('../../src/lib/programCapNotice');
const {
  FREE_ACTIVE_PROGRAM_CAP,
  PRO_ACTIVE_PROGRAM_CAP,
} = require('../../src/lib/activeProgramSet');

module.exports = [
  {
    name: 'cap line: silence until a place is actually at stake',
    run() {
      // The cap was enforced and never mentioned until the try that failed, so
      // the reader met it as a refusal (user 2026-08-26). The answer is not to
      // report the count everywhere: a number nobody is near is a sign about
      // nothing, and those teach people to stop reading signs.
      const fresh = describeProgramCap({ activePlanIds: [], proUnlocked: false });
      assert.equal(fresh.used, 0);
      assert.equal(fresh.cap, FREE_ACTIVE_PROGRAM_CAP);
      assert.equal(programCapLineKey(fresh), null, 'nothing to say with every place free');

      const oneLeft = describeProgramCap({ activePlanIds: ['a'], proUnlocked: false });
      assert.equal(oneLeft.lastPlace, true);
      assert.equal(programCapLineKey(oneLeft), 'lastPlace');

      const full = describeProgramCap({ activePlanIds: ['a', 'b'], proUnlocked: false });
      assert.equal(full.atCap, true);
      assert.equal(programCapLineKey(full), 'atCap');
    },
  },
  {
    name: 'cap line: Pro has more places, and stays quiet until it does not',
    run() {
      const roomy = describeProgramCap({ activePlanIds: ['a', 'b'], proUnlocked: true });
      assert.equal(roomy.cap, PRO_ACTIVE_PROGRAM_CAP);
      assert.equal(programCapLineKey(roomy), null);

      const full = describeProgramCap({ activePlanIds: ['a', 'b', 'c', 'd', 'e'], proUnlocked: true });
      assert.equal(programCapLineKey(full), 'atCap');
    },
  },
  {
    name: 'cap line: a repeated id from an older build does not report a full set',
    run() {
      // The set is de-duplicated wherever it is written, but a stored list can
      // still hold a repeat — counting one twice would tell a reader with one
      // programme that they are at the limit.
      const state = describeProgramCap({ activePlanIds: ['a', 'a'], proUnlocked: false });
      assert.equal(state.used, 1);
      assert.equal(state.atCap, false);
    },
  },
  {
    name: 'cap line: nobody at the cap is sold what they already own',
    run() {
      const fi = fs.readFileSync(path.join(__dirname, '../../src/lib/i18n.ts'), 'utf8');
      const lines = fi.match(/'programs\.cap\.(?:atCap|lastPlace)': '[^']*'/g) ?? [];
      assert.equal(lines.length, 4, 'both wordings, both languages');
      for (const line of lines) {
        assert.doesNotMatch(
          line,
          /\bPro\b|\bosta\b|\bupgrade\b|\bpäivitä\b/i,
          `selling to someone at the cap: ${line}`,
        );
      }
    },
  },
  {
    name: 'cap line: it lives on the list, and adopting says nothing at all',
    run() {
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      const home = fs.readFileSync(path.join(__dirname, '../../src/screens/HomeScreen.tsx'), 'utf8');

      // This was a toast on every adoption for about an hour. A popup that says
      // what the screen behind it already shows is the thing the reader keeps
      // asking to be rid of ("otit ohjelman käyttöön", #bugs 2026-08-26).
      assert.doesNotMatch(app, /programCapToast|'season\.joined'/);
      assert.doesNotMatch(app, /toast\.programNowYours|toast\.swapKept/);
      assert.match(app, /programCapLine=\{programCapLine\}/);
      assert.match(home, /programCapLine \? <Text style=\{styles\.otherProgramsCap\}/);
    },
  },
  {
    name: 'programme drop: the row waits, and says where the programme went',
    run() {
      const home = fs.readFileSync(path.join(__dirname, '../../src/screens/HomeScreen.tsx'), 'utf8');
      // Nothing is destroyed by dropping one, but the row vanished under the
      // reader's thumb and that reads as destruction unless you already know
      // otherwise (user 2026-08-26).
      assert.match(home, /setPendingRemoval\(planId\)/);
      assert.match(home, /onRemoveOtherProgram\?\.\(planId\);/);
      assert.match(home, /home\.removeProgram\.undo/);

      // And no countdown. It waited five seconds and then committed, which
      // means the reader races the app to keep their own programme — "hurry
      // up" is the wrong thing to say about a decision (user 2026-08-26,
      // "otetaan aika pois"). The row waits as long as it takes: Kumoa on the
      // row, and a red X confirms.
      assert.doesNotMatch(home, /REMOVAL_UNDO_MS|setTimeout\(\(\) => \{\s*\n\s*removalTimer/);
      assert.match(home, /const confirmRemoval = \(planId: string\) => \{/);
      assert.match(home, /home\.removeProgram\.confirm/);

      // And it says where it went, because "gone" was the fear.
      const fi = fs.readFileSync(path.join(__dirname, '../../src/lib/i18n.ts'), 'utf8');
      assert.match(fi, /'home\.removeProgram\.pending': 'Poistetaanko\? Säilyy Ohjelmat-välilehdellä'/);
    },
  },
];
