const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// AppText.tsx wraps react-native's own Text/TextInput.
const ALLOWED = new Set(['src/components/AppText.tsx']);

module.exports = [
  {
    // Owner decision 2026-10-20: system text scale stops at 1.5x app-wide.
    name: 'text scale cap: 1.5, defined once, applied by AppText with call-site values winning',
    run() {
      assert.match(read('src', 'textScale.ts'), /export const TEXT_SCALE_CAP = 1\.5;/);
      const source = read('src', 'components', 'AppText.tsx');
      assert.match(source, /props\.maxFontSizeMultiplier \|\| TEXT_SCALE_CAP/);
      assert.equal(source.match(/\|\| TEXT_SCALE_CAP/g).length, 1, 'TextInput defaults to the cap');
      assert.match(source, /resolveFontSizeMultiplier\(props\.maxFontSizeMultiplier, nested\)/, 'Text defaults to the cap through the nested-aware helper');
      assert.match(read('src', 'components', 'AnimatedText.tsx'), /Animated\.createAnimatedComponent\(Text\)/);
    },
  },
  {
    // A nested span's own multiplier overrides its parent's on native, so AppText must not
    // default it (PremiumScreen's price row caps at 1.3 and its nested price spans scaled to 1.5).
    name: 'text scale cap: a nested Text inherits the parent cap unless its call site sets one',
    run() {
      const { resolveFontSizeMultiplier } = require('../../src/textScale');
      assert.equal(resolveFontSizeMultiplier(undefined, true), undefined);
      assert.equal(resolveFontSizeMultiplier(0, true), undefined);
      assert.equal(resolveFontSizeMultiplier(1.2, true), 1.2);
      assert.equal(resolveFontSizeMultiplier(undefined, false), 1.5);
      assert.equal(resolveFontSizeMultiplier(0, false), 1.5);
      assert.equal(resolveFontSizeMultiplier(1.3, false), 1.3);
      assert.match(read('src', 'components', 'AppText.tsx'), /resolveFontSizeMultiplier\(props\.maxFontSizeMultiplier, nested\)/);
    },
  },
  {
    name: 'text scale cap: no file renders react-native Text, TextInput or the animated Text directly',
    run() {
      const offenders = [];
      const files = [...walk(path.join(root, 'src')), path.join(root, 'App.tsx')];
      for (const file of files) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        if (ALLOWED.has(rel)) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from 'react-native';/g)) {
          const specs = m[1].split(',').map((s) => s.trim());
          if (specs.some((s) => s === 'Text' || s === 'TextInput' || /^(Text|TextInput) as /.test(s))) offenders.push(rel);
        }
        if (/Animated\.Text\b/.test(source)) offenders.push(`${rel} (Animated.Text)`);
        // Other ways to reach react-native's Text: namespace import, require, re-export.
        if (/import\s*\*\s*as\s+\w+\s+from 'react-native'|require\('react-native'\)|export\s*\{[^}]*\bText(Input)?\b[^}]*\}\s*from 'react-native'/.test(source)) {
          offenders.push(`${rel} (namespace, require or re-export of react-native)`);
        }
      }
      assert.deepEqual(offenders, [], 'import Text/TextInput/AnimatedText from components/AppText or AnimatedText');
    },
  },
  {
    name: 'text scale cap: no call site asks for more than the cap',
    run() {
      const over = [];
      for (const file of [...walk(path.join(root, 'src')), path.join(root, 'App.tsx')]) {
        const source = fs.readFileSync(file, 'utf8');
        for (const m of source.matchAll(/maxFontSizeMultiplier(?:=\{|:\s*)(\d+(?:\.\d+)?)/g)) {
          if (Number(m[1]) > 1.5) over.push(`${path.relative(root, file)}: ${m[1]}`);
        }
      }
      assert.deepEqual(over, []);
    },
  },
];
