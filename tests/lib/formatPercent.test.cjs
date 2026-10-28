const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { formatPercent } = require('../../src/lib/format');

const ROOT = path.join(__dirname, '..', '..');

/**
 * How a percentage is written, and who gets to decide it.
 *
 * Finnish puts a space before the sign, English does not, and five places in
 * the app wrote one by hand with two opinions between them — the programme
 * page and the emphasis sheet said "36 %", the plan-ready card and the
 * building screen said "97%". Both are right in one language and wrong in the
 * other, and the app ships both languages.
 */

/** Every file that renders UI, so a new hand-written percent is caught too. */
function uiSources() {
  const files = [];
  for (const dir of ['src/screens', 'src/components']) {
    const full = path.join(ROOT, dir);
    for (const name of fs.readdirSync(full)) {
      if (name.endsWith('.tsx')) {
        files.push([`${dir}/${name}`, fs.readFileSync(path.join(full, name), 'utf8')]);
      }
    }
  }
  return files;
}

module.exports = [
  {
    name: 'a percentage is spaced the way the reader\'s language spaces it',
    run() {
      assert.equal(formatPercent(36, 'en'), '36%');
      assert.equal(formatPercent(97, 'en'), '97%');
      // The Finnish space is NON-BREAKING (U+00A0): the number and its sign
      // are one word, and a plain space lets a narrow legend row wrap between
      // them.
      assert.equal(formatPercent(36, 'fi'), '36 %');
      assert.deepEqual(
        [...formatPercent(36, 'fi')].map((character) => character.charCodeAt(0)),
        [51, 54, 160, 37],
      );
      // Zero and a full hundred are percentages like any other.
      assert.equal(formatPercent(0, 'fi'), '0 %');
      assert.equal(formatPercent(100, 'en'), '100%');
      // English is the fallback, as everywhere else in this module.
      assert.equal(formatPercent(50), '50%');
    },
  },
  {
    name: 'no screen writes a percentage by hand',
    run() {
      // The three shapes the five call sites used. A style value —
      // `width: `${pct}%`` — is not one of them: it never sits against a
      // closing Text tag or inside a sentence.
      const HAND_WRITTEN = [
        /\}\s?%<\/Text>/,
        /\}\s%`/,
        /\$\{[A-Za-z][A-Za-z0-9_.?\s()\[\]'"-]*\}%`\}/,
      ];

      const offenders = [];
      for (const [file, source] of uiSources()) {
        for (const shape of HAND_WRITTEN) {
          const hit = source.match(shape);
          if (hit) {
            offenders.push(`${file}: ${hit[0].replace(/\r?\n/g, ' ')}`);
          }
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `hand-written percentages — use formatPercent(value, language):\n  ${offenders.join('\n  ')}`,
      );
    },
  },
  {
    name: 'the shapes the guard looks for are the ones that were actually there',
    run() {
      // A guard for a drift nobody can reproduce is a guard nobody can trust.
      // These are the five call sites as they were written, so the patterns
      // above are pinned to real code rather than to an idea of it.
      const WAS = [
        '<Text style={styles.emphasisLegendPercent}>{slice.percent} %</Text>',
        '<Text style={styles.rowPercent}>{percentByArea.get(area) ?? 0} %</Text>',
        '<Text style={[styles.splitPct, light && styles.splitPctLight]}>{segment.pct}%</Text>',
        '<Text style={styles.buildingPlanPercentText}>{`${buildingPlanPercent}%`}</Text>',
        '                } %`',
      ];
      const HAND_WRITTEN = [
        /\}\s?%<\/Text>/,
        /\}\s%`/,
        /\$\{[A-Za-z][A-Za-z0-9_.?\s()\[\]'"-]*\}%`\}/,
      ];
      for (const line of WAS) {
        assert.ok(
          HAND_WRITTEN.some((shape) => shape.test(line)),
          `the guard would not have caught: ${line}`,
        );
      }

      // And a style value must not trip it.
      for (const legitimate of [
        "    maxWidth: '96%',",
        '        outputRange: [\'0%\', `${Math.max(4, share)}%`],',
        '<View style={[styles.fill, { width: `${percent}%` }]} />',
      ]) {
        assert.ok(
          !HAND_WRITTEN.some((shape) => shape.test(legitimate)),
          `the guard fires on a style value: ${legitimate}`,
        );
      }
    },
  },
];
