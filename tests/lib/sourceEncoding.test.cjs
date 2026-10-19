const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A Windows-1252 em dash (0x97) typed into a comment makes a file that is no
// longer UTF-8: git shows it, a strict decoder refuses it, and the next editor
// that re-saves it as UTF-8 turns it into a replacement character (2026-10-02).
const ROOT = path.join(__dirname, '..', '..');
const SOURCE = /\.(ts|tsx|js|cjs|mjs|json)$/;

function walk(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (SOURCE.test(entry.name)) found.push(full);
  }
  return found;
}

module.exports = [
  {
    name: 'source encoding: every file under src, api and tests is valid UTF-8',
    run() {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const bad = [];
      for (const dir of ['src', 'api', 'tests']) {
        const full = path.join(ROOT, dir);
        if (!fs.existsSync(full)) continue;
        for (const file of walk(full, [])) {
          try {
            decoder.decode(fs.readFileSync(file));
          } catch {
            bad.push(path.relative(ROOT, file));
          }
        }
      }
      assert.deepEqual(bad, [], `not valid UTF-8: ${bad.join(', ')}`);
    },
  },
  {
    // Valid UTF-8 can still be wrong: text that was read as Windows-1252 and
    // saved back as UTF-8 turns an em dash into a-circumflex and two control
    // characters, and "ä" into A-tilde and a currency sign. One such dash
    // reached the English coach answer and the App Store screenshots
    // (2026-10-18). The pattern is written as escapes so this file does not
    // trip itself.
    name: 'source encoding: no UTF-8 read as Windows-1252 (mojibake) under src, api and tests',
    run() {
      const MOJIBAKE = new RegExp('\\u00e2[\\u0080-\\u00bf\\u20ac]|\\u00c3[\\u0080-\\u00bf]|\\u00c2[\\u0080-\\u00bf]');
      const bad = [];
      for (const dir of ['src', 'api', 'tests']) {
        const full = path.join(ROOT, dir);
        if (!fs.existsSync(full)) continue;
        for (const file of walk(full, [])) {
          const lines = fs.readFileSync(file, 'utf8').split('\n');
          lines.forEach((line, index) => {
            if (MOJIBAKE.test(line)) bad.push(`${path.relative(ROOT, file)}:${index + 1}`);
          });
        }
      }
      assert.deepEqual(bad, [], `mojibake at ${bad.join(', ')}`);
    },
  },
];
