#!/usr/bin/env node
/**
 * Dead-UI detector.
 *
 *   node scripts/find-dead-ui.cjs
 *
 * Written after the effort prompt shipped dead for months: EFFORT_OPTIONS and
 * handleRecordEffort were declared and never rendered, WorkoutSetRow took an
 * `effort` prop it never drew, and the Premium screen sold two features that
 * chain depended on. Reading the code forward from a handler proves nothing —
 * the question is always whether anything CALLS it.
 *
 * So this looks for the shapes that bug takes:
 *
 *   handler   a `function handleX` / `const handleX =` that nothing references
 *   const     a module-level UI constant (SCREAMING_CASE) never referenced
 *   style     a StyleSheet key never referenced as styles.<key>
 *   i18n      an i18n key defined in EN and referenced nowhere in src/
 *
 * The i18n check is the sharpest of the four: a copy string with no render
 * site is a promise the app cannot make, and that is exactly what a paywall
 * audit is looking for. (A destructured-prop check was tried and dropped —
 * inline SVG helpers drown it in noise.)
 *
 * Heuristic on purpose: it reports candidates, a human decides. Exit code is
 * always 0 — this is a report, not a gate.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC).concat([path.join(ROOT, 'App.tsx')]);
const sources = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

/** Occurrences of `name` as a whole word, ignoring the declaration line. */
function countRefs(text, name, declLine) {
  const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  let count = 0;
  text.split('\n').forEach((line, index) => {
    if (index === declLine) {
      return;
    }
    const matches = line.match(pattern);
    if (matches) {
      count += matches.length;
    }
  });
  return count;
}

const findings = { handler: [], const: [], style: [], i18n: [] };

for (const [file, text] of sources) {
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    // handlers: function handleX(  |  const handleX = (
    const handler = line.match(/^\s*(?:async\s+)?function\s+(handle[A-Z]\w*)\s*\(/)
      ?? line.match(/^\s*const\s+(handle[A-Z]\w*)\s*=\s*(?:async\s*)?\(/);
    if (handler && countRefs(text, handler[1], index) === 0) {
      findings.handler.push({ file, line: index + 1, name: handler[1] });
    }

    // module-level UI constants
    const constant = line.match(/^const\s+([A-Z][A-Z0-9_]{3,})\s*[:=]/);
    if (constant && countRefs(text, constant[1], index) === 0) {
      findings.const.push({ file, line: index + 1, name: constant[1] });
    }
  });

  // StyleSheet keys
  const styleBlock = text.match(/StyleSheet\.create\(\{([\s\S]*)\n\}\);?\s*$/);
  if (styleBlock) {
    const keyPattern = /^ {2}([a-zA-Z][\w]*):\s*\{/gm;
    let match;
    while ((match = keyPattern.exec(styleBlock[1])) !== null) {
      const key = match[1];
      if (!new RegExp(`styles\\.${key}\\b`).test(text)) {
        findings.style.push({ file, name: key });
      }
    }
  }
}

// i18n keys defined but referenced nowhere.
const i18nPath = path.join(SRC, 'lib', 'i18n.ts');
const i18nText = fs.readFileSync(i18nPath, 'utf8');
const enBlock = i18nText.slice(i18nText.indexOf('const EN = {'), i18nText.indexOf('\n} as const;'));
const enKeys = [...enBlock.matchAll(/^\s{2}'([^']+)':/gm)].map((match) => match[1]);
// i18n.ts reads keys too — bodyPartLabel's table, storedValueLabel's
// 'onb.equip.' prefix — so its code counts as a reader; only the two
// dictionaries (the definitions themselves) are left out. Skipping the whole
// file reported 59 live keys as dead (i18n sweep, 2026-10-07).
const fiStart = i18nText.indexOf('const FI: Record<I18nKey, string> = {');
const i18nCode = [
  i18nText.slice(0, i18nText.indexOf('const EN = {')),
  i18nText.slice(i18nText.indexOf('\n} as const;'), fiStart),
  fiStart >= 0 ? i18nText.slice(i18nText.indexOf('\n};', fiStart)) : '',
].join('\n');
const otherText = [...sources.entries()]
  .filter(([file]) => file !== i18nPath)
  .map(([, text]) => text)
  .concat(i18nCode)
  .join('\n');

// A prefix handed over as a plain string ('onb.equip.') and joined to a value
// later, where no template shows it. Like the template-prefix rule below, it
// answers for the whole family: a dead key under a live prefix is not seen.
// Two segments at least ('onb.equip.', not 'home.'): a one-word literal is
// as often a route or a log tag, and it would answer for a whole family.
const literalPrefixes = [...otherText.matchAll(/['"`]([A-Za-z]\w*(?:\.\w+)+\.)['"`]/g)].map((match) => match[1]);

// A template with the variable anywhere in the key, not only at the end:
// `catalog.collection.${key}.label`, `prog.custom.${shape.slug}.title`. Only
// templates whose fixed text reads like a key — `${a}${b}` would match all.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keyTemplates = [...otherText.matchAll(/`([^`\n]*\$\{[^`\n]*)`/g)]
  .map((match) => match[1].split(/\$\{[^}]*\}/))
  // The key-like text has to come first: `${x}.title` alone would read as
  // every key that ends in .title.
  .filter((parts) => /^[A-Za-z]\w*\./.test(parts[0]))
  .map((parts) => new RegExp(`^${parts.map(escapeRegExp).join('.+?')}$`));

for (const key of enKeys) {
  // Some keys are built dynamically (`logger.effort.${effort}`); treat a hit on
  // the prefix before the last dot as a reference.
  const prefix = key.slice(0, key.lastIndexOf('.') + 1);
  if (otherText.includes(`'${key}'`) || otherText.includes(`"${key}"`)) {
    continue;
  }
  if (prefix && otherText.includes('`' + prefix)) {
    continue;
  }
  if (literalPrefixes.some((literal) => key.startsWith(literal) && key.length > literal.length)) {
    continue;
  }
  if (keyTemplates.some((pattern) => pattern.test(key))) {
    continue;
  }
  findings.i18n.push({ file: i18nPath, name: key });
}

const LABELS = {
  handler: 'Handlers declared and never referenced',
  const: 'Module constants declared and never referenced',
  style: 'StyleSheet keys never referenced',
  i18n: 'i18n keys defined and never rendered',
};

let total = 0;
for (const [kind, label] of Object.entries(LABELS)) {
  const list = findings[kind];
  total += list.length;
  console.log(`\n${label} — ${list.length}`);
  console.log('-'.repeat(72));
  if (list.length === 0) {
    console.log('  (none)');
    continue;
  }
  for (const item of list) {
    const where = item.line ? `${rel(item.file)}:${item.line}` : rel(item.file);
    console.log(`  ${item.name.padEnd(38)} ${where}`);
  }
}

console.log(`\n${total} candidate(s). Each one is a question, not a verdict:`);
console.log('is this UI a user can reach, or a promise with nothing behind it?');
