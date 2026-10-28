/**
 * In-process TypeScript loader for the unit tests and the node scripts.
 *
 * Requiring this file makes `require('.../src/lib/x')` load src/lib/x.ts (or
 * .tsx) directly: each file is transpiled on first use with the installed
 * typescript package (ts.transpileModule, CommonJS, no type check). There is
 * no compile step and no build directory to go stale; types are checked by
 * `npm run typecheck`.
 *
 * - Only transpiled TEXT is cached (in memory, and on disk under
 *   node_modules/.cache/vinha-ts keyed on a hash of the content). The hook
 *   keeps no module cache of its own, so `delete require.cache[...]` works as
 *   usual.
 * - A request ending in .js that does not exist falls back to a sibling .ts or
 *   .tsx, so `require('../src/lib/format.js')` keeps working.
 * - A request that mentions the old compiled-test directory throws, so nothing
 *   can silently read a stale build again.
 * - Child processes inherit the hook through NODE_OPTIONS.
 *
 * VINHA_TS_NO_DISK_CACHE=1 turns the disk cache off.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const FLAG = Symbol.for('vinha.registerTs');
const FORWARD_FILE = __filename.split(String.fromCharCode(92)).join('/');
// The options the old compiled test build used (target ES2020).
const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  resolveJsonModule: true,
  isolatedModules: true,
  sourceMap: false,
  inlineSourceMap: false,
};
const OPTIONS_KEY = `${ts.version}|${JSON.stringify(COMPILER_OPTIONS)}`;
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
const OLD_BUILD_DIR = ['.test', 'dist'].join('-');
const CACHE_DIR = path.join(__dirname, '..', 'node_modules', '.cache', 'vinha-ts');
const USE_DISK = process.env.VINHA_TS_NO_DISK_CACHE !== '1';

const stats = { transpiled: 0, cacheHits: 0, diskHits: 0 };
const memory = new Map();

function transpile(filename, source) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: COMPILER_OPTIONS,
  });
  const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const text = ts.flattenDiagnosticMessageText(errors[0].messageText, '\n');
    const where =
      errors[0].file && errors[0].start !== undefined
        ? errors[0].file.getLineAndCharacterOfPosition(errors[0].start)
        : null;
    throw new SyntaxError(
      `${filename}${where ? `:${where.line + 1}:${where.character + 1}` : ''} ${text}`,
    );
  }
  return result.outputText;
}

function compile(filename) {
  const stat = fs.statSync(filename);
  const memoryKey = `${filename}|${stat.mtimeMs}|${stat.size}`;
  const hit = memory.get(memoryKey);
  if (hit !== undefined) {
    stats.cacheHits += 1;
    return hit;
  }
  const source = fs.readFileSync(filename, 'utf8');
  const hash = crypto.createHash('sha1').update(OPTIONS_KEY).update('\0').update(filename).update('\0').update(source).digest('hex');
  const diskFile = path.join(CACHE_DIR, `${hash}.js`);
  let js;
  if (USE_DISK) {
    try {
      js = fs.readFileSync(diskFile, 'utf8');
      stats.diskHits += 1;
    } catch {
      js = undefined;
    }
  }
  if (js === undefined) {
    js = transpile(filename, source);
    stats.transpiled += 1;
    if (USE_DISK) {
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const tmp = `${diskFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        fs.writeFileSync(tmp, js);
        fs.renameSync(tmp, diskFile);
      } catch {
        // A cache that cannot be written is only slower.
      }
    }
  }
  memory.set(memoryKey, js);
  return js;
}

/** Transpiles files into the in-memory cache without evaluating them. */
function warm(files) {
  for (const file of files) {
    compile(file);
  }
}

function install() {
  if (Module[FLAG]) {
    return;
  }
  Module[FLAG] = true;

  for (const ext of ['.ts', '.tsx']) {
    Module._extensions[ext] = function loadTs(module, filename) {
      // Packages in node_modules that ship .ts sources are not ours to
      // transpile: they load as plain JS, as before (and fail the same way).
      if (filename.includes(NODE_MODULES)) {
        return Module._extensions['.js'](module, filename);
      }
      return module._compile(compile(filename), filename);
    };
  }

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (typeof request === 'string') {
      if (request.includes(OLD_BUILD_DIR)) {
        throw new Error(`${request}: the compiled test build is gone; tests load src/ directly (scripts/registerTs.cjs)`);
      }
      if (/\.js$/.test(request) && (request.startsWith('.') || path.isAbsolute(request))) {
        try {
          return originalResolve.call(this, request, parent, isMain, options);
        } catch (error) {
          if (!error || error.code !== 'MODULE_NOT_FOUND') {
            throw error;
          }
          const stem = request.slice(0, -3);
          for (const ext of ['.ts', '.tsx']) {
            try {
              return originalResolve.call(this, stem + ext, parent, isMain, options);
            } catch (inner) {
              if (!inner || inner.code !== 'MODULE_NOT_FOUND') {
                throw inner;
              }
            }
          }
          throw error;
        }
      }
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };

  // Children started with the parent's env get the hook too.
  const flag = `--require "${FORWARD_FILE}"`;
  const current = process.env.NODE_OPTIONS || '';
  if (!current.includes(FORWARD_FILE)) {
    process.env.NODE_OPTIONS = `${current} ${flag}`.trim();
  }
}

install();

module.exports = { install, warm, stats, compile };
