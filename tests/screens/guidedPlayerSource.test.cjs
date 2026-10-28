const fs = require('node:fs');
const path = require('node:path');
const {
  MANIFEST,
  MAIN,
  SCREENS,
  ANCHORS_IN_ORIGINAL_ORDER,
  readGuidedPlayerSource,
} = require('../helpers/guidedPlayerSource.cjs');

const TESTS = path.join(__dirname, '..');

function testFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (/\.(cjs|js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

module.exports = [
  {
    // A new GuidedPlayer*.tsx that is not in the manifest would be invisible to
    // every guard that reads the player through the helper.
    name: 'guided player source: every GuidedPlayer module in src/screens is in the manifest',
    run() {
      const assert = require('node:assert/strict');
      const listed = new Set(MANIFEST.map((entry) => entry.file));
      const onDisk = fs.readdirSync(SCREENS).filter((name) => /^GuidedPlayer.*\.tsx?$/.test(name));
      for (const name of onDisk) {
        assert.ok(listed.has(name), `${name} is not in tests/helpers/guidedPlayerSource.cjs MANIFEST`);
      }
      for (const entry of MANIFEST) {
        if (!entry.optional) assert.ok(onDisk.includes(entry.file), `${entry.file} is missing`);
      }
      assert.ok(listed.has(MAIN));
    },
  },
  {
    // The slices that run from one declaration to the next depend on the order.
    name: 'guided player source: the concatenation keeps the original declaration order',
    run() {
      const assert = require('node:assert/strict');
      const source = readGuidedPlayerSource();
      let last = -1;
      for (const anchor of ANCHORS_IN_ORIGINAL_ORDER) {
        const at = source.indexOf(anchor);
        assert.ok(at >= 0, `anchor missing: ${anchor}`);
        assert.ok(at > last, `${anchor} is out of its original order`);
        last = at;
      }
    },
  },
  {
    // A guard that reads only the main file passes a negative assertion
    // vacuously once code moves out of it, so none may bypass the helper.
    name: 'guided player source: no guard reads GuidedPlayerScreen.tsx except through the helper',
    run() {
      const assert = require('node:assert/strict');
      const own = path.join(TESTS, 'helpers', 'guidedPlayerSource.cjs');
      const offenders = [];
      for (const file of testFiles(TESTS)) {
        if (file === own || file === __filename) continue;
        const text = fs.readFileSync(file, 'utf8');
        const direct = /readFileSync\([^)]*GuidedPlayerScreen\.tsx|\bread\(\s*'src[^)]*GuidedPlayerScreen\.tsx/.test(text);
        if (text.includes('GuidedPlayerScreen.tsx') && (direct || !text.includes('guidedPlayerSource.cjs'))) {
          offenders.push(path.relative(TESTS, file));
        }
      }
      assert.deepEqual(offenders, [], `read the player through readGuidedPlayerSource(): ${offenders.join(', ')}`);
    },
  },
];
