const assert = require('node:assert/strict');
const path = require('node:path');

const { createHookRuntime, requireWithStubs } = require('../helpers/hookHarness.cjs');

/** The compiled hook with the keyboard and the platform replaced. */
function load(runtime, os, { visible = false, height = 0 } = {}) {
  const listeners = new Map();
  const Keyboard = {
    isVisible: () => visible,
    metrics: () => (visible ? { height } : undefined),
    addListener(type, listener) {
      listeners.set(type, listener);
      return { remove: () => listeners.delete(type) };
    },
  };
  const { useKeyboardOpen } = requireWithStubs(path.join(__dirname, '..', '..', '.test-dist', 'hooks', 'useKeyboardOpen.js'), {
    react: runtime.react,
    'react-native': { Keyboard, Platform: { OS: os } },
  });
  return {
    hook: useKeyboardOpen,
    emit(type, keyboardHeight) {
      const listener = listeners.get(type);
      assert.ok(listener, `nothing listens to ${type}`);
      listener({ endCoordinates: { height: keyboardHeight } });
    },
    listening: () => [...listeners.keys()].sort(),
  };
}

/**
 * iOS hunt 2026-10-17 (P0-4): the screens that drop their tab-bar reserve for
 * the keyboard read it from this hook. On iOS it has to move on the same
 * events the AppShell's KeyboardAvoidingView lifts on, or the screen jumps a
 * third of a second after the lift.
 */
module.exports = [
  {
    name: 'useKeyboardOpen: iOS follows the will-events, Android the did-events',
    run() {
      for (const [os, show, hide] of [
        ['ios', 'keyboardWillShow', 'keyboardWillHide'],
        ['android', 'keyboardDidShow', 'keyboardDidHide'],
      ]) {
        const runtime = createHookRuntime();
        const keyboard = load(runtime, os);
        assert.deepEqual(runtime.render(keyboard.hook), { open: false, height: 0 });
        assert.deepEqual(keyboard.listening(), [hide, show].sort(), os);
        keyboard.emit(show, 336);
        assert.deepEqual(runtime.render(keyboard.hook), { open: true, height: 336 }, os);
        // A new height (the suggestion bar, another field) is picked up.
        keyboard.emit(show, 291);
        assert.deepEqual(runtime.render(keyboard.hook), { open: true, height: 291 }, os);
        keyboard.emit(hide, 0);
        assert.deepEqual(runtime.render(keyboard.hook), { open: false, height: 0 }, os);
        runtime.unmount();
        assert.deepEqual(keyboard.listening(), [], `${os} left a listener behind`);
      }
    },
  },
  {
    name: 'useKeyboardOpen: a screen opened over the keyboard starts open, and a keyboard with no height is down',
    run() {
      const runtime = createHookRuntime();
      const keyboard = load(runtime, 'ios', { visible: true, height: 300 });
      assert.deepEqual(runtime.render(keyboard.hook), { open: true, height: 300 });
      runtime.unmount();

      // A floating keyboard, or a hardware keyboard's bar, lifted nothing:
      // the screen must keep its reserve.
      const second = createHookRuntime();
      const floating = load(second, 'android');
      second.render(floating.hook);
      floating.emit('keyboardDidShow', 0);
      assert.deepEqual(second.render(floating.hook), { open: false, height: 0 });
      const third = createHookRuntime();
      const zero = load(third, 'ios', { visible: true, height: 0 });
      assert.deepEqual(third.render(zero.hook), { open: false, height: 0 });
    },
  },
];
