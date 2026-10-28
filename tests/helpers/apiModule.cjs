const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Loads an api/*.ts endpoint under Node, so a test can run it rather than
 * read it (server audit, 2026-09-21).
 *
 * api/ is outside the test build, so the file is transpiled here. Its imports
 * of src/ are served through the TypeScript hook — the same code the other
 * suites run — and the packages named in `stubs` (the blob store) are
 * replaced by the test's fakes. Every call loads a fresh copy, so the
 * endpoint's per-instance state (rate limit, budget window) starts empty.
 */
function loadApiModule(relativeFile, stubs = {}) {
  const file = path.join(ROOT, relativeFile);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) {
      return stubs[id];
    }
    if (id.startsWith('../src/')) {
      return require(path.join(ROOT, 'src', id.slice('../src/'.length)));
    }
    return require(id);
  };
  loaded._compile(outputText, file);
  return loaded.exports;
}

/** A request the handler can take, and the response it wrote. */
async function callHandler(handler, request) {
  const result = { status: 200, body: null, headers: {} };
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(value) {
      result.body = value;
    },
    setHeader(name, value) {
      result.headers[name.toLowerCase()] = value;
    },
    end(text) {
      result.body = text ? JSON.parse(text) : null;
    },
  };
  await handler({ socket: { remoteAddress: '10.0.0.1' }, ...request }, res);
  return result;
}

/** Sets environment variables for the length of `work`, and puts them back. */
async function withEnv(values, work) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

module.exports = { callHandler, loadApiModule, withEnv };
