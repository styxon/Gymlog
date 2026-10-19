#!/usr/bin/env node
/**
 * A stand-in for api/ai-coach.ts while the store screenshots are taken.
 *
 * The screenshots build has to show the coach online: a build with no server
 * address wears an OFFLINE badge, and the store page should not. The real
 * server costs money per call (Vercel bills by use, and every coach answer is
 * an Anthropic call), so the build is pointed at this instead, on the runner's
 * localhost, which the simulator shares.
 *
 * It answers in the server's own shape ({ ok, source: 'live', answer }), with
 * the app's own preview answer built from the context the app sent — the
 * reader's seeded numbers, in the reader's language. Everything else it is
 * asked (the server notice at /api/notice) gets an empty answer.
 *
 * Needs the compiled lib: `npx tsc -p tsconfig.test.json` first.
 *
 *   node scripts/store-screenshots/coach-stub.cjs [port]
 */
const http = require('node:http');
const path = require('node:path');

const { buildAiCoachPreviewAnswer } = require(path.join(__dirname, '..', '..', '.test-dist', 'lib', 'aiCoachPreview.js'));

const port = Number(process.argv[2] || 8787);
const MAX_BODY = 1024 * 1024;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const url = req.url || '';
    console.log(`${new Date().toISOString()} ${req.method} ${url} ${size} B`);
    if (req.method !== 'POST' || !url.startsWith('/api/ai-coach')) {
      send(res, 200, { ok: true, notice: null, paused: false });
      return;
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'Not JSON.' } });
      return;
    }
    if (typeof body.prompt !== 'string' || !body.context) {
      // A programme compose or an answer report: not part of the walk.
      send(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'Not a question.' } });
      return;
    }
    const language = body.language === 'fi' ? 'fi' : 'en';
    const answer = buildAiCoachPreviewAnswer(body.prompt, body.context, language);
    send(res, 200, { ok: true, source: 'live', answer });
  });
});

// Every interface, both stacks: the simulator's "localhost" may be ::1.
server.listen(port, () => {
  console.log(`coach stub on http://localhost:${port}/api/ai-coach`);
});
