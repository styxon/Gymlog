/**
 * Export every static text the app can show, English beside Finnish.
 *
 * The app's copy does not live in one place, and it never will: UI strings are
 * flat keys, exercise names and instructions are overlays on an English
 * dataset, programme prose is long-form, and the legal documents are whole
 * documents. This walks each of those layers through the same functions the
 * screens call, so what lands in the CSV is what a reader sees — not what the
 * source file happens to hold.
 *
 * IT IS GENERATED. Nothing here is a source of truth; edit `src/`, re-run, and
 * the folder catches up. It is regenerated, not maintained.
 *
 * WHAT IT CANNOT COVER, stated in the README it writes as well:
 *   - The AI coach's live answers. They are produced per request and do not
 *     exist as text until someone asks.
 *   - Anything the reader typed: their programme names, their own exercises.
 *
 * Loads `src/` through the TypeScript hook, like the tests do:
 *   node scripts/export-app-texts.cjs
 */

require('./registerTs.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'outputs', 'app-texts-fi-en');

const dist = (p) => require(path.join(DIST, p));

const { I18N_KEYS, t } = dist('lib/i18n.js');
const { createSeedExerciseLibrary } = dist('data/seed.js');
const { exerciseNameLabel, TRANSLATED_EXERCISE_NAMES } = dist('lib/exerciseNameLabel.js');
const { getExerciseInstructions, finnishInstructionTable } = dist('lib/exerciseInstructions.js');
const EXERCISE_INSTRUCTIONS_FI_TABLE = finnishInstructionTable();
const { getReadyProgramContent } = dist('lib/readyProgramContent.js');
const { getReadyTemplatePresentation } = dist('lib/templatePresentation.js');
const { localizeSessionName } = dist('lib/sessionNameLabel.js');
const { progressionRuleLabel } = dist('lib/progressionRuleLabel.js');
const { EXERCISE_TEACHING_TABLES } = dist('lib/exerciseTeaching.js');
const { buildLegalDocument, renderLegalDocumentMarkdown, LEGAL_LAST_UPDATED } = dist('lib/legalDocuments.js');
const { WORKOUT_TEMPLATES_V1 } = dist('features/workout/workoutCatalog.js');

// ── output helpers ────────────────────────────────────────────────────────
// Semicolon-separated with a BOM: this is opened in Excel on a Finnish
// Windows, where a comma file lands in a single column. The JSON beside it is
// the machine-readable copy, so nothing is lost to that choice.
function csv(header, rows) {
  const cell = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  return (
    '\uFEFF' +
    [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n') +
    '\r\n'
  );
}

/**
 * Everything is built in memory and written at the end, on purpose.
 *
 * The first version wiped the output directory on line one and wrote each file
 * as it was produced. A `tsc` that had not been re-run, a renamed export, one
 * throw anywhere in the ten layers — and the reader was left with a half-empty
 * folder where a complete older one had been. Nothing here is expensive enough
 * to justify that: the whole export is a few megabytes of strings.
 */
const pending = new Map();
function write(name, contents) {
  pending.set(name, contents);
}

function flush() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, contents] of pending) {
    fs.writeFileSync(path.join(OUT, name), contents, 'utf8');
  }
}

const json = {};
const counts = {};

// ── 01 UI strings ─────────────────────────────────────────────────────────
// The dead-UI scanner's verdict rides along as a column. A key it names is a
// question, not a corpse — some are built by string concatenation and it
// cannot see the call — so the column says "candidate", not "unused".
let unusedKeys = new Set();
try {
  const report = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'find-dead-ui.cjs')], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  const section = report.split('i18n keys defined and never rendered')[1] ?? '';
  // Neither `\S+` nor a two-space column gap parses this report. Keys contain
  // spaces (`onb.equip.Barbell & plates`) and a key long enough to fill the
  // column is followed by a single space, so the match is lazy up to the one
  // separator that leaves exactly the source path behind it.
  unusedKeys = new Set(
    [...section.matchAll(/^ {2}(.*?) +src\/lib\/i18n\.ts\s*$/gm)].map((match) => match[1]),
  );
} catch (error) {
  console.warn('find-dead-ui.cjs did not run; the reach column will say "unknown".', error.message);
  unusedKeys = null;
}

const uiRows = I18N_KEYS.map((key) => {
  const en = t('en', key);
  const fi = t('fi', key);
  const reach = unusedKeys === null ? 'unknown' : unusedKeys.has(key) ? 'never-rendered-candidate' : 'rendered';
  return [key, en, fi, en === fi ? 'same_in_both' : 'translated', reach];
});
write('01-ui-strings.csv', csv(['key', 'en', 'fi', 'status', 'reach'], uiRows));
json.uiStrings = uiRows.map(([key, en, fi, status, reach]) => ({ key, en, fi, status, reach }));
counts.uiStrings = uiRows.length;
counts.uiStringsNeverRendered = uiRows.filter((row) => row[4] === 'never-rendered-candidate').length;

// ── 02 exercise names ─────────────────────────────────────────────────────
// Every name a reader can meet: the library the app seeds, plus the names the
// ready programmes prescribe (a programme may name a lift the library spells
// differently, and that name is what the plan screen prints).
const library = createSeedExerciseLibrary();
const catalogNames = new Set();
for (const template of WORKOUT_TEMPLATES_V1) {
  for (const session of template.sessions ?? []) {
    for (const exercise of session.exercises ?? []) {
      if (exercise.exerciseName) catalogNames.add(exercise.exerciseName);
    }
  }
}

const nameSeen = new Map();
for (const item of library) nameSeen.set(item.name, { source: 'library', id: item.id });
for (const name of catalogNames) {
  if (!nameSeen.has(name)) nameSeen.set(name, { source: 'programme catalog', id: '' });
}

const nameRows = [...nameSeen.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([name, meta]) => {
    const en = exerciseNameLabel('en', name);
    const fi = exerciseNameLabel('fi', name);
    const translated = Object.prototype.hasOwnProperty.call(TRANSLATED_EXERCISE_NAMES, name);
    return [meta.id, name, en, fi, meta.source, translated ? 'translated' : 'falls_back_to_english'];
  });
write(
  '02-exercise-names.csv',
  csv(['exercise_id', 'stored_name', 'en', 'fi', 'source', 'status'], nameRows),
);
json.exerciseNames = nameRows.map(([id, stored, en, fi, source, status]) => ({
  id,
  storedName: stored,
  en,
  fi,
  source,
  status,
}));
counts.exerciseNames = nameRows.length;
counts.exerciseNamesWithoutFinnish = nameRows.filter((row) => row[5] !== 'translated').length;

// ── 03 exercise instructions ──────────────────────────────────────────────
// Step for step. A Finnish entry has exactly as many steps as the English one,
// so the rows pair; where there is no entry the FI cell is empty and the app
// shows the English step, which is what the status column says.
const instructionRows = [];
let instructionStepsWithFinnish = 0;
for (const item of library) {
  const english = getExerciseInstructions(item.name, item.instructions, 'en');
  const finnish = getExerciseInstructions(item.name, item.instructions, 'fi');
  const hasFinnish = Object.prototype.hasOwnProperty.call(EXERCISE_INSTRUCTIONS_FI_TABLE, item.name.trim());
  english.forEach((step, index) => {
    const fi = hasFinnish ? finnish[index] ?? '' : '';
    if (fi) instructionStepsWithFinnish += 1;
    instructionRows.push([
      item.id,
      item.name,
      String(index + 1),
      step,
      fi,
      hasFinnish ? 'translated' : 'falls_back_to_english',
    ]);
  });
}
write(
  '03-exercise-instructions.csv',
  csv(['exercise_id', 'exercise', 'step', 'en', 'fi', 'status'], instructionRows),
);
json.exerciseInstructions = instructionRows.map(([id, exercise, step, en, fi, status]) => ({
  id,
  exercise,
  step: Number(step),
  en,
  fi,
  status,
}));
counts.instructionSteps = instructionRows.length;
counts.instructionStepsWithFinnish = instructionStepsWithFinnish;
counts.exercisesWithFinnishInstructions = Object.keys(EXERCISE_INSTRUCTIONS_FI_TABLE).length;

// ── 04 programme prose ────────────────────────────────────────────────────
const CONTENT_FIELDS = ['summary', 'audience', 'equipmentProfile', 'whyItWorks'];
const contentRows = [];
for (const template of WORKOUT_TEMPLATES_V1) {
  const en = getReadyProgramContent(template.id, 'en');
  const fi = getReadyProgramContent(template.id, 'fi');
  if (!en) continue;
  for (const field of CONTENT_FIELDS) {
    const enText = en[field] ?? '';
    const fiText = fi?.[field] ?? '';
    contentRows.push([
      template.id,
      field,
      enText,
      fiText,
      fiText && fiText !== enText ? 'translated' : 'falls_back_to_english',
    ]);
  }
}
write('04-programme-prose.csv', csv(['template_id', 'field', 'en', 'fi', 'status'], contentRows));
json.programmeProse = contentRows.map(([id, field, en, fi, status]) => ({
  templateId: id,
  field,
  en,
  fi,
  status,
}));
counts.programmeProse = contentRows.length;

// ── 05 programme titles + session names ───────────────────────────────────
// Programme family names (STRONG, HUGE, RESET…) are the product's own and stay
// English on purpose; the row says so rather than reading as a gap.
const titleRows = [];
for (const template of WORKOUT_TEMPLATES_V1) {
  const en = getReadyTemplatePresentation(template, 'en');
  const fi = getReadyTemplatePresentation(template, 'fi');
  titleRows.push([
    template.id,
    'programme title',
    en.title,
    fi.title,
    en.title === fi.title ? 'brand_name_stays_english' : 'translated',
  ]);
  titleRows.push([
    template.id,
    'programme subtitle',
    en.subtitle,
    fi.subtitle,
    en.subtitle === fi.subtitle ? 'same_in_both' : 'translated',
  ]);
  for (const session of template.sessions ?? []) {
    const sessionEn = localizeSessionName(session.name, 'en');
    const sessionFi = localizeSessionName(session.name, 'fi');
    titleRows.push([
      template.id,
      'session name',
      sessionEn,
      sessionFi,
      sessionEn === sessionFi ? 'same_in_both' : 'translated',
    ]);
  }
}
write('05-programme-and-session-names.csv', csv(['template_id', 'kind', 'en', 'fi', 'status'], titleRows));
json.programmeNames = titleRows.map(([id, kind, en, fi, status]) => ({
  templateId: id,
  kind,
  en,
  fi,
  status,
}));
counts.programmeAndSessionNames = titleRows.length;

// ── 06 progression rules ──────────────────────────────────────────────────
const RULE_FIELDS = ['primary', 'secondary', 'accessory', 'failureHandling'];
const ruleUsers = new Map();
for (const template of WORKOUT_TEMPLATES_V1) {
  for (const field of RULE_FIELDS) {
    const rule = template.progressionRules?.[field];
    if (!rule) continue;
    const entry = ruleUsers.get(rule) ?? { field, templates: [] };
    entry.templates.push(template.id);
    ruleUsers.set(rule, entry);
  }
}
const ruleRows = [...ruleUsers.entries()].map(([rule, meta]) => {
  const fi = progressionRuleLabel('fi', rule);
  return [
    meta.field,
    rule,
    fi,
    fi === rule ? 'falls_back_to_english' : 'translated',
    String(meta.templates.length),
  ];
});
write('06-progression-rules.csv', csv(['field', 'en', 'fi', 'status', 'used_by_programmes'], ruleRows));
json.progressionRules = ruleRows.map(([field, en, fi, status, used]) => ({
  field,
  en,
  fi,
  status,
  usedByProgrammes: Number(used),
}));
counts.progressionRules = ruleRows.length;

// ── 07 teaching cards ─────────────────────────────────────────────────────
const teachingRows = [];
/**
 * Keyed by field, never by position.
 *
 * The two tables are written by hand and nothing enforces that they have the
 * same number of cues, swaps or checks. Pairing them by array index means that
 * the day one side gains a line, every row after it silently pairs English with
 * the wrong Finnish — and the CSV would still label each of those rows
 * `translated`. In an artifact whose whole purpose is reading translations side
 * by side, a quiet misalignment is worse than a gap. The swap key deliberately
 * leaves the exercise name out of the key and puts it in the text, because the
 * two languages may legitimately suggest different lifts.
 */
function teachingLines(teaching) {
  if (!teaching) return [];
  const lines = [];
  teaching.cues.forEach((cue, index) => lines.push([`cue ${index + 1}`, cue]));
  teaching.mistakes.forEach((mistake, index) => {
    lines.push([`mistake ${index + 1}`, mistake.mistake]);
    lines.push([`mistake ${index + 1} fix`, mistake.fix]);
  });
  lines.push(['feel', teaching.feel]);
  teaching.tempo.forEach((chip, index) => lines.push([`tempo ${index + 1}`, chip]));
  teaching.swaps.forEach((swap, index) =>
    lines.push([`swap ${index + 1} (${swap.direction})`, `${swap.exerciseName}: ${swap.why}`]),
  );
  teaching.check.forEach((line, index) => lines.push([`check ${index + 1}`, line]));
  if (teaching.caution) lines.push([`caution (${teaching.caution.area})`, teaching.caution.text]);
  return lines;
}
for (const name of Object.keys(EXERCISE_TEACHING_TABLES.en)) {
  const en = teachingLines(EXERCISE_TEACHING_TABLES.en[name]);
  const fi = new Map(teachingLines(EXERCISE_TEACHING_TABLES.fi[name]));
  for (const [field, text] of en) {
    const fiText = fi.get(field) ?? '';
    fi.delete(field);
    teachingRows.push([name, field, text, fiText, fiText ? 'translated' : 'falls_back_to_english']);
  }
  // A Finnish line with no English counterpart is a real divergence, so it
  // leaves as its own row rather than disappearing off the end of the pairing.
  for (const [field, text] of fi) {
    teachingRows.push([name, field, '', text, 'finnish_only']);
  }
}
write('07-teaching-cards.csv', csv(['exercise', 'field', 'en', 'fi', 'status'], teachingRows));
json.teachingCards = teachingRows.map(([exercise, field, en, fi, status]) => ({
  exercise,
  field,
  en,
  fi,
  status,
}));
counts.teachingCardLines = teachingRows.length;

// ── 08 legal documents ────────────────────────────────────────────────────
// Whole documents, so they leave as documents: a paragraph of a privacy policy
// read out of a spreadsheet cell is not reviewable as policy. The CSV beside
// them pairs the paragraphs for anyone checking the translation line by line.
const legalRows = [];
for (const id of ['privacy', 'terms']) {
  for (const language of ['en', 'fi']) {
    const document = buildLegalDocument(id, language);
    write(`08-legal-${id}-${language}.md`, renderLegalDocumentMarkdown(document));
  }
  const en = buildLegalDocument(id, 'en');
  const fi = buildLegalDocument(id, 'fi');
  // Unlike the teaching cards, these two are the SAME document in two
  // languages: section n of the Finnish privacy policy must be section n of the
  // English one. If that stops being true, pairing them by index puts one
  // clause beside another clause's translation, and this CSV is what a lawyer
  // reads to check the policy. Loud, not quiet.
  if (en.sections.length !== fi.sections.length) {
    throw new Error(
      `${id}: the legal documents have diverged — ${en.sections.length} English sections, ` +
        `${fi.sections.length} Finnish. Pairing them by position would be a lie; fix ` +
        `src/lib/legalDocuments.ts first.`,
    );
  }
  legalRows.push([id, '0', 'title', en.title, fi.title]);
  legalRows.push([id, '0', 'summary', en.summary, fi.summary]);
  en.sections.forEach((section, index) => {
    const other = fi.sections[index];
    legalRows.push([id, String(index + 1), 'heading', section.heading, other?.heading ?? '']);
    (section.body ?? []).forEach((paragraph, line) => {
      legalRows.push([id, String(index + 1), `body ${line + 1}`, paragraph, other?.body?.[line] ?? '']);
    });
    (section.bullets ?? []).forEach((bullet, line) => {
      legalRows.push([id, String(index + 1), `bullet ${line + 1}`, bullet, other?.bullets?.[line] ?? '']);
    });
  });
}
write('08-legal.csv', csv(['document', 'section', 'field', 'en', 'fi'], legalRows));
json.legal = legalRows.map(([document, section, field, en, fi]) => ({
  document,
  section: Number(section),
  field,
  en,
  fi,
}));
counts.legalLines = legalRows.length;

// ── 09 English that reaches the screen without passing through i18n ───────
// Kept as a hand-checked list, not a scan. Every row here was traced from the
// literal to the screen that prints it; a scan of the same shape returns
// hundreds of rows that never render, and a list nobody trusts is a list
// nobody reads.
const leakRows = [
  [
    'src/lib/tailoringFit.ts:344',
    'Home fit',
    'Ready programme detail — fit badges',
    'buildTailoringBadgeLabels -> renderWorkoutTab.tsx:314 -> programDetails.ts:234 (tailoringBadges), passed through untranslated',
  ],
  [
    'src/lib/tailoringFit.ts:346',
    'Minimal fit',
    'Ready programme detail — fit badges',
    'same path',
  ],
  [
    'src/lib/tailoringFit.ts:348',
    'Full gym fit',
    'Ready programme detail — fit badges',
    'same path',
  ],
];
write('09-english-reaching-the-screen.csv', csv(['source', 'text', 'where', 'path'], leakRows));
json.englishReachingTheScreen = leakRows.map(([source, text, where, pathNote]) => ({
  source,
  text,
  where,
  path: pathNote,
}));
counts.englishReachingTheScreen = leakRows.length;

// ── index ─────────────────────────────────────────────────────────────────
write('app-texts.json', JSON.stringify({ generatedAt: new Date().toISOString(), counts, ...json }, null, 2));

const pct = (part, whole) => (whole === 0 ? '0' : Math.round((part / whole) * 100));

const readme = `# Vinha — every static text, English beside Finnish

Generated ${new Date().toISOString().slice(0, 10)} from the working tree. **Do not edit these files.**
They are output: change \`src/\`, run the command below, and the folder catches up.

\`\`\`powershell
node scripts/export-app-texts.cjs
\`\`\`

Every row is produced by calling the same function the screen calls, so the EN and
FI columns are what a reader sees — not what the source file happens to hold.

## Files

| File | Rows | What it holds |
|---|---:|---|
| \`01-ui-strings.csv\` | ${counts.uiStrings} | The UI dictionary (\`src/lib/i18n.ts\`). Every key has both languages — a test fails otherwise. |
| \`02-exercise-names.csv\` | ${counts.exerciseNames} | Exercise names: the seeded library plus the names the programmes prescribe. |
| \`03-exercise-instructions.csv\` | ${counts.instructionSteps} | Performance steps, one row per step. |
| \`04-programme-prose.csv\` | ${counts.programmeProse} | Summary, audience, equipment and why-it-works for each ready programme. |
| \`05-programme-and-session-names.csv\` | ${counts.programmeAndSessionNames} | Programme titles and subtitles, and every training day's name. |
| \`06-progression-rules.csv\` | ${counts.progressionRules} | The four progression rules each programme carries. |
| \`07-teaching-cards.csv\` | ${counts.teachingCardLines} | Cues, mistakes, tempo, swaps and self-checks for the lifts that have a teaching card. |
| \`08-legal-*.md\`, \`08-legal.csv\` | ${counts.legalLines} | Privacy policy and terms, as documents and paragraph by paragraph. Updated ${LEGAL_LAST_UPDATED}. |
| \`09-english-reaching-the-screen.csv\` | ${counts.englishReachingTheScreen} | English that reaches a Finnish reader without passing through the dictionary. Defects, not translations. |
| \`app-texts.json\` | — | All of the above in one machine-readable file. |

CSVs are UTF-8 with a BOM and semicolon-separated, so they open correctly in
Excel on a Finnish Windows. \`app-texts.json\` is the copy to script against.

## Where Finnish is complete, and where it is not

- **UI strings — complete.** ${counts.uiStrings} keys, both languages, guarded by
  \`tests/lib/i18n.test.cjs\`. ${counts.uiStringsNeverRendered} of them are flagged
  \`never-rendered-candidate\` in the \`reach\` column: the dead-UI scanner cannot
  find a render site. That is a question, not a verdict — some keys are built by
  concatenation and the scanner cannot see the call.
- **Exercise names — ${pct(counts.exerciseNames - counts.exerciseNamesWithoutFinnish, counts.exerciseNames)}%.**
  ${
    counts.exerciseNamesWithoutFinnish === 0
      ? `All ${counts.exerciseNames} names — the seeded library and everything the programmes prescribe — have a Finnish entry.`
      : `${counts.exerciseNamesWithoutFinnish} of ${counts.exerciseNames} have no Finnish and show their English name.`
  }
- **Exercise instructions — ${pct(counts.instructionStepsWithFinnish, counts.instructionSteps)}% of steps.**
  ${counts.exercisesWithFinnishInstructions} exercises are translated; the rest show the English steps
  from the source database. This is the largest remaining gap, and it is
  translation work, not export work.
- **Programme prose, titles, session names, progression rules, legal — complete.**
  Programme family names (STRONG, HUGE, RESET…) stay English on purpose; those
  rows read \`brand_name_stays_english\`.

## What this folder cannot contain

1. **The AI coach's live answers.** Produced per request against the reader's own
   log. They do not exist as text until someone asks, in either language.
2. **Anything the reader typed** — their programme names, their own exercises,
   names read out of a photographed programme.
3. **Strings composed at runtime.** "Day 2: Upper (Heavy)" is assembled from
   parts. The assembled forms the catalogs actually produce are in
   \`05-programme-and-session-names.csv\`; a name a reader invents is not.
`;

write('README.md', readme);

flush();

console.log('Wrote ' + pending.size + ' files to outputs/app-texts-fi-en/');
for (const [key, value] of Object.entries(counts)) console.log('  ' + key + ': ' + value);
