const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8').replace(/\r\n/g, '\n');

/**
 * The free workout's "Lisää liike" is the app's one add sheet.
 *
 * "Tyhjän treenin lisää liike korvataan tämä samanlaiseksi kun muutkin lisää
 * liike lehdet ... väärä bottombar kaikki jaot filtteri vääriä" (#bugs
 * 2026-10-10). The Empty Workout screen drew a sheet of its own: its own
 * body-part chips, initials tiles instead of the library's pictures, and a
 * pale full-width "Valitse vähintään yksi liike" button that stood there
 * with nothing picked. The programme builder and the programme day open
 * `AddExerciseSheet` (multi-select: the one body-part row, the card grid,
 * and the kit's commit bar that appears only once something is picked).
 * The free workout now opens the same one; this keeps it from growing its
 * own copy back.
 */
module.exports = [
  {
    name: 'empty workout add sheet: it opens the shared AddExerciseSheet, multi-select, adding on confirm',
    run() {
      const screen = read('src/screens/EmptyWorkoutScreen.tsx');
      assert.match(screen, /import \{ AddExerciseSheet \} from '\.\.\/components\/AddExerciseSheet';/);
      const call = screen.match(/<AddExerciseSheet\b[\s\S]*?\/>/);
      assert.ok(call, 'the free workout does not draw the shared add sheet');
      const props = call[0];
      // The same mode as the other "add several" callers: the single body-part
      // row and the commit bar both hang off multiSelect in the sheet.
      assert.match(props, /\n\s+multiSelect\n/);
      assert.match(props, /onConfirmSelection=\{addExercises\}/);
      assert.match(props, /visible=\{sheetVisible\}/);
      assert.match(props, /items=\{exerciseLibrary\}/);
      // Read outside the modal, where the inset is right (see addExerciseSheet.test).
      assert.match(props, /bottomInset=\{sheetInsets\.bottom\}/);
    },
  },
  {
    name: 'empty workout add sheet: no bespoke sheet, chips or bottom bar of its own',
    run() {
      const screen = read('src/screens/EmptyWorkoutScreen.tsx');
      // No sheet component of its own, under any name.
      assert.doesNotMatch(screen, /function \w*(?:Add\w*Sheet|Sheet\w*Add)\w*\(/, 'the screen defines its own add sheet');
      // The screen's other sheets are shared components; it opens no Modal itself.
      assert.doesNotMatch(screen, /<Modal\b/, 'the screen draws its own modal sheet');
      // Its own chip row and the always-there confirm bar.
      assert.doesNotMatch(screen, /BODY_PART_FILTERS/, 'the screen keeps its own body-part chips');
      assert.doesNotMatch(screen, /styles\.sheet(?:Chip|Confirm|Footer)\b/, 'the screen keeps its own chips or bottom bar');
      assert.doesNotMatch(screen, /emptyWorkout\.sheet\./, 'the screen keeps its own sheet copy');
    },
  },
  {
    name: 'empty workout add sheet: the shared sheet\'s multi-select footer is the kit commit bar',
    run() {
      // What "the same bottom bar" means: the kit bar, shown only once
      // something is picked, never a disabled placeholder button.
      const sheet = read('src/components/AddExerciseSheet.tsx');
      assert.match(sheet, /quickBodyPartOnly=\{multiSelect\}/);
      assert.match(sheet, /<KitBar\b[\s\S]{0,120}visible=\{pendingSelectedIds\.length > 0\}/);
    },
  },
];
