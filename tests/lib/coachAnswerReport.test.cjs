const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  COACH_REPORT_REASONS,
  MAX_REPORT_LINE_CHARS,
  MAX_REPORT_LIST_ITEMS,
  buildCoachReportBody,
  formatCoachReportForSlack,
  readCoachReport,
} = require('../../src/lib/coachAnswerReport');

// Play's AI-generated content policy: a reader can flag an answer without
// leaving the app (project-play-readiness). The answer and a reason travel;
// the question does not (user, 2026-09-28).

const ADVICE = {
  takeaway: 'Trap bar -maastaveto nousi 155 kg:aan.',
  why: ['155 kg x 6, 6, 6', 'edellinen 150 kg x 6, 6, 6'],
  nextSteps: ['Pidä paino ja tavoittele yhtä toistoa lisää.'],
  plan: [],
  assumptions: ['ei oletuksia'],
  topic: 'last_session',
  attention: 'Kolmas sarja putosi neljään.',
  example: 'Pidä 155 kg ja tavoittele 7/7/7.',
};

const read = (path) => fs.readFileSync(path, 'utf8');
const root = path.join(__dirname, '..', '..');

module.exports = [
  {
    name: 'a report carries the answer and the reason, and reads back the same on the server',
    run() {
      const body = buildCoachReportBody('offensive', ADVICE);
      assert.equal(body.mode, 'report');
      // Through JSON, as it travels.
      const report = readCoachReport(JSON.stringify(body));
      assert.deepEqual(report, {
        reason: 'offensive',
        answer: {
          takeaway: ADVICE.takeaway,
          why: ADVICE.why,
          nextSteps: ADVICE.nextSteps,
          attention: ADVICE.attention,
          example: ADVICE.example,
          plan: [],
        },
      });
      // Nothing the reader wrote: no question field exists to fill.
      assert.equal('question' in body.report, false);
      assert.equal('prompt' in body.report, false);
      assert.equal(JSON.stringify(body).includes('assumptions'), false);
      assert.deepEqual([...COACH_REPORT_REASONS], ['offensive', 'harmful', 'wrong', 'other']);
    },
  },
  {
    name: 'anything that is not a report is not read as one',
    run() {
      assert.equal(readCoachReport(null), null);
      assert.equal(readCoachReport('not json'), null);
      assert.equal(readCoachReport({ mode: 'forget', logId: 'x' }), null);
      assert.equal(readCoachReport({ prompt: 'hi', context: {} }), null);
      assert.equal(readCoachReport({ mode: 'report', report: { reason: 'spam', answer: { takeaway: 'x' } } }), null);
      assert.equal(readCoachReport({ mode: 'report', report: { reason: 'wrong', answer: { takeaway: '   ' } } }), null);
      assert.equal(readCoachReport({ mode: 'report', report: 'wrong' }), null);
    },
  },
  {
    name: 'a report is bounded: long lines cut, long lists trimmed, junk entries dropped',
    run() {
      const report = readCoachReport({
        mode: 'report',
        report: {
          reason: 'other',
          answer: {
            takeaway: 'x'.repeat(5000),
            why: [...Array(20)].map((_, index) => `line ${index}`),
            nextSteps: [42, null, '  ok  '],
            attention: 7,
          },
        },
      });
      assert.equal(report.answer.takeaway.length, MAX_REPORT_LINE_CHARS);
      assert.equal(report.answer.why.length, MAX_REPORT_LIST_ITEMS);
      assert.deepEqual(report.answer.nextSteps, ['ok']);
      assert.equal(report.answer.attention, null);
      assert.deepEqual(report.answer.plan, []);
    },
  },
  {
    name: 'the Slack note quotes the answer with nothing in it able to ping or link',
    run() {
      const text = formatCoachReportForSlack({
        reason: 'harmful',
        answer: {
          takeaway: 'Try <!channel> & <https://example.com|this>',
          why: ['a'],
          nextSteps: [],
          attention: null,
          example: 'b',
          plan: [],
        },
      });
      assert.match(text, /reason: \*harmful\*/);
      assert.match(text, /> Try &lt;!channel&gt; &amp; &lt;https:\/\/example\.com\|this&gt;/);
      assert.doesNotMatch(text, /<!channel>/);
      assert.match(text, /\*Why\*\n> a/);
      assert.match(text, /\*Example\*\n> b/);
      assert.doesNotMatch(text, /Next steps|Attention|Plan/);
    },
  },
  {
    name: 'the endpoint files a report before the version gate, rate-limited, and says ok only when Slack took it',
    run() {
      const source = read(path.join(root, 'api', 'ai-coach.ts'));
      const handler = source.slice(source.indexOf('export default async function handler('));
      const reportAt = handler.indexOf('const report = readCoachReport(req.body);');
      assert.ok(reportAt > handler.indexOf('if (!hasAppKey(req))'), 'a report still needs the app key');
      assert.ok(reportAt < handler.indexOf('isAppVersionRefused('), 'a report lands from any build');
      const block = handler.slice(reportAt, handler.indexOf('isAppVersionRefused('));
      // Its own count, apart from the questions' (review of this change).
      assert.match(block, /checkRateLimit\(`report:\$\{getIpAddress\(req\)\}`\)\.limited/);
      assert.match(block, /process\.env\.SLACK_WEBHOOK_BUGS/);
      assert.match(block, /if \(status !== null && status >= 200 && status < 300\) \{\s*res\.status\(200\)\.json\(\{ ok: true \}\);/);
      assert.match(block, /res\.status\(502\)\.json\(\{ ok: false, error: 'REPORT_FAILED' \}\)/);
      assert.match(source, /signal: AbortSignal\.timeout\(10000\)/);
    },
  },
  {
    name: 'the chat offers Report only under a model-written answer, and says Reported only after it landed',
    run() {
      const screen = read(path.join(root, 'src', 'screens', 'AICoachChatScreen.tsx'));
      assert.match(screen, /generated: result\.source !== 'preview',/);
      assert.match(screen, /\{message\.fromCoach && message\.advice && message\.generated \? \(\s*message\.reported \? \(/);
      // Marked reported inside the arrived branch, never before the await —
      // and on the message, so the mark survives the thread being resumed.
      assert.match(
        screen,
        /const arrived = await reportAiCoachAnswer\(reason, reported\.advice\);\s*if \(arrived\) \{[^}]*setMessages\(\(current\) =>\s*current\.map\(\(message\) => \(message\.id === reported\.id \? \{ \.\.\.message, reported: true \} : message\)\),/,
      );
      assert.doesNotMatch(screen, /reportedIds/);
      const sheet = read(path.join(root, 'src', 'components', 'CoachReportSheet.tsx'));
      // Reported (or failed) only once the send has settled.
      assert.match(sheet, /arrived = await onSend\(reason\);/);
      assert.match(sheet, /\} finally \{[^}]*?sendingRef\.current = false;\s*setSending\(false\);\s*\}\s*if \(!arrived\) \{\s*setFailed\(true\);/);
      const client = read(path.join(root, 'src', 'features', 'aiCoach', 'aiCoachClient.ts'));
      assert.match(client, /return response\.ok && payload\.ok === true;\s*\} catch \{\s*return false;/);
    },
  },
];
