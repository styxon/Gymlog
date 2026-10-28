const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { HG } = require('../../src/lightTheme');
const { HG_DARK } = require('../../src/darkTheme');
const { contrastRatio, compositeOver } = require('../helpers/contrast.cjs');

const read = () =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'AddExerciseSheet.tsx'), 'utf8');

const tokenOf = (source, style, prop) => {
  const block = source.match(new RegExp(`\\n  ${style}: \\{([^}]*)\\}`));
  assert.ok(block, `${style} not found`);
  const value = block[1].match(new RegExp(`${prop}: theme\\.(\\w+)`));
  assert.ok(value, `${style}.${prop} is not a theme token`);
  return value[1];
};

module.exports = [
  {
    name: 'exercise picker: the pick ring and the handle are theme colours that show in light (hunt 1.1.1 r2)',
    run() {
      const sheet = read();
      // #445 painted both in dark-only white: the unpicked ring was 1.03:1 on
      // the light row, so a pick-then-bar row showed nothing to tap.
      const styles = sheet.slice(sheet.indexOf('StyleSheet.create'));
      assert.doesNotMatch(styles, /rgba\(255, ?255, ?255/, 'no white written for one theme only');
      const ring = tokenOf(styles, 'rowTick', 'borderColor');
      const row = tokenOf(styles, 'row', 'backgroundColor');
      for (const [name, palette] of [['light', HG], ['dark', HG_DARK]]) {
        const ground = palette[row];
        const ratio = contrastRatio(compositeOver(palette[ring], ground), ground);
        // WCAG 1.4.11: a control's boundary at 3:1.
        assert.ok(ratio >= 3, `${name} pick ring ${ring} on ${row}: ${ratio.toFixed(2)}:1`);
      }
    },
  },
  {
    name: 'exercise picker: opening another filter group starts its options at the first one (hunt 1.1.1 r2)',
    run() {
      // Body part scrolled far right, then Equipment opened at that offset
      // with "All" out of view.
      assert.match(read(), /\{open \? \(\s*<ScrollView\s*(?:\/\/[^\n]*\n\s*)?key=\{open\}/);
    },
  },
];
