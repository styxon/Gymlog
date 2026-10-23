const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createHookRuntime, deferred, flush } = require('../helpers/hookHarness.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src', 'screens', 'EditProfileScreen.tsx');
// .tsx is outside the test build; transpiled here, resolving its lib imports in the compiled tree.
const DIST_SCREENS = path.join(ROOT, '.test-dist', 'screens');

/**
 * Edit profile: Back tapped while Save is in flight (hunt 1.1.1). Back popped
 * the route, then the save resolved and the same handler popped again, so the
 * reader landed on the Profile root instead of Settings. The screen is run
 * through the hook harness: its JSX becomes plain objects, and the test
 * presses Back and Save on them.
 */
function loadScreen(runtime) {
  const ts = require('typescript');
  const out = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const element = (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } });
  const react = { __esModule: true, default: { ...runtime.react, createElement: element }, ...runtime.react, createElement: element };
  const host = (name) => name;
  const stubs = {
    react,
    'react-native': { Pressable: host('Pressable'), ScrollView: host('ScrollView'), View: host('View'), StyleSheet: { create: (styles) => styles } },
    '../components/AppText': { Text: host('Text'), TextInput: host('TextInput') },
    'react-native-svg': { __esModule: true, default: host('Svg'), Circle: 'Circle', Defs: 'Defs', LinearGradient: 'LinearGradient', Path: 'Path', Stop: 'Stop' },
    '../components/BackButton': { PageHeader: host('PageHeader') },
    '../theming': { useTheme: () => new Proxy({}, { get: () => '#000' }), useThemedStyles: () => new Proxy({}, { get: () => ({}) }) },
    '../theme': { layout: new Proxy({}, { get: () => 0 }) },
  };
  // The pure lib modules are the compiled ones; everything React Native is a stub.
  const load = (specifier) => (specifier in stubs ? stubs[specifier] : require(path.join(DIST_SCREENS, specifier)));
  const module = { exports: {} };
  new Function('require', 'module', 'exports', out)(load, module, module.exports);
  return module.exports.EditProfileScreen;
}

function find(node, test) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, test);
      if (hit) return hit;
    }
    return null;
  }
  if (test(node)) {
    return node;
  }
  return find(node.props?.children, test) ?? find(node.props?.right, test);
}

module.exports = [
  {
    name: 'edit profile: Back while Save is in flight leaves once, not twice (hunt 1.1.1)',
    async run() {
      const runtime = createHookRuntime();
      const EditProfileScreen = loadScreen(runtime);
      const save = deferred();
      let backs = 0;
      const props = { initialName: 'Tatu', language: 'fi', onBack: () => (backs += 1), onSave: () => save.promise };
      let tree = runtime.render(EditProfileScreen, props);
      find(tree, (n) => n.type === 'TextInput').props.onChangeText('Tatu Y');
      tree = runtime.render(EditProfileScreen, props);
      const pressSave = find(tree, (n) => n.type === 'Pressable' && typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button').props.onPress;
      const saving = pressSave();
      tree = runtime.render(EditProfileScreen, props);
      find(tree, (n) => n.type === 'PageHeader').props.onBack();
      runtime.unmount();
      save.resolve(true);
      await saving;
      await flush();
      assert.equal(backs, 1, 'the save that resolved after Back popped a second route');
    },
  },
  {
    name: 'edit profile: a save that resolves with the screen still open leaves once',
    async run() {
      const runtime = createHookRuntime();
      const EditProfileScreen = loadScreen(runtime);
      let backs = 0;
      const props = { initialName: '', language: 'en', onBack: () => (backs += 1), onSave: async () => true };
      let tree = runtime.render(EditProfileScreen, props);
      find(tree, (n) => n.type === 'TextInput').props.onChangeText('Sam');
      tree = runtime.render(EditProfileScreen, props);
      await find(tree, (n) => n.type === 'Pressable' && n.props.accessibilityRole === 'button').props.onPress();
      assert.equal(backs, 1);
    },
  },
];
