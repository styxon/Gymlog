const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { formatHomeStatValue } = require('../../src/lib/homeStatCards');
const { setNumberLanguage } = require('../../src/lib/format');

const root = path.join(__dirname, '..', '..');

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push({ rel: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(root, 'src'));
  out.push({ rel: 'App.tsx', text: fs.readFileSync(path.join(root, 'App.tsx'), 'utf8') });
  return out;
}

/**
 * Three bugs of one shape were found on a phone in a single week: newer code
 * rendering a value directly instead of routing it through the helper every
 * other screen uses. A weight printed as "92.5 kg" to a Finnish reader, the
 * same weight hidden inside an i18n variable where the call site looks
 * correct, and an exercise called "Barbell Bench Press - Medium Grip" two taps
 * from a screen calling it "Penkkipunnerrus".
 *
 * A sweep found twenty-two more. These guards exist so there is no
 * twenty-third: the interesting half of that class is invisible at the call
 * site, which is exactly the kind of thing a person cannot be asked to
 * remember.
 */
module.exports = [
  {
    name: 'formatting: an exercise name reaching the UI is localized',
    run() {
      /**
       * formatLiftDisplayLabel tidies a stored name; exerciseNameLabel is what
       * makes it Finnish. Used alone, the second half is missing.
       *
       * Each exemption is a place where the value is NOT display text. Add one
       * only with a reason — a name that reaches a screen belongs in neither
       * list, it belongs in a wrapper.
       */
      const ALLOWED = {
        'src/lib/recommendationProgramme.ts':
          'keyLifts is data: programDayComposer turns each entry into a real exercise, ' +
          'and a Finnish label written there would break library matching.',
        'src/screens/ProgressScreen.tsx':
          'the deliberate second half of a dual-spelling search filter — it matches ' +
          'the English spelling so both spellings find the lift.',
        'src/lib/homePrimaryAction.ts':
          'the whole card is hardcoded English and its result is never rendered ' +
          '(App computes selectHomePrimaryAction and drops it). Localizing one word ' +
          'inside an English sentence would be worse than leaving it. Logged.',
      };

      const offenders = [];
      for (const { rel, text } of sourceFiles()) {
        if (rel.endsWith('lib/displayLabel.ts') || ALLOWED[rel]) {
          continue;
        }
        for (const [index, line] of text.split('\n').entries()) {
          // exerciseListLabel localizes too — it is exerciseNameLabel, shortened.
          if (
            line.includes('formatLiftDisplayLabel(') &&
            !line.includes('exerciseNameLabel(') &&
            !line.includes('exerciseListLabel(')
          ) {
            offenders.push(`${rel}:${index + 1}`);
          }
        }
      }

      assert.deepEqual(
        offenders,
        [],
        'these format a lift name without localizing it — wrap in exerciseNameLabel, ' +
          `or add an exemption with a reason: ${offenders.join(', ')}`,
      );
    },
  },
  {
    name: 'formatting: the decimal mark lives in exactly one place',
    run() {
      // programDetails hardcoded a comma and so wrote "1,5 min" to English
      // readers — the same bug pointing the other way. Whoever needs a
      // separator needs the language's, and format.ts is the only thing that
      // knows which that is.
      const offenders = [];
      for (const { rel, text } of sourceFiles()) {
        if (rel === 'src/lib/format.ts') {
          continue;
        }
        for (const [index, line] of text.split('\n').entries()) {
          if (/\.replace\(\s*['"]\.['"]\s*,\s*['"],['"]\s*\)/.test(line)) {
            offenders.push(`${rel}:${index + 1}`);
          }
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `these swap a decimal point for a comma by hand: ${offenders.join(', ')}`,
      );

      // And the one place that does know owns both directions.
      const format = fs.readFileSync(path.join(root, 'src', 'lib', 'format.ts'), 'utf8');
      assert.match(format, /export function applyDecimalSeparator/);
      assert.match(format, /export function setNumberLanguage/);
    },
  },
  {
    name: 'formatting: no raw toFixed is rendered straight into the UI',
    run() {
      // `{bmi.toFixed(1)}` inside JSX was two of the sweep's findings. It is
      // always wrong: toFixed is JS's decimal point, never the reader's.
      const offenders = [];
      for (const { rel, text } of sourceFiles()) {
        if (!rel.endsWith('.tsx')) {
          continue;
        }
        for (const [index, line] of text.split('\n').entries()) {
          const rendered = />\{[^}]*\.toFixed\(/.test(line);
          const wrapped = /removeTrailingZeros\(|applyDecimalSeparator\(/.test(line);
          if (rendered && !wrapped) {
            offenders.push(`${rel}:${index + 1}`);
          }
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `these render toFixed directly: wrap in removeTrailingZeros — ${offenders.join(', ')}`,
      );
    },
  },
  {
    name: 'formatting: a fixed module answers in the reader’s language',
    run() {
      // One behavioural check to go with the structural ones, on a formatter
      // the sweep found and that is callable without fixtures. If the module
      // setting ever stops reaching the helpers, this fails on output rather
      // than on a regex.
      setNumberLanguage('fi');
      assert.equal(formatHomeStatValue(12.4), '12,4');
      assert.equal(formatHomeStatValue(12), '12');

      setNumberLanguage('en');
      assert.equal(formatHomeStatValue(12.4), '12.4');

      // The empty state is an em dash, and it is not a number.
      assert.equal(formatHomeStatValue(null), '—');
      // Left in English for the suites that run after this one.
    },
  },
];
