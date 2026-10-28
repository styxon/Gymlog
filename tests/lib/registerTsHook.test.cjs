const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * scripts/registerTs.cjs is what lets every other suite require src/*.ts
 * without a compile step. It is held to the behaviours the suites rely on.
 */
const HOOK = path.join(__dirname, '..', '..', 'scripts', 'registerTs.cjs');

function withTempDir(work) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinha-ts-hook-'));
  // react/jsx-runtime for the transpiled .tsx, from a stub next to the files.
  const runtime = path.join(dir, 'node_modules', 'react');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(
    path.join(runtime, 'jsx-runtime.js'),
    'exports.jsx = (type, props) => ({ type, props });' + String.fromCharCode(10) + 'exports.jsxs = exports.jsx;',
  );
  try {
    return work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = [
  {
    name: 'ts hook: installed once, and child processes inherit it through NODE_OPTIONS',
    run() {
      const hook = require(HOOK);
      assert.equal(typeof hook.install, 'function');
      assert.equal(typeof hook.warm, 'function');
      assert.equal(typeof hook.compile, 'function');
      hook.install();
      hook.install();
      const forward = HOOK.split(path.sep).join('/');
      const occurrences = process.env.NODE_OPTIONS.split(forward).length - 1;
      assert.equal(occurrences, 1, 'NODE_OPTIONS names the hook exactly once');
    },
  },
  {
    name: 'ts hook: a .ts and a .tsx file load, with types dropped and JSX transpiled',
    run() {
      withTempDir((dir) => {
        fs.writeFileSync(path.join(dir, 'plain.ts'), 'export const twice = (n: number): number => n * 2;\nexport type Unused = { a: string };\n');
        fs.writeFileSync(
          path.join(dir, 'view.tsx'),
          "import { twice } from './plain';\nexport const element = <b>{twice(4)}</b>;\nexport default 7;\n",
        );
        assert.equal(require(path.join(dir, 'plain')).twice(21), 42);
        // jsx: react-jsx imports react/jsx-runtime (the stub above).
        const view = require(path.join(dir, 'view'));
        assert.equal(view.default, 7);
        assert.equal(view.element.props.children, 8);
      });
    },
  },
  {
    name: 'ts hook: a request for x.js falls back to x.ts, and a missing file still says so',
    run() {
      withTempDir((dir) => {
        fs.writeFileSync(path.join(dir, 'lib.ts'), 'export const value: string = "from ts";\n');
        assert.equal(require(path.join(dir, 'lib.js')).value, 'from ts');
        assert.equal(require.resolve(path.join(dir, 'lib.js')), path.join(dir, 'lib.ts'));
        assert.throws(() => require(path.join(dir, 'absent.js')), (error) => error.code === 'MODULE_NOT_FOUND');
      });
    },
  },
  {
    name: 'ts hook: a syntax error throws instead of loading half a module',
    run() {
      withTempDir((dir) => {
        fs.writeFileSync(path.join(dir, 'broken.ts'), 'export const = ;\n');
        assert.throws(() => require(path.join(dir, 'broken')), SyntaxError);
      });
    },
  },
  {
    name: 'ts hook: an edited file is picked up after a cache eviction, never served from an old transpile',
    run() {
      withTempDir((dir) => {
        const file = path.join(dir, 'changing.ts');
        fs.writeFileSync(file, 'export const value = 1;\n');
        assert.equal(require(file).value, 1);
        fs.writeFileSync(file, 'export const value = 2222;\n');
        assert.equal(require(file).value, 1, 'a module in require.cache stays until evicted');
        delete require.cache[require.resolve(file)];
        assert.equal(require(file).value, 2222);
        // The same size, a different value, a later save: the key moves with the file's time.
        fs.writeFileSync(file, 'export const value = 3333;\n');
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(file, later, later);
        delete require.cache[require.resolve(file)];
        assert.equal(require(file).value, 3333);
      });
    },
  },
  {
    name: 'ts hook: any request that reaches into the old compiled test build throws at once',
    run() {
      const old = ['.test', 'dist'].join('-');
      assert.throws(() => require(`../../${old}/lib/format.js`), /compiled test build is gone/);
      assert.throws(() => require.resolve(path.join(__dirname, '..', '..', old, 'lib', 'format')), /compiled test build is gone/);
    },
  },
  {
    name: 'ts hook: default and namespace imports of CommonJS modules work (esModuleInterop)',
    run() {
      withTempDir((dir) => {
        fs.writeFileSync(
          path.join(dir, 'interop.ts'),
          "import path from 'node:path';\nimport * as fs from 'node:fs';\nexport const joined = path.join('a', 'b');\nexport const hasRead = typeof fs.readFileSync === 'function';\n",
        );
        const loaded = require(path.join(dir, 'interop'));
        assert.equal(loaded.joined, path.join('a', 'b'));
        assert.equal(loaded.hasRead, true);
      });
    },
  },
  {
    name: 'ts hook: a fresh node process started with the inherited environment loads src/ with no flags',
    run() {
      const result = spawnSync(
        process.execPath,
        ['-e', "console.log(typeof require('./src/lib/format').parseNumberInput)"],
        { cwd: path.join(__dirname, '..', '..'), env: process.env, encoding: 'utf8', timeout: 60_000 },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'function');
    },
  },
  {
    name: 'ts hook: warm() transpiles ahead of time, so a later load costs a lookup and not a transpile',
    run() {
      withTempDir((dir) => {
        const file = path.join(dir, 'warmed.ts');
        fs.writeFileSync(file, 'export const warmed: number = 5;\n');
        const hook = require(HOOK);
        hook.warm([file]);
        const before = hook.stats.transpiled;
        assert.equal(require(file).warmed, 5);
        assert.equal(hook.stats.transpiled, before);
      });
    },
  },
];
