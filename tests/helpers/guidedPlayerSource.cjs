const fs = require('node:fs');
const path = require('node:path');

/**
 * The guided player's source as the guards read it.
 *
 * src/screens/GuidedPlayerScreen.tsx is being split into sibling modules
 * (GuidedPlayerStyles.tsx, GuidedPlayerSheet.tsx, ...). Many guards pin wiring
 * by regex over the player's text, and a guard that read only the main file
 * would go quiet the moment the code it looks for moved out. So every guard
 * reads the player through readGuidedPlayerSource(): the modules joined in
 * their ORIGINAL order, with the main file in the slot it always stood in.
 *
 * The order matters. A few guards slice a window out of the text ("from
 * function GPSheet to the first /* == banner"), and with the original order
 * those windows are unchanged or a superset of what they were. A negative
 * assertion (doesNotMatch) over only the main file would pass vacuously, which
 * is why nothing reads the main file directly (see the guard suite in
 * tests/screens/guidedPlayerSource.test.cjs).
 *
 * `optional` entries are modules whose split step has not landed yet.
 */
const SCREENS = path.join(__dirname, '..', '..', 'src', 'screens');
const MAIN = 'GuidedPlayerScreen.tsx';

const MANIFEST = [
  { file: 'GuidedPlayerTypes.ts', optional: true },
  { file: 'GuidedPlayerMotion.tsx', optional: true },
  { file: 'GuidedPlayerParts.tsx', optional: true },
  { file: 'GuidedPlayerDial.tsx', optional: true },
  { file: 'GuidedPlayerSheet.tsx', optional: true },
  { file: MAIN, optional: false },
  { file: 'GuidedPlayerEditor.tsx', optional: true },
  { file: 'GuidedPlayerSetStep.tsx', optional: true },
  { file: 'GuidedPlayerViews.tsx', optional: true },
  { file: 'GuidedPlayerStyles.tsx', optional: true },
];

/**
 * Declarations in the order the original single file held them. The
 * concatenation must keep this order, or a slice from one anchor to the next
 * would run backwards.
 */
const ANCHORS_IN_ORIGINAL_ORDER = [
  'function GPIcon',
  'function GPSheet',
  'export function GuidedPlayerScreen(',
  'function GuidedPlayer(',
  'function SetStepView(',
  'function FinishView',
  'const makeStyles',
];

function readNormalised(file) {
  return fs.readFileSync(path.join(SCREENS, file), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Transitional, removed when GuidedPlayerViews.tsx lands: until then
 * FinishView and the sheets after it still live at the end of the main file,
 * but the original order put them AFTER SetStepView (and the editor). So the
 * modules that stood between the player and FinishView are spliced in at the
 * start of FinishView, which keeps "SetStepView to FinishView" a forward slice.
 */
const AFTER_SPLICE_FILES = ['GuidedPlayerEditor.tsx', 'GuidedPlayerSetStep.tsx'];
const TAIL_ANCHOR = '\nfunction FinishView(';

function readGuidedPlayerSource() {
  const viewsLanded = fs.existsSync(path.join(SCREENS, 'GuidedPlayerViews.tsx'));
  const parts = [];
  for (const { file, optional } of MANIFEST) {
    if (optional && !fs.existsSync(path.join(SCREENS, file))) continue;
    if (!viewsLanded && AFTER_SPLICE_FILES.includes(file)) continue;
    const text = readNormalised(file);
    if (!viewsLanded && file === MAIN) {
      const cut = text.indexOf(TAIL_ANCHOR);
      if (cut < 0) throw new Error('FinishView anchor missing in the main file');
      const spliced = AFTER_SPLICE_FILES.filter((name) => fs.existsSync(path.join(SCREENS, name))).map(readNormalised);
      parts.push([text.slice(0, cut), ...spliced, text.slice(cut + 1)].join('\n'));
      continue;
    }
    parts.push(text);
  }
  return parts.join('\n');
}

/**
 * One module of the player on its own, for a guard whose window is exactly that
 * module (the logged-set editor ran from its declaration to SetStepView, which
 * is the end of GuidedPlayerEditor.tsx).
 */
function readGuidedPlayerModule(file) {
  return readNormalised(file);
}

/**
 * A source file by repo-relative path, with the player's own path answering
 * with the whole player. For the guards that loop over a list of files.
 */
function readSourceFile(relative) {
  const normalised = relative.replace(/\\/g, '/');
  if (normalised === `src/screens/${MAIN}`) return readGuidedPlayerSource();
  return fs.readFileSync(path.join(__dirname, '..', '..', normalised), 'utf8');
}

module.exports = {
  MANIFEST,
  MAIN,
  SCREENS,
  ANCHORS_IN_ORIGINAL_ORDER,
  readGuidedPlayerModule,
  readGuidedPlayerSource,
  readSourceFile,
};
