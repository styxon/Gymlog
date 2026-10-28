const assert = require('node:assert/strict');
const path = require('node:path');

const { requireWithStubs } = require('../../helpers/hookHarness.cjs');

/**
 * The phone's side of "Delete cloud backup" and "Delete account": what it
 * sends, and how a refusal reaches the hook as a code. The hook signs an Apple
 * session out on SESSION_REVOKED / SESSION_EXPIRED only, so the client has to
 * hand the server's code through and nothing else.
 */

const API = path.join(__dirname, '..', '..', '..', 'src', 'features', 'account', 'backupApi.js');

async function withApi(answer, scenario) {
  const savedFetch = global.fetch;
  const savedUrl = process.env.EXPO_PUBLIC_BACKUP_API_URL;
  process.env.EXPO_PUBLIC_BACKUP_API_URL = 'https://backup.example/api/backup';
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    if (answer instanceof Error) {
      throw answer;
    }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => {
        if (answer.notJson) {
          throw new SyntaxError('Unexpected token < in JSON');
        }
        return answer.body;
      },
    };
  };
  try {
    const api = requireWithStubs(API, {
      '../appUpdate/appUpdateSignal': { appVersionHeaders: () => ({}), noteServerAnswer: () => undefined },
    });
    await scenario(api, requests);
  } finally {
    global.fetch = savedFetch;
    if (savedUrl === undefined) {
      delete process.env.EXPO_PUBLIC_BACKUP_API_URL;
    } else {
      process.env.EXPO_PUBLIC_BACKUP_API_URL = savedUrl;
    }
  }
}

module.exports = [
  {
    name: 'backup client: a refused session reaches the caller as the server’s own code',
    async run() {
      for (const code of ['SESSION_REVOKED', 'SESSION_EXPIRED', 'INVALID_TOKEN']) {
        await withApi({ status: 401, body: { ok: false, error: code } }, async (api) => {
          assert.deepEqual(await api.deleteBackup('vs1.x.y'), { ok: false, error: code, definite: true });
          assert.deepEqual(await api.deleteBackup('vs1.x.y', { account: true }), { ok: false, error: code, definite: true });
        });
      }
    },
  },
  {
    name: 'backup client: only a 401 carries a code — a store that could not answer, a failed delete and an offline phone do not',
    async run() {
      // A 502 with an error code is the store failing, not a session ending: no code, so no sign-out.
      for (const status of [500, 502, 503]) {
        await withApi({ status, body: { ok: false, error: 'STORE_UNAVAILABLE' } }, async (api) => {
          assert.deepEqual(await api.deleteBackup('vs1.x.y'), { ok: false, mayHaveReached: true }, 'a 5xx may have been carried out');
        });
      }
      await withApi({ status: 200, body: { ok: false } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y'), { ok: false, definite: true }, 'a 2xx that is not the server’s yes counted');
      });
      await withApi({ status: 401, body: null }, async (api) => {
        // Not the server's own JSON: a gateway or a captive portal. Nothing is settled.
        assert.deepEqual(await api.deleteBackup('vs1.x.y'), { ok: false }, 'a 401 with no body settled the delete');
      });
      await withApi(new Error('offline'), async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y'), { ok: false });
      });
      await withApi({ status: 200, body: { ok: true } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y'), { ok: true, definite: true });
      });
      // 4xx settles the request; a 5xx or no answer at all leaves it open whether the delete went through
      // ("Delete account" keeps its pending record on those, and clears it on the others).
      await withApi({ status: 400, body: { ok: false, error: 'BAD_VERSION' } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y'), { ok: false, definite: true });
      });
    },
  },
  {
    // Hunt round, 2026-10-03: any status under 500 settled the request, so a
    // 429 (answered before auth, before anything was read) or a captive
    // portal's page cleared the pending record of a delete that may have gone through.
    name: 'backup client: only the server\'s own JSON settles a delete — never a 429 or a page that is not its answer',
    async run() {
      await withApi({ status: 429, body: { ok: false, error: 'RATE_LIMITED' } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('tok', { account: true }), { ok: false }, 'a 429 settled the delete');
      });
      await withApi({ status: 429, body: { ok: false } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('tok', { account: true }), { ok: false });
      });
      // A captive portal or gateway: HTML, or JSON that is not the server's shape.
      await withApi({ status: 403, notJson: true }, async (api) => {
        assert.deepEqual(await api.deleteBackup('tok', { account: true }), { ok: false });
      });
      await withApi({ status: 200, body: { message: 'Please sign in to the Wi-Fi' } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('tok', { account: true }), { ok: false });
      });
      await withApi({ status: 404, body: {} }, async (api) => {
        assert.deepEqual(await api.deleteBackup('tok', { account: true }), { ok: false });
      });
      // The server's own refusals still settle it.
      await withApi({ status: 400, body: { ok: false, error: 'BAD_REQUEST' } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('tok', { account: true }), { ok: false, definite: true });
      });
      await withApi({ status: 403, body: { error: 'FORBIDDEN' } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('tok', { account: true }), { ok: false, definite: true });
      });
    },
  },
  {
    name: 'backup client: Delete account sends its request id, and a revoked session hands the marker\'s id back',
    async run() {
      const id = '0123456789abcdef0123456789abcdef';
      await withApi({ status: 200, body: { ok: true } }, async (api, requests) => {
        await api.deleteBackup('tok', { account: true, requestId: id });
        await api.deleteBackup('tok', { requestId: id });
        await api.deleteBackup('tok', { account: true });
        assert.equal(requests[0].init.headers['x-delete-request-id'], id);
        assert.equal(requests[1].init.headers['x-delete-request-id'], undefined, 'a plain delete carried an account delete\'s id');
        assert.equal(requests[2].init.headers['x-delete-request-id'], undefined);
      });
      await withApi({ status: 401, body: { ok: false, error: 'SESSION_REVOKED', deleteRequestId: id } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y', { account: true, requestId: id }), {
          ok: false,
          error: 'SESSION_REVOKED',
          definite: true,
          deleteRequestId: id,
        });
      });
      // An id that is not a string is not an id.
      await withApi({ status: 401, body: { ok: false, error: 'SESSION_REVOKED', deleteRequestId: 7 } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y', { account: true }), { ok: false, error: 'SESSION_REVOKED', definite: true });
      });
    },
  },
  {
    name: 'backup client: Delete account sends the account action, Delete cloud backup does not',
    async run() {
      await withApi({ status: 200, body: { ok: true } }, async (api, requests) => {
        await api.deleteBackup('tok');
        await api.deleteBackup('tok', { account: true });
        assert.equal(requests[0].init.method, 'DELETE');
        assert.equal(requests[0].init.headers['x-backup-action'], undefined, 'a plain delete asked for the account to go');
        assert.equal(requests[1].init.headers['x-backup-action'], 'delete-account');
        assert.equal(requests[1].init.headers.authorization, 'Bearer tok');
      });
    },
  },
  {
    name: 'backup client: Apple\'s one-time code goes with Delete account only',
    async run() {
      await withApi({ status: 200, body: { ok: true } }, async (api, requests) => {
        await api.deleteBackup('vs1.x.y', { account: true, requestId: 'a'.repeat(32), appleAuthorizationCode: 'code-1' });
        await api.deleteBackup('vs1.x.y', { appleAuthorizationCode: 'code-1' });
        await api.deleteBackup('vs1.x.y', { account: true });
        const sent = requests.map((request) => request.init.headers['x-apple-authorization-code']);
        assert.deepEqual(sent, ['code-1', undefined, undefined], 'the code went with something other than Delete account');
        assert.equal(requests[0].init.headers['x-backup-action'], 'delete-account');
      });
    },
  },
  {
    name: 'backup client: the server’s appleRevoked reaches the caller only as a boolean, and only on a yes',
    async run() {
      for (const appleRevoked of [true, false]) {
        await withApi({ status: 200, body: { ok: true, appleRevoked } }, async (api) => {
          assert.deepEqual(await api.deleteBackup('vs1.x.y', { account: true }), { ok: true, definite: true, appleRevoked });
        });
      }
      await withApi({ status: 200, body: { ok: true, appleRevoked: 'no' } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y', { account: true }), { ok: true, definite: true });
      });
      await withApi({ status: 502, body: { ok: false, appleRevoked: false } }, async (api) => {
        assert.deepEqual(await api.deleteBackup('vs1.x.y', { account: true }), { ok: false, mayHaveReached: true });
      });
    },
  },
];
