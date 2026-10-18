const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');

function tsxFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** The body of `  name: { ... }` in a styles object, nested braces included. */
function styleBlock(source, name) {
  const start = source.search(new RegExp(`\\n\\s+${name}: \\{`));
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

/**
 * Owner's #12, iOS hunt 2026-10-17: the exercise picker's filter chips were cut
 * at the top and their rows slid out of line on iPhone. Their scroll view's
 * content container carried a negative margin, and iOS counts a content
 * container's own offset twice. A negative margin belongs on the scroll view
 * itself, never on its content.
 */
module.exports = [
  {
    name: 'scroll views: no content container is moved by a negative margin',
    run() {
      let checked = 0;
      const offenders = [];
      for (const file of tsxFiles(SRC)) {
        const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        const named = [...source.matchAll(/contentContainerStyle=\{\[?\s*styles\.(\w+)/g)].map((match) => match[1]);
        for (const name of new Set(named)) {
          const block = styleBlock(source, name);
          if (block === null) continue;
          checked += 1;
          if (/margin\w*:\s*-/.test(block)) offenders.push(`${path.relative(SRC, file)} styles.${name}`);
        }
        for (const match of source.matchAll(/contentContainerStyle=\{\{([^}]*)\}\}/g)) {
          checked += 1;
          if (/margin\w*:\s*-/.test(match[1])) offenders.push(`${path.relative(SRC, file)} inline`);
        }
      }
      assert.deepEqual(offenders, []);
      // Not a guard that passes by finding nothing.
      assert.ok(checked >= 30, `only ${checked} content containers read`);
    },
  },
];
