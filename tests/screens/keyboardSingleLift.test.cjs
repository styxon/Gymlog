const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(next));
    else if (/\.tsx?$/.test(entry.name)) out.push(next);
  }
  return out;
}

const FILES = [...walk('src'), 'App.tsx'];
// Either event, named outright or picked by platform.
const LISTENS = /Keyboard\.addListener\([^,)]*'keyboard(?:Did|Will)Show'/;

/**
 * Listeners that may use the keyboard's height as it is, and why. Anything
 * else that measures the keyboard goes through keyboardOpenBottomPadding.
 */
const ALLOWED = {
  'src/hooks/useKeyboardOpen.ts': 'reports the keyboard; pads nothing itself',
  'src/hooks/useKeyboardReveal.ts': 'room to scroll into, inside a ScrollView, not padding under a fixed foot',
  'src/screens/HomeScreen.tsx': 'the new-day name sheet is a Modal, and iOS does not lift a Modal',
  'src/screens/ProgramDetailScreen.tsx': 'the add-day sheet is a Modal, and iOS does not lift a Modal',
};

/**
 * iOS hunt 2026-10-17 (P0-4, S5a-2). On iOS the AppShell's KeyboardAvoidingView
 * ends every screen in it at the keyboard. The coach chat and the strength
 * goal had been written for edge-to-edge Android, where nothing is lifted, and
 * added the keyboard's measured height under their foot on both platforms: on
 * an iPhone that was a second keyboard of dead space, and the thread and the
 * number field between head and foot were squeezed to 0 pt.
 */
module.exports = [
  {
    name: 'keyboard: a screen in the shell is lifted once — the keyboard height goes through keyboardOpenBottomPadding',
    run() {
      const offenders = FILES.filter((file) => {
        const src = read(file);
        return LISTENS.test(src) && !ALLOWED[file] && !src.includes('keyboardOpenBottomPadding(');
      });
      assert.deepEqual(offenders, [], `measures the keyboard and pads by it on iOS too: ${offenders.join(', ')}`);
      // The allow-list cannot go stale: each entry still listens.
      for (const file of Object.keys(ALLOWED)) {
        assert.match(read(file), LISTENS, `${file} no longer listens — take it off the list`);
      }
      // The two sheets still ride on the measured inset, in a KitSheet (a Modal).
      for (const file of ['src/screens/HomeScreen.tsx', 'src/screens/ProgramDetailScreen.tsx']) {
        assert.match(read(file), /<KitSheet\b/);
        assert.match(read(file), /bottomInset=\{keyboardInset > 0 \? keyboardInset : insets\.bottom\}/);
      }
    },
  },
  {
    name: 'keyboard: the hook\'s height is only ever used through keyboardOpenBottomPadding',
    run() {
      const users = FILES.filter((file) => /useKeyboardOpen\(\)/.test(read(file)) && file !== 'src/hooks/useKeyboardOpen.ts');
      assert.ok(users.length >= 4, 'the chat, the goal flow, the ruler sheet and the correction use it');
      for (const file of users) {
        const src = read(file);
        const heights = (src.match(/keyboard\.height\b/g) ?? []).length;
        const lifted = (src.match(/keyboardOpenBottomPadding\(Platform\.OS, keyboard\.height,/g) ?? []).length;
        assert.equal(heights, lifted, `${file} uses the keyboard's height outside keyboardOpenBottomPadding`);
      }
      for (const file of ['src/screens/AICoachChatScreen.tsx', 'src/screens/StrengthGoalFlowScreen.tsx']) {
        const src = read(file);
        assert.match(src, /keyboard\.open && \{ paddingBottom: keyboardOpenBottomPadding\(Platform\.OS, keyboard\.height, /);
        assert.doesNotMatch(src, /keyboardHeight/);
      }
      // iOS reports on the will-events, the ones the shell lifts on: the
      // chat's reserve dropped a third of a second after the lift.
      const hook = read('src/hooks/useKeyboardOpen.ts');
      assert.match(hook, /ios \? 'keyboardWillShow' : 'keyboardDidShow'/);
      assert.match(hook, /ios \? 'keyboardWillHide' : 'keyboardDidHide'/);
      // The shell is the lift this all counts on.
      assert.match(read('src/components/AppShell.tsx'), /behavior=\{Platform\.select\(\{ ios: 'padding', android: undefined \}\)\}/);
    },
  },
  {
    name: 'keyboard: the chat and the goal flow put the keys away from the scroll, with no return key to do it',
    run() {
      const chat = read('src/screens/AICoachChatScreen.tsx');
      assert.match(chat, /contentContainerStyle=\{\[styles\.thread, [^\]]*\]\}\s+keyboardShouldPersistTaps="handled"[\s\S]{0,200}?keyboardDismissMode="on-drag"/);
      const goal = read('src/screens/StrengthGoalFlowScreen.tsx');
      assert.match(goal, /contentContainerStyle=\{styles\.listContent\}\s+keyboardShouldPersistTaps="handled"[\s\S]{0,200}?keyboardDismissMode="on-drag"/);
    },
  },
];
