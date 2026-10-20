const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const { familyForWeight, manropeOverride } = require('../../.test-dist/lib/manropeFamily.js');

module.exports = [
  {
    name: 'manrope family: every weight maps to its static file, unknown and missing to Regular',
    run() {
      const expected = {
        100: 'Manrope-Regular', 300: 'Manrope-Regular', 400: 'Manrope-Regular', normal: 'Manrope-Regular',
        500: 'Manrope-Medium', 600: 'Manrope-SemiBold', 700: 'Manrope-Bold', bold: 'Manrope-Bold',
        800: 'Manrope-ExtraBold', 900: 'Manrope-ExtraBold',
      };
      for (const [weight, family] of Object.entries(expected)) {
        assert.equal(familyForWeight(weight), family, weight);
        assert.equal(familyForWeight(Number(weight) || weight), family, weight);
      }
      assert.equal(familyForWeight(undefined), 'Manrope-Regular');
      assert.equal(familyForWeight(null), 'Manrope-Regular');
      assert.equal(familyForWeight('heavy'), 'Manrope-Regular');
    },
  },
  {
    name: 'manrope override: unfamilied and generic Manrope text is mapped, other explicit families are left alone',
    run() {
      assert.deepEqual(manropeOverride({ fontWeight: '800' }), { fontFamily: 'Manrope-ExtraBold', fontWeight: 'normal' });
      assert.deepEqual(manropeOverride({ fontFamily: 'Manrope', fontWeight: 600 }), { fontFamily: 'Manrope-SemiBold', fontWeight: 'normal' });
      assert.deepEqual(manropeOverride(undefined), { fontFamily: 'Manrope-Regular', fontWeight: 'normal' });
      assert.deepEqual(manropeOverride({}), { fontFamily: 'Manrope-Regular', fontWeight: 'normal' });
      assert.equal(manropeOverride({ fontFamily: 'JetBrainsMono', fontWeight: '700' }), null);
      assert.equal(manropeOverride({ fontFamily: 'Inter' }), null);
      assert.equal(manropeOverride({ fontFamily: 'Manrope-SemiBold' }), null);
    },
  },
  {
    name: 'manrope family: every mapped family is loaded by App.tsx, and the override is a shared object',
    run() {
      const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
      const mapped = new Set(['normal', 'bold', '100', '500', '600', '700', '800'].map((w) => familyForWeight(w)));
      for (const family of mapped) {
        assert.match(app, new RegExp(`'${family}': require\\('./assets/fonts/${family}\\.ttf'\\)`), family);
      }
      assert.equal(manropeOverride({ fontWeight: '800' }), manropeOverride({ fontWeight: 800 }));
    },
  },
  {
    // RN 0.83 Text/TextInput have no `.render`, so the old globalFont patch
    // did nothing from PR #303 to 2026-10-20 and the app drew in the system font.
    name: 'app typeface: AppText wraps both Text and TextInput with the mapping; globalFont stays gone',
    run() {
      const source = fs.readFileSync(path.join(root, 'src', 'components', 'AppText.tsx'), 'utf8');
      assert.equal(source.match(/style=\{withAppFont\(props\.style\)\}/g).length, 2, 'both Text and TextInput');
      assert.match(source, /manropeOverride\(StyleSheet\.flatten\(/);
      assert.equal(fs.existsSync(path.join(root, 'src', 'globalFont.ts')), false);
      assert.doesNotMatch(fs.readFileSync(path.join(root, 'App.tsx'), 'utf8'), /globalFont/);
    },
  },
  {
    name: 'app typeface: the wrapper renders the Manrope family for the weight on native, and leaves other families and web alone',
    run() {
      const ts = require('typescript');
      const Module = require('node:module');
      const source = fs.readFileSync(path.join(root, 'src', 'components', 'AppText.tsx'), 'utf8');
      const family = path.join(root, '.test-dist', 'lib', 'manropeFamily.js');
      const mock = { Platform: { OS: 'ios' } };
      const rn = {
        get Platform() { return mock.Platform; },
        StyleSheet: {
          flatten(style) {
            if (Array.isArray(style)) return Object.assign({}, ...style.map((s) => rn.StyleSheet.flatten(s)));
            return style || undefined;
          },
        },
        Text: function Text() {},
        TextInput: function TextInput() {},
      };
      const js = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const originalLoad = Module._load;
      Module._load = function load(request, ...rest) {
        if (request === 'react-native') return rn;
        if (request === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (request === 'react') return {};
        if (request === '../lib/manropeFamily') return originalLoad.call(this, family, ...rest);
        if (request === '../textScale') return { TEXT_SCALE_CAP: 1.5 };
        return originalLoad.call(this, request, ...rest);
      };
      try {
        const m = { exports: {} };
        new Function('module', 'exports', 'require', js)(m, m.exports, require);
        const { Text, TextInput } = m.exports;
        const styleOf = (el) => rn.StyleSheet.flatten(el.props.style);

        const heavy = styleOf(Text({ style: { fontSize: 20, fontWeight: '800' } }));
        assert.equal(heavy.fontFamily, 'Manrope-ExtraBold');
        assert.equal(heavy.fontWeight, 'normal');
        assert.equal(heavy.fontSize, 20);
        assert.equal(styleOf(TextInput({ style: [{ fontWeight: '600' }] })).fontFamily, 'Manrope-SemiBold');
        assert.equal(styleOf(Text({})).fontFamily, 'Manrope-Regular');
        assert.equal(styleOf(Text({ style: { fontFamily: 'Manrope', fontWeight: 'bold' } })).fontFamily, 'Manrope-Bold');

        const mono = Text({ style: { fontFamily: 'JetBrainsMono', fontWeight: '700' } });
        assert.deepEqual(mono.props.style, { fontFamily: 'JetBrainsMono', fontWeight: '700' });

        mock.Platform = { OS: 'web' };
        assert.deepEqual(Text({ style: { fontWeight: '800' } }).props.style, { fontWeight: '800' });
      } finally {
        Module._load = originalLoad;
      }
    },
  },
];
