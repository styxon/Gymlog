const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Every module in src/lib is imported by something that runs.
 *
 * `workoutIntelligence.ts` — a progression-suggestion engine, 121 lines — had
 * no importer anywhere: not the app, not the API, not a script, not a test.
 * It was the fourth batch of round 3 in miniature (three screens nothing could
 * open, 3 150 lines behind them), found the same way: by asking who reaches a
 * file rather than whether it reads well (2026-09-20).
 *
 * What counts as reaching: an import from src/ (any layer, lib included),
 * App.tsx, api/, scripts/ or modules/. A test alone does not — a module that
 * exists to pass its own test is the dead code the test keeps warm.
 *
 * PARKED is the list of modules kept on purpose with nothing wired to them
 * yet. Each entry names why; the guard fails if a parked module gains an
 * importer (take it off the list) or loses its file (same).
 */
const PARKED = new Map([]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...walk(next));
    } else if (/\.(ts|tsx|cjs|js|mjs)$/.test(entry.name)) {
      out.push(next);
    }
  }
  return out;
}

/** The lib modules a file imports, by the last path segment of the import. */
function libImportsOf(file, text) {
  const names = new Set();
  // import ... from '<spec>' | require('<spec>') | import('<spec>')
  for (const m of text.matchAll(/(?:from|require\(|import\()\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!/(^|\/)lib\/[^/]+$|^\.\/[^/]+$/.test(spec)) continue;
    // A relative sibling import counts only from inside src/lib itself.
    if (/^\.\/[^/]+$/.test(spec) && !file.startsWith('src/lib/')) continue;
    names.add(spec.split('/').pop().replace(/\.(js|ts)$/, ''));
  }
  // Scripts require a module by a joined path, with or without the suffix:
  // `require(path.join(DIST, 'aiCoachCostModel.js'))` or
  // `path.join(__dirname, '..', 'src', 'lib', 'legalDocuments')`. The file
  // name is still a string literal, and a script that names it reaches it.
  if (file.startsWith('scripts/')) {
    for (const m of text.matchAll(/['"]([A-Za-z0-9_]+)\.js['"]/g)) names.add(m[1]);
    for (const m of text.matchAll(/['"]lib['"],\s*['"]([A-Za-z0-9_]+)['"]/g)) names.add(m[1]);
  }
  return names;
}

/**
 * Lib modules reachable from something that runs, with the file that reaches
 * each one first.
 *
 * Rooted, and walked to a fixpoint: a root file (anything outside src/lib
 * that runs) reaches what it imports; a reached lib module reaches what IT
 * imports; repeat until nothing new. A flat "somebody imports it" would count
 * a lib module imported only by another dead lib module — two modules
 * importing each other and nothing else would both read as reached, which is
 * exactly the shape this guard is for (CI review of #158, the same lesson the
 * route guard learned in #150).
 */
function reachableLibModules() {
  const roots = [
    'App.tsx',
    ...walk('src').filter((file) => !file.startsWith('src/lib/')),
    ...(fs.existsSync(path.join(ROOT, 'api')) ? walk('api') : []),
    ...(fs.existsSync(path.join(ROOT, 'scripts')) ? walk('scripts') : []),
    ...(fs.existsSync(path.join(ROOT, 'modules')) ? walk('modules') : []),
  ];
  const importsOf = new Map();
  for (const file of [...roots, ...walk('src').filter((file) => file.startsWith('src/lib/'))]) {
    importsOf.set(file, libImportsOf(file, fs.readFileSync(path.join(ROOT, file), 'utf8')));
  }
  const reached = new Map();
  const add = (name, by) => {
    if (!reached.has(name)) reached.set(name, by);
  };
  for (const root of roots) {
    for (const name of importsOf.get(root)) add(name, root);
  }
  for (let pass = 0; pass < 200; pass += 1) {
    const before = reached.size;
    for (const name of [...reached.keys()]) {
      const file = `src/lib/${name}.ts`;
      for (const next of importsOf.get(file) ?? []) {
        if (next !== name) add(next, file);
      }
    }
    if (reached.size === before) break;
  }
  return reached;
}

module.exports = [
  {
    name: 'dead code: every src/lib module is imported by something that runs, or parked by name',
    run() {
      const modules = fs
        .readdirSync(path.join(ROOT, 'src', 'lib'))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => name.replace(/\.ts$/, ''));
      assert.ok(modules.length > 100, `only ${modules.length} modules found — the scan is looking in the wrong place`);
      const reached = reachableLibModules();

      const dead = modules.filter((name) => !reached.has(name) && !PARKED.has(name)).sort();
      assert.deepEqual(dead, [], `nothing that runs imports: ${dead.join(', ')} — delete the module, or park it here with a reason`);

      for (const [name, reason] of PARKED) {
        assert.ok(modules.includes(name), `${name} is parked (${reason}) but the file is gone — take it off the list`);
        const importer = reached.get(name) ?? null;
        assert.equal(importer, null, `${name} is parked (${reason}) but ${importer} imports it now — take it off the list`);
      }
    },
  },
];
