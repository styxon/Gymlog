const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const screen = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramsHomeScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

const block = (name) => {
  const match = new RegExp(`\\n  ${name}: \\{([^}]*)\\}`).exec(screen);
  assert.ok(match, `${name} not found`);
  return match[1];
};

/**
 * Owner's #4, iOS hunt 2026-10-17: on iPhone the "For you" card cut its name
 * to "CALISTHENICS STRE…" and the "General fitness" tile broke onto two
 * lines; iOS's heavy capitals run wider than Android's.
 */
module.exports = [
  {
    name: 'programs: the recommendation card gives its name two lines, held at two',
    run() {
      assert.match(screen, /<Text style=\{styles\.recName\} numberOfLines=\{2\}>/);
      const name = block('recName');
      assert.match(name, /lineHeight: 16,/);
      assert.match(name, /minHeight: 32,/);
      assert.doesNotMatch(name, /letterSpacing/);
    },
  },
  {
    name: 'programs: the category tiles are wide enough for "General fitness", and their labels keep two lines',
    run() {
      const width = Number(/width: (\d+),/.exec(block('catTileWrap'))?.[1]);
      assert.ok(width >= 86, `catTileWrap ${width}`);
      assert.match(block('catTileLabel'), /minHeight: 28,/);
      assert.match(screen, /<Text style=\{styles\.catTileLabel\} numberOfLines=\{2\}>/);
    },
  },
];
