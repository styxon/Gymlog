const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').split('\r\n').join('\n');

const FLAG = 'EXPO_PUBLIC_SCREENSHOT_SEED';

/** Every .ts/.tsx under src, plus App.tsx. */
function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push({ rel: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(root, 'src'));
  files.push({ rel: 'App.tsx', text: read('App.tsx') });
  return files;
}

/**
 * The store screenshots' seed is invented data — six weeks nobody trained and
 * a Pro nobody paid for. It may open only in the build the screenshots
 * workflow makes, and these hold the one door it has:
 *
 * - index.ts picks SeededApp only when the flag is "1" at bundle time, and
 *   nothing else in the app imports src/screenshots/;
 * - no store profile in eas.json and no app.json field sets the flag; only the
 *   `screenshots` profile does, and it builds for the simulator alone, which
 *   the stores cannot take.
 */
module.exports = [
  {
    name: 'screenshot seed gate: index.ts is the only door, and it is behind the flag',
    run() {
      const index = read('index.ts');
      assert.match(
        index,
        /registerRootComponent\(\s*process\.env\.EXPO_PUBLIC_SCREENSHOT_SEED === '1' \? require\('\.\/src\/screenshots\/SeededApp'\)\.default : App,?\s*\)/,
      );
      for (const file of sourceFiles()) {
        if (file.rel.startsWith('src/screenshots/')) continue;
        assert.ok(!/screenshots\/(SeededApp|screenshotSeed)/.test(file.text), `${file.rel} reaches the screenshot seed`);
        assert.ok(!file.text.includes(FLAG), `${file.rel} reads ${FLAG}`);
      }
    },
  },
  {
    name: 'screenshot seed gate: only the simulator-only screenshots profile sets the flag',
    run() {
      const eas = JSON.parse(read('eas.json'));
      const profiles = eas.build;
      const shots = profiles.screenshots;
      assert.ok(shots, 'eas.json has no screenshots profile');
      assert.equal(shots.env?.[FLAG], '1');
      assert.equal(shots.ios?.simulator, true, 'the screenshots profile must build for the simulator only');
      assert.notEqual(shots.distribution, 'store');
      assert.equal(eas.submit?.screenshots, undefined, 'the screenshots profile must never be submitted');
      for (const [name, profile] of Object.entries(profiles)) {
        if (name === 'screenshots') continue;
        assert.equal(profile.env?.[FLAG], undefined, `eas.json profile ${name} sets ${FLAG}`);
        assert.notEqual(profile.extends, 'screenshots', `eas.json profile ${name} extends the screenshots profile`);
      }
      assert.ok(!read('app.json').includes(FLAG), 'app.json sets the flag');
      assert.ok(!read('app.config.js').includes(FLAG), 'app.config.js sets the flag');
    },
  },
  {
    name: 'screenshot seed gate: the workflow sets the flag only for its simulator build',
    run() {
      const workflow = read('.github/workflows/store-screenshots.yml');
      assert.ok(workflow.includes(`${FLAG}: '1'`));
      assert.match(workflow, /-sdk iphonesimulator/);
      for (const other of fs.readdirSync(path.join(root, '.github', 'workflows'))) {
        if (other === 'store-screenshots.yml') continue;
        assert.ok(!read('.github', 'workflows', other).includes(FLAG), `${other} sets ${FLAG}`);
      }
    },
  },
];
