const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The unit tests load src/ directly through scripts/registerTs.cjs. The
 * compiled test build they used to read went stale silently (a green run
 * proving yesterday's code), so nothing may point at it again: no test, no
 * script, no workflow, no package script, no instruction file.
 *
 * The needles are built by concatenation so this file does not match itself.
 */
const ROOT = path.join(__dirname, '..', '..');
const OLD_DIR = ['.test', 'dist'].join('-');
const OLD_CONFIG = ['tsconfig', 'test', 'json'].join('.');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

module.exports = [
  {
    name: 'no compiled test build: nothing in tests, scripts, workflows, package.json or CLAUDE.md names it',
    run() {
      const files = [
        ...walk(path.join(ROOT, 'tests')),
        ...walk(path.join(ROOT, 'scripts')),
        ...walk(path.join(ROOT, '.github')),
        path.join(ROOT, 'package.json'),
        path.join(ROOT, 'CLAUDE.md'),
      ].filter((file) => /\.(cjs|js|ts|tsx|json|md|yml|yaml|sh|ps1|py)$/.test(file));
      assert.ok(files.length > 100, 'the scan found almost nothing');

      const offenders = [];
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        if (text.includes(OLD_DIR) || text.includes(OLD_CONFIG)) {
          offenders.push(path.relative(ROOT, file));
        }
      }
      assert.deepEqual(offenders, [], 'these still name the old compiled test build; tests load src/ directly');
    },
  },
  {
    name: 'no compiled test build: the tsconfig that produced it is gone, and package.json does not compile before testing',
    run() {
      assert.equal(fs.existsSync(path.join(ROOT, OLD_CONFIG)), false);
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      for (const [name, command] of Object.entries(pkg.scripts)) {
        assert.ok(!/\btsc\b[^&|]*-p\s+\S*test/.test(command), `script ${name} compiles a test build`);
      }
      assert.equal(pkg.scripts['test:unit'], 'node tests/run-tests.cjs');
    },
  },
];
