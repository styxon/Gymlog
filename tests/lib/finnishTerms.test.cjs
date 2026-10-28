const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * One Finnish word per concept.
 *
 * The copy used to call the same thing by several names — 'luenta' and
 * 'analyysi' for the Pro read, 'ankkuriliike' and 'pääliike' for the same
 * role, six words for the conditioning block at the end of a session,
 * 'toistoalue' in the catalog rules but 'toistohaarukka' on the Pro page —
 * and no suite noticed, because every existing copy guard checks coverage
 * (a Finnish string exists and differs from English), not vocabulary. This
 * one pins the words that were retired, so they cannot come back one string
 * at a time.
 *
 * Only Finnish text is scanned: the FI block of the dictionary, the Finnish
 * content files and the Finnish legal arrays. The English dictionary still
 * says Free, Premium and Lifetime, as it should. Comments are stripped first,
 * so a note explaining why a word was retired does not trip the guard.
 */

const ROOT = path.join(__dirname, '..', '..');

/**
 * Retired word → the one that replaced it. Matched as substrings against the
 * lower-cased text, so a retired term opening a sentence ("Toistoalueen
 * yläpää…") or standing as a label is caught too — the first version compared
 * case-sensitively and let exactly that through.
 */
const RETIRED = [
  ['luenta', 'analyysi'],
  ['luennat', 'analyysi'],
  ['pääliike', 'ankkuriliike'],
  ['pääliikk', 'ankkuriliike'],
  ['päänosto', 'ankkuriliike'],
  ['pääharjoit', 'ankkuriliike'],
  ['toistoalue', 'toistohaarukka'],
  ['tavoitealue', 'toistohaarukka'],
  ['kuntopääte', 'kunto-osuus'],
  ['kuntopäätte', 'kunto-osuus'],
  ['hiit-pääte', 'kunto-osuus'],
  ['intervallipääte', 'kunto-osuus'],
  ['kuntolopetu', 'kunto-osuus'],
  ['loppuosuu', 'kunto-osuus'],
  ['altistu', 'kerta'],
  ['ilmaisversio', 'Ilmainen'],
  ['premium', 'Pro'],
  ['lifetime', 'Elinikäinen'],
  ['kardio', 'cardio'],
  ['vinha coach', 'Vinha-valmentaja'],
  // Retired from the instruction overlay on 2026-09-08, after reading all 617
  // Finnish steps beside their English. Each was one word for a thing that
  // already had one: the supinated grip is `alaote` (`yliote`'s pair, used 15
  // times), the EZ bar is `EZ-tanko`, and `pohjekonelaite` was pohje + kone +
  // laite for a machine that is a `pohjelaite`. Prefixes, not whole words, so
  // an inflected form cannot slip back in.
  ['myötäot', 'alaote'],
  ['kaarretan', 'EZ-tanko'],
  ['pohjekone', 'pohjelaite'],
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

/**
 * Comments and object keys go; only values are copy. A key such as
 * 'pro.page.perLifetime' names a price, and the word inside it is not
 * something a reader ever sees.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*'[^'\n]*':/gm, '')
    .replace(/^\s*"[^"\n]*":/gm, '');
}

/** The text between two markers; `end` null means to the end of the file. */
function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `marker not found: ${start}`);
  const to = end ? source.indexOf(end, from) : source.length;
  assert.ok(to > from, `marker not found: ${end}`);
  return source.slice(from, to);
}

/** Every Finnish slice the guard covers, by file. */
function finnishSlices() {
  const i18n = read('src/lib/i18n.ts');
  const legal = read('src/lib/legalDocuments.ts');
  const teaching = read('src/lib/exerciseTeaching.ts');
  const names = read('src/lib/exerciseNameLabel.ts');
  return [
    ['src/lib/i18n.ts', between(i18n, 'const FI: Record<I18nKey, string> = {', 'const STRINGS')],
    ['src/lib/readyProgramContentFi.ts', read('src/lib/readyProgramContentFi.ts')],
    ['src/lib/progressionRuleLabel.ts', read('src/lib/progressionRuleLabel.ts')],
    ['src/lib/exerciseInstructions.ts', read('src/lib/exerciseInstructions.ts')],
    ['src/data/exerciseInstructionsFiMore.ts', read('src/data/exerciseInstructionsFiMore.ts')],
    ['src/lib/sessionNameLabel.ts', read('src/lib/sessionNameLabel.ts')],
    // The exercise names themselves: "Myötäotteinen leuanveto" named the
    // chin-up with the retired word — and the wrong grip — because this file
    // was never read (2026-09-27).
    ['src/lib/exerciseNameLabel.ts', between(names, 'const EXERCISE_NAME_FI', 'const EXERCISE_NAME_EN')],
    ['src/lib/exerciseTeaching.ts', between(teaching, 'const TEACHING_FI', 'export function getExerciseTeaching')],
    ['src/lib/legalDocuments.ts (privacy)', between(legal, 'const privacyFi', 'const termsEn')],
    ['src/lib/legalDocuments.ts (terms)', between(legal, 'const termsFi', 'const TITLES')],
  ].map(([file, text]) => [file, stripComments(text)]);
}

module.exports = [
  {
    name: 'Finnish copy uses one word per concept — no retired term comes back',
    run() {
      const hits = [];
      for (const [file, text] of finnishSlices()) {
        // Lower-casing keeps every index: the letters involved map one code
        // unit to one code unit, so a hit in `hay` slices `text` correctly.
        const hay = text.toLowerCase();
        for (const [retired, replacement] of RETIRED) {
          let at = hay.indexOf(retired);
          while (at >= 0) {
            const lineStart = text.lastIndexOf('\n', at) + 1;
            const lineEnd = text.indexOf('\n', at);
            const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
            hits.push(`${file}: "${retired}" (use "${replacement}") in: ${line.slice(0, 100)}`);
            at = hay.indexOf(retired, at + retired.length);
          }
        }
      }
      assert.deepEqual(hits, [], `retired Finnish terms:\n  ${hits.join('\n  ')}`);
    },
  },
  {
    name: 'the guard reads the Finnish slices it claims to, not an empty string',
    run() {
      // A marker that drifts would silently shrink a slice to nothing and the
      // guard would pass on air. Each slice has to hold real Finnish copy.
      for (const [file, text] of finnishSlices()) {
        assert.ok(/[äö]/.test(text), `${file}: slice holds no Finnish text`);
      }
    },
  },
];
