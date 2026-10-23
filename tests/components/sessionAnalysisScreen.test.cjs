const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
// Line endings normalised: a Windows checkout writes CRLF, and the anchors below end on "\n}\n".
const source = fs
  .readFileSync(path.join(root, 'src', 'screens', 'SessionAnalysisScreen.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

/** The text between two anchors; throws when either is missing, so a renamed anchor cannot empty the slice. */
function between(text, from, to) {
  const start = text.indexOf(from);
  assert.notEqual(start, -1, `anchor missing: ${from}`);
  const end = text.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `anchor missing: ${to}`);
  return text.slice(start, end + to.length);
}

module.exports = [
  {
    name: 'the full-analysis screen follows the theme instead of a fixed dark palette',
    run() {
      // User 2026-09-13: under the light theme the page stayed dark while the
      // tab bar floating over it was light — reached from a coach chat that had
      // already gone light. The screen now builds its styles per theme.
      assert.match(source, /useThemedStyles\(makeStyles\)/);
      assert.match(source, /const makeStyles = \(theme: Theme\) => StyleSheet\.create\(\{/);
      assert.doesNotMatch(source, /from '\.\.\/lightTheme'/, 'no fixed light-theme palette import');
      assert.doesNotMatch(source, /from '\.\.\/darkTheme'/, 'no fixed dark palette import');

      // No colour of its own. The one place a colour string is built is the
      // tint helper, which only re-expresses a palette colour with alpha.
      const helper = between(source, 'function tint(', '\n}\n');
      const rest = source.replace(helper, '');
      assert.doesNotMatch(rest, /#[0-9A-Fa-f]{3,8}\b/, 'no hex colour literals');
      assert.doesNotMatch(rest, /rgba?\(/, 'no rgb/rgba literals');
    },
  },
  {
    name: 'the full-analysis screen keeps its gold readable and its button on the action colour',
    run() {
      // Gold small type on the pale light page is unreadable, so light reads the
      // palette's deep gold ink; dark keeps the gold it always had.
      const goldText = between(source, 'function goldText(', '\n}\n');
      assert.match(goldText, /theme === darkTheme \? theme\.gold : theme\.amberInk/);

      // Labels and highlights go through it rather than raw gold…
      assert.match(between(source, '  eyebrow: {', '},'), /color: goldText\(theme\)/);
      // The section labels are the app's shared SectionLabel (unified list style).
      assert.match(source, /<SectionLabel style=\{styles\.label\} label=\{t\(language, 'analysis\.breakdown'\)\} \/>/);
      // …while the current bar is a fill, where gold reads on either ground.
      assert.match(between(source, '  barCurrent: {', '},'), /backgroundColor: theme\.gold/);

      // "Ask the coach" is pressable: the theme's action colour, and the ink
      // made for text on it.
      assert.match(between(source, '  askButton: {', '},'), /backgroundColor: theme\.highlight/);
      assert.match(between(source, '  askButtonText: {', '},'), /color: theme\.onHighlight/);
    },
  },
  {
    name: 'the full-analysis trend words read their inks in light, where the raw accents are ~2.7:1',
    run() {
      // PR #94 review: green and amber as 10-12px type on the light page fail
      // AA. Light reads greenInk / amberInk, and flat goes quiet so it does not
      // share the amber ink with "down"; dark keeps the accents it had.
      const toneInk = between(source, 'function toneInk(', '\n}\n');
      assert.match(toneInk, /theme === darkTheme\)\s*\{\s*return toneColor\(theme, trend\);/);
      assert.match(toneInk, /trend === 'up' \? theme\.greenInk : trend === 'down' \? theme\.amberInk : theme\.muted/);

      // Every trend word goes through it: the row's mark and label, and the
      // volume change badge. Only the observation squares — fills — keep the raw tone.
      assert.equal((source.match(/styles\.trend(Mark|Text), \{ color: toneInk\(theme, row\.trend\) \}/g) ?? []).length, 2);
      assert.match(between(source, '  changePillText: {', '},'), /color: toneInk\(theme, 'up'\)/);
      assert.match(between(source, '  changePillTextDown: {', '},'), /color: toneInk\(theme, 'down'\)/);
      assert.match(source, /styles\.observationSquare, \{ backgroundColor: toneColor\(theme, entry\.trend\) \}/);
      assert.doesNotMatch(source, /color: toneColor\(/, 'no trend text on the raw accent');
    },
  },
];
