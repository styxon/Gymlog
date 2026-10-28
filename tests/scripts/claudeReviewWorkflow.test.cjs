const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Guards for .github/workflows/claude-review.yml and the command it runs,
 * .claude/commands/ci-review.md.
 *
 * The workflow's whole job is that green means "this commit was reviewed".
 * It has failed that twice by passing while doing nothing: once when the
 * review ran in the background and was abandoned, and once — for 56 pushes
 * across 27 PRs — when the upstream plugin decided a PR needed no review,
 * most often because Claude had already commented on it. Neither failure
 * shows up anywhere but a green check, so only a test notices a change that
 * brings one back.
 *
 * Comments are stripped before anything is matched: the workflow explains
 * its history at length, and a guard that a comment can satisfy guards
 * nothing.
 */

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOW = '.github/workflows/claude-review.yml';
const COMMAND = '.claude/commands/ci-review.md';
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

const isComment = (line) => line.trim().startsWith('#');

// Just enough YAML for this one file: the job header, then one block per
// `      - ` step item. Every scalar the checks need sits at a fixed indent.
function parseWorkflow() {
  const lines = read(WORKFLOW).split('\n');
  const stepsAt = lines.findIndex((line) => line === '    steps:');
  assert.ok(stepsAt > 0, `${WORKFLOW} has no job steps where expected`);

  const job = lines.slice(0, stepsAt).filter((line) => !isComment(line));
  const steps = [];
  let current = null;
  for (const line of lines.slice(stepsAt + 1)) {
    if (line.startsWith('      - ')) {
      current = { lines: [] };
      steps.push(current);
      current.lines.push(`        ${line.slice(8)}`);
    } else if (current) {
      current.lines.push(line);
    }
  }

  return {
    job,
    steps: steps.map(({ lines: stepLines }) => {
      const code = stepLines.filter((line) => !isComment(line));
      const field = (key) => {
        const hit = code.find((line) => line.startsWith(`        ${key}: `));
        return hit === undefined ? undefined : hit.slice(`        ${key}: `.length).trim();
      };
      const runAt = code.findIndex((line) => line === '        run: |');
      let run;
      if (runAt >= 0) {
        const block = [];
        for (const line of code.slice(runAt + 1)) {
          if (line !== '' && !line.startsWith('          ')) break;
          block.push(line.slice(10));
        }
        run = block.join('\n').trim();
      }
      return {
        name: field('name'),
        id: field('id'),
        if: field('if'),
        uses: field('uses'),
        continueOnError: field('continue-on-error'),
        code: code.join('\n'),
        run,
      };
    }),
  };
}

function stepNamed(steps, name) {
  const index = steps.findIndex((step) => step.name === name);
  assert.ok(index >= 0, `${WORKFLOW} has no step named "${name}"`);
  return { index, step: steps[index] };
}

const PRIOR = "Find this commit's review";
const POSTED = "Confirm this commit's review was posted";
const RAN = 'Confirm a review actually ran';
const LIST = 'List the comments already on this PR';
const EXISTING = '.ci-review/inline-comments.jsonl';
const EXPLAIN = 'Say which kind of red this is';
const GATE = 'Confirm the review could read the PR';

function actionStep(steps) {
  const index = steps.findIndex((step) => (step.uses ?? '').startsWith('anthropics/claude-code-action@'));
  assert.ok(index >= 0, `${WORKFLOW} no longer runs anthropics/claude-code-action`);
  return { index, step: steps[index] };
}

// The marker as the command tells the reviewer to write it, split around the
// SHA placeholder.
function commandMarker() {
  const match = read(COMMAND).match(/<!-- claude-review head=<full sha> -->/);
  assert.ok(match, `${COMMAND} no longer tells the reviewer to end the summary with the commit marker`);
  return { before: '<!-- claude-review head=', after: ' -->' };
}

// Git for Windows' bash, not the WSL launcher that PowerShell finds first.
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  const candidate = path.join(execPath, '..', '..', '..', 'bin', 'bash.exe');
  assert.ok(
    fs.existsSync(candidate),
    `Git Bash not found at ${candidate}; these steps run in bash on the runner and are tested in bash here.`,
  );
  return candidate;
}

/**
 * Runs one step's script the way the runner does (`bash -e`), with `gh`
 * replaced by a function that answers from fixtures: `summaries` for the
 * issue-comment lookup, `findings` for the inline-comment one. The real gh is
 * never reached.
 */
function runStep(script, { summaries = '', findings = '', ghFails = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-review-step-'));
  try {
    const output = path.join(dir, 'github_output');
    fs.writeFileSync(output, '');
    fs.writeFileSync(path.join(dir, 'summaries'), summaries);
    fs.writeFileSync(path.join(dir, 'findings'), findings);
    const stub = [
      'gh() {',
      ghFails ? '  echo "HTTP 502" >&2; return 1' : '',
      '  case "$*" in',
      '    *"/issues/"*) cat "$FIXTURES/summaries" ;;',
      '    *"/pulls/"*) cat "$FIXTURES/findings" ;;',
      '    *) echo "unexpected gh call: $*" >&2; return 99 ;;',
      '  esac',
      '}',
    ].join('\n');
    const file = path.join(dir, 'step.sh');
    fs.writeFileSync(file, `${stub}\n${script}\n`);
    const result = spawnSync(findBash(), ['--noprofile', '--norc', '-e', file.replace(/\\/g, '/')], {
      encoding: 'utf8',
      // A step that writes a file writes it here, never into the repo.
      cwd: dir,
      env: {
        ...process.env,
        FIXTURES: dir.replace(/\\/g, '/'),
        GITHUB_OUTPUT: output.replace(/\\/g, '/'),
        REPO: 'lantu222/Gymlog',
        PR: '128',
        HEAD_SHA: 'fcfb466a0000000000000000000000000000beef',
        REVIEWER: 'claude[bot]',
      },
    });
    assert.equal(result.error, undefined, String(result.error));
    const listed = path.join(dir, EXISTING);
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: fs.readFileSync(output, 'utf8'),
      listed: fs.existsSync(listed) ? fs.readFileSync(listed, 'utf8') : null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SUMMARY_URL = 'https://github.com/lantu222/Gymlog/pull/128#issuecomment-1';

module.exports = [
  {
    name: 'claude-review: the review comes from the repo command, not the plugin that skips re-reviews',
    run() {
      const { steps } = parseWorkflow();
      const { step } = actionStep(steps);

      // The upstream plugin stops on any PR Claude has commented on, and
      // exits green. Installing it again brings the silent passes back.
      assert.ok(!step.code.includes('code-review@claude-code-plugins'), 'the upstream code-review plugin is installed again');
      assert.ok(!step.code.includes('/code-review:code-review'), 'the prompt runs the upstream plugin command again');

      const prompt = step.code.split('\n').find((line) => line.trim().startsWith('prompt:'));
      assert.ok(prompt, 'the action step has no prompt');
      assert.match(prompt, /prompt: "\/ci-review --comment /, 'the prompt must run /ci-review and post with --comment');
      assert.ok(
        prompt.includes('--head ${{ github.event.pull_request.head.sha }}'),
        'the prompt must name the head commit, or the summary cannot say which commit it covers',
      );
      assert.ok(
        // Absolute, because that is the only kind of path Read takes.
        prompt.includes(`--existing \${{ github.workspace }}/${EXISTING}`),
        'the prompt must hand over the listed comments, or the reviewer has no way to see them',
      );
      assert.ok(fs.existsSync(path.join(ROOT, COMMAND)), `${COMMAND} is missing; /ci-review would reach the model as plain text`);
    },
  },
  {
    name: 'claude-review: the command reviews every head commit and says so in a marker',
    run() {
      const command = read(COMMAND);
      // The two upstream eligibility rules that end a run without a word.
      // A re-sync from upstream brings these exact lines back.
      assert.ok(!/Claude has already commented on this PR/.test(command), 'the command skips PRs Claude has commented on again');
      assert.ok(!/does not need code review/.test(command), 'the command lets the model skip a PR it judges trivial again');
      assert.match(command, /Review it even if Claude has commented on this pull request before/);

      // The summary is posted whatever the outcome, and last.
      assert.match(command, /Post it in every case/);
      assert.match(command, /only once every inline comment from step 9 has been posted/);
      commandMarker();
      assert.match(command, /\$ARGUMENTS/, 'the command must read its arguments; the PR and commit come from them');

      // The command also appears as /ci-review in local sessions, where
      // allowed-tools skips the prompt. `gh api` covers DELETE and merge as
      // much as the one read step 7 needs.
      const allowed = command.match(/^allowed-tools: (.*)$/m);
      assert.ok(allowed, `${COMMAND} lost its allowed-tools line`);
      assert.ok(!allowed[1].includes('Bash(gh api'), 'allowed-tools pre-approves gh api, writes included, in local sessions');

      // In CI the earlier comments come as a file, because the allowlist has
      // no `gh api` in it; a command that still fetched them would be denied.
      const step7 = command.slice(command.indexOf('\n7. '), command.indexOf('\n8. '));
      assert.match(step7, /With `--existing <file>`, read that file with the Read tool/);
      assert.match(step7, /Do not fetch them any other way/);
      // The one denial nearly every run had was the Skill tool.
      assert.match(command, /Do not call the Skill tool/);
      // Refused calls are dead turns; the reviewer is told which ones.
      assert.match(command, /The runner is read-only\./, 'the command no longer tells the reviewer it cannot run code');
      assert.match(command, /never by running it/);
    },
  },
  {
    name: 'claude-review: both lookups match the marker the command writes, by the reviewer, for the head commit',
    run() {
      const { steps } = parseWorkflow();
      const { before, after } = commandMarker();
      const marker = `contains("${before}" + env.HEAD_SHA + "${after}")`;
      // The whole condition, so that dropping the author half is caught even
      // though the inline-comment filter below it names the reviewer too.
      const summaryFilter = `select(.user.login == env.REVIEWER and (.body | ${marker}))`;
      for (const name of [PRIOR, POSTED]) {
        const { step } = stepNamed(steps, name);
        assert.ok(step.run.includes(marker), `"${name}" does not look for the marker the command writes`);
        assert.ok(step.run.includes(summaryFilter), `"${name}" accepts the marker from anyone`);
        assert.match(step.code, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
        assert.match(step.code, /REVIEWER: claude\[bot\]/);
        assert.match(step.code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
      }
    },
  },
  {
    name: 'claude-review: steps run in an order where green can only follow a posted review',
    run() {
      const { steps } = parseWorkflow();
      const prior = stepNamed(steps, PRIOR);
      const list = stepNamed(steps, LIST);
      const action = actionStep(steps);
      const ran = stepNamed(steps, RAN);
      const posted = stepNamed(steps, POSTED);
      const explain = stepNamed(steps, EXPLAIN);

      assert.ok(prior.index < action.index, 'the lookup must come before the review it can skip');
      assert.ok(list.index < action.index, 'the earlier comments must be listed before the review reads them');
      assert.equal(list.step.if, "steps.prior.outputs.url == ''");
      assert.ok(action.index < ran.index && ran.index < posted.index, 'the checks must follow the review');
      assert.ok(posted.index < explain.index, 'the diagnostics come last');

      assert.equal(prior.step.id, 'prior');
      assert.equal(action.step.if, "steps.prior.outputs.url == ''");
      assert.equal(ran.step.if, "steps.prior.outputs.url == ''");

      // No `if` means it runs whenever everything before it passed, including
      // when the review was skipped because this commit already has one.
      // always() would run it after a failure too; continue-on-error would let
      // it fail without turning the check red.
      assert.equal(posted.step.if, undefined, `"${POSTED}" must not be conditional`);
      assert.equal(posted.step.continueOnError, undefined, `"${POSTED}" must be able to fail the job`);
      assert.match(posted.step.run, /\nexit 1$/, `"${POSTED}" must end by failing when nothing matched`);

      // Diagnostics explain; they never decide.
      assert.equal(explain.step.continueOnError, 'true');
    },
  },
  {
    name: 'claude-review: the job reads only, skips drafts, and keeps GH_TOKEN away from the reviewer',
    run() {
      const { job, steps } = parseWorkflow();
      const writes = job.filter((line) => /^\s+[\w-]+: write$/.test(line)).map((line) => line.trim());
      assert.deepEqual(writes, ['id-token: write'], 'the job token gained a write scope');

      assert.ok(job.includes('    if: ${{ !github.event.pull_request.draft }}'), 'drafts are reviewed again, or the skip moved');
      assert.ok(!job.some((line) => line.includes('GH_TOKEN')), 'GH_TOKEN at job level overrides the token the reviewer posts with');
      assert.ok(!actionStep(steps).step.code.includes('GH_TOKEN'), 'GH_TOKEN on the action overrides the token the reviewer posts with');
    },
  },
  {
    /*
     * The denial verdict has to live where it can fail.
     *
     * A review denied most of its calls does not error — it runs out of ways
     * to look and writes what it can. On #148 that was "No issues found" from
     * a run denied `gh pr diff` itself: posted, green, and about nothing.
     *
     * #149 put the arithmetic in the diagnostics step and made it `exit 1`.
     * That step is `continue-on-error` by design — "diagnostics must never be
     * the reason a check is red" — so the step went red and the job stayed
     * green, and #150 passed on a run denied 33 calls in 9 turns. A fatal
     * check inside a step that cannot fail is decoration.
     *
     * So the guard pins the property that was actually missing: the verdict
     * is its own step, and that step is not continue-on-error.
     */
    name: 'claude-review: the denial verdict lives in a step that can fail the check',
    run() {
      const { steps } = parseWorkflow();
      const { step: gate, index: gateAt } = stepNamed(steps, GATE);
      assert.notEqual(gate.continueOnError, 'true', `${GATE} cannot fail the check`);
      /*
       * And it weighs refused READS of the PR, not every denial. Counting
       * every denial went red on the first run that had read the diff and
       * found something: 37 denials in 15 turns, all `node`, `npm run
       * typecheck` and `Write` from validation agents trying to run the
       * code (2026-09-20). A red that lies is ignored as fast as a green one.
       */
      assert.match(gate.run, /refused \* 2/, 'the gate no longer weighs refused reads against turns');
      assert.doesNotMatch(gate.run, /denials \* 2/, 'the gate counts every denial again, which went red on a review that had read the diff');
      assert.ok(gate.run.includes('gh pr (diff|view)|git (diff|show|log)'), 'the gate no longer names the reads of the PR');
      assert.ok(gate.run.includes('.tool_name == "Read"'), 'a refused Read no longer counts as a refused read');
      // Counted, never printed: the one read of the input sits inside a
      // select that ends in a length, and nothing else touches it.
      assert.equal(gate.run.split('tool_input').length - 1, 1, 'the gate reads denied tool input somewhere other than the count');
      assert.match(gate.run, /select\([\s\S]*?tool_input[\s\S]*?\| length'/, 'the input must only be counted');

      // The classification, run rather than read: the FIRST part of the
      // command decides, split the same way the denial log splits.
      const refusedRead = (command) => {
        const first = command.split(/\s*(?:&&|\|\||\|&|;|\||&|\n)\s*/)[0] ?? '';
        return /^(gh pr (diff|view)|git (diff|show|log))(\s|$)/.test(first);
      };
      for (const [command, expected] of [
        // The three runs this gate exists for: the diff, refused over /tmp.
        ['gh pr diff 150 > /tmp/diff.txt', true],
        ['gh pr diff 150 | wc -l', true],
        ['gh pr view 150 --json files | python3 -c "1"', true],
        ['git diff main...HEAD -- src', true],
        ['git show abc123:src/x.ts', true],
        ['git log --oneline -5', true],
        // The run that must stay green: code the runner refuses to run.
        ['node -e "1"', false],
        ['npm run typecheck 2>&1 | tail -3', false],
        ['node tests/run-tests.cjs', false],
        ['python3 -c "1"', false],
        ['rm -rf .ci-review/x', false],
        // Refused over its first part, not over the read behind it.
        ['mkdir -p .ci-review && gh pr diff 150 > .ci-review/diff.txt', false],
        ['cat src/x.ts', false],
        ['git diffx', false],
        ['gh api repos/o/r/pulls/1', false],
      ]) {
        assert.equal(refusedRead(command), expected, `the gate would count ${command} wrongly`);
      }
      assert.match(gate.run, /::error::/);
      assert.match(gate.run, /exit 1/);
      assert.match(gate.if ?? '', /always\(\)/, 'the gate must run even when the review errored');

      // And the diagnostics step is back to explaining rather than deciding,
      // so the two cannot drift into contradicting each other.
      const { step: explain, index: explainAt } = stepNamed(steps, EXPLAIN);
      assert.equal(explain.continueOnError, 'true', 'diagnostics must not decide the check');
      assert.doesNotMatch(explain.run, /::error::/, 'diagnostics raise warnings, not errors');
      assert.doesNotMatch(explain.run, /Widen --allowedTools/, 'diagnostics prescribe a wider allowlist for denials the allowlist is right to make');
      assert.match(explain.run, /and still read the PR/, 'a healthy run with a long denial list gets no pointer to ci-review.md');
      assert.ok(gateAt < explainAt, 'the denial list is printed below the verdict that cites it');
    },
  },
  {
    name: 'claude-review: diagnostics read denials from the array the execution file actually has',
    run() {
      const { steps } = parseWorkflow();
      const { step } = stepNamed(steps, EXPLAIN);
      // The execution file holds the SDK's raw result: `permission_denials`,
      // an array. The count field only exists in the action's printed summary,
      // so reading it reported 0 denials on runs that had them.
      assert.ok(!step.run.includes('permission_denials_count'), 'diagnostics read a field the execution file does not have');
      assert.match(step.run, /\.permission_denials \/\/ \[\] \| length/);
      // Names only, and for Bash the program and its subcommands: the log is
      // public and a denied call's input is not. The one read of the input
      // goes through `name`, which keeps up to three plain lowercase words and
      // drops everything from the first thing that is not one.
      //
      // The word must END at a space or at the end of the command. Without
      // that lookahead `gh api repos/owner/repo/pulls/1` would print its
      // path's first segment, and the point of the filter is that no part of
      // a path, a URL, a quoted string or an `ENV=value` prefix can reach the
      // log. One word was not enough to act on: `gh pr diff` is allowed and
      // `gh api` is refused on purpose, and both printed as `Bash(gh)`.
      //
      // And every subcommand, because a Bash rule has to match each part of a
      // compound command on its own: naming the first part alone reported
      // seventeen denials of `gh pr diff`, which is ON the allowlist, while
      // the part that was actually refused went unnamed.
      const word =
        'def word: [match("^[a-z][a-z0-9._-]{0,30}(?=\\\\s|$)(?: [a-z][a-z0-9._-]{0,30}(?=\\\\s|$)){0,2}").string] | .[0] // "?";';
      const parts =
        'def name: [splits("\\\\s*(?:&&|\\\\|\\\\||\\\\|&|;|\\\\||&|\\\\n)\\\\s*")] | map(word) | .[0:4] | join(" + ");';
      assert.ok(step.run.includes(word), 'the Bash program is no longer read through its filter');
      assert.ok(step.run.includes(parts), 'the denial log no longer names every subcommand');
      assert.ok(step.run.includes('(.tool_input.command // "") | name'), 'the input reaches the log without the filter');
      // Twice: once through `name`, once through `shape`. Both filter before
      // anything is printed, and nothing else may touch the input.
      assert.equal(step.run.split('tool_input').length - 1, 2, 'denied tool input is read somewhere else too');

      // And the filter does what the comment says, run rather than read. Each
      // of these is a shape that has to lose everything but the program names
      // — and a compound one has to name the part that was refused.
      const label = (command) =>
        command
          .split(/\s*(?:&&|\|\||\|&|;|\||&|\n)\s*/)
          .map((part) => {
            const match = part.match(/^[a-z][a-z0-9._-]{0,30}(?=\s|$)(?: [a-z][a-z0-9._-]{0,30}(?=\s|$)){0,2}/);
            return match ? match[0] : '?';
          })
          .slice(0, 4)
          .join(' + ');
      for (const [command, expected] of [
        ["gh api repos/owner/repo/pulls/1/comments --jq '.[].body'", 'gh api'],
        ['gh pr diff 142 --name-only', 'gh pr diff'],
        ["git grep -n 'SECRET TOKEN abc' -- src", 'git grep'],
        ['grep -rn "private key here" src/', 'grep'],
        ['cat src/very/secret/path.ts', 'cat'],
        ['NODE_ENV=test npm run test:unit', '?'],
        ['/usr/bin/env node -e "1"', '?'],
        ['ls', 'ls'],
        // The case the one-word label hid: the allowed half is named first,
        // and the refused half is named at all.
        ["gh pr diff 143 | sed -n '1,200p'", 'gh pr diff + sed'],
        ['cd /home/runner/work && gh pr diff 143', 'cd + gh pr diff'],
        // A separator inside a quoted string can only mislabel, never leak.
        ['grep -rn "private key | here" src/', 'grep + ?'],
      ]) {
        assert.equal(label(command), expected, `the denial log would print ${command} wrongly`);
      }

      /*
       * And the SHAPE of a denied command, because the names were not enough.
       *
       * Three runs in a row were denied `gh pr diff` while `Bash(gh pr diff *)`
       * sat on the allowlist, and the log could not say why: it prints three
       * words, so `gh pr diff 150 > /tmp/x` reads exactly like the bare
       * command. Four hypotheses were tested against the docs and three were
       * wrong. So the log says what the command's shape is — a redirect, a
       * subshell, a backtick, an env prefix — and the next run settles it
       * instead of a fifth guess (2026-09-20).
       *
       * Markers only. No operand, no path, no content: the log is public.
       */
      assert.match(step.run, /def shape:/, 'the denial log no longer reports command shape');
      const shape = (command) => {
        const marks = [
          />/.test(command) ? 'redirect' : null,
          /[$][(]/.test(command) ? 'subshell' : null,
          /`/.test(command) ? 'backtick' : null,
          /^[A-Z_]+=/.test(command) ? 'env-prefix' : null,
        ].filter(Boolean);
        return marks.length ? ` [${marks.join(',')}]` : '';
      };
      for (const [command, expected] of [
        // The hypothesis this exists to test: an allowlisted command refused
        // over where it was pointing its output.
        ['gh pr diff 150 > /tmp/diff.txt', ' [redirect]'],
        ['gh pr diff 150 >> notes.txt', ' [redirect]'],
        ['echo "$(gh pr diff 150)" | head', ' [subshell]'],
        ['NODE_ENV=test npm run test:unit', ' [env-prefix]'],
        // A plain pipeline is not a shape: those are already named part by part.
        ['gh pr diff 150 | wc -l', ''],
        ['ls', ''],
      ]) {
        assert.equal(shape(command), expected, `the denial log would describe ${command} wrongly`);
      }
    },
  },
  {
    /**
     * With plain `Bash`, the reviewer held the Claude app's token and could
     * push, merge or call any API with it; only the instructions said not
     * to. The list below is the reviewed set. Adding a command to the
     * workflow means adding it here, on purpose.
     */
    name: 'claude-review: the reviewer can read the PR and post its summary, and nothing that writes',
    run() {
      const { step } = actionStep(parseWorkflow().steps);
      const line = step.code.split('\n').find((entry) => entry.includes('--allowedTools'));
      assert.ok(line, 'the action no longer passes an allowlist');
      const tools = line.match(/--allowedTools "([^"]*)"/)[1].split(',').map((tool) => tool.trim());

      assert.equal(tools[0], 'mcp__github_inline_comment__create_inline_comment', 'the comment tool must stay first');
      assert.ok(!tools.includes('Bash'), 'plain Bash is back: the reviewer can push and merge with the app token');
      const REVIEWED = new Set([
        'Bash(gh pr view *)',
        'Bash(gh pr diff *)',
        'Bash(gh pr comment *)',
        'Bash(gh pr list *)',
        'Bash(gh issue view *)',
        'Bash(gh issue list *)',
        'Bash(gh search *)',
        'Bash(git diff *)',
        // The checkout is shallow: without a fetch there is no base commit to
        // diff against, and #148's review was denied it.
        'Bash(git fetch *)',
        'Bash(git log *)',
        'Bash(git show *)',
        'Bash(git blame *)',
        'Bash(git ls-files *)',
        'Bash(git status *)',
        'Bash(git rev-parse *)',
        'Bash(cat *)',
        'Bash(head *)',
        'Bash(tail *)',
        'Bash(wc *)',
        'Bash(ls *)',
        'Bash(grep *)',
        // Present in almost every compound the reviewer writes, and one
        // denied part denies the whole command.
        'Bash(echo *)',
        // The same reason, from the front of the chain: the reviewer opens
        // with `mkdir -p .ci-review && gh pr diff …`, and a refused mkdir
        // took the diff read with it — six denials in seven turns and a
        // red gate on #161 (2026-09-20, #164). It makes a directory; it
        // runs nothing and writes no content.
        'Bash(mkdir *)',
      ]);
      // Denied in the same run and deliberately still absent: each hands
      // arbitrary execution to a run holding the app token.
      for (const tool of ['Bash(npx *)', 'Bash(node *)', 'Bash(rm *)', 'Bash(gh api *)']) {
        assert.ok(!tools.includes(tool), `${tool} lets the reviewer run whatever it likes with a token that can write`);
      }
      for (const tool of tools.filter((entry) => entry.startsWith('Bash'))) {
        assert.ok(REVIEWED.has(tool), `${tool} is not on the reviewed list of commands the reviewer may run`);
      }
      for (const tool of ['Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Skill']) {
        assert.ok(!tools.includes(tool), `${tool} lets the reviewer do more than read and comment`);
      }
      /*
       * One scratch directory, and only that one.
       *
       * A reviewer handed a 3 400-line diff reaches for a file to put it in,
       * and every attempt was refused — `Write`, `mkdir`, and `gh pr diff`
       * itself whenever it redirected. An output redirect is checked against
       * the Edit rules, so with no Edit rule at all there was nowhere on the
       * runner it could write.
       *
       * `.ci-review/` is the workflow's own scratch directory, already used
       * for the inline-comment listing. Anchored with a leading slash, so it
       * is that directory in the workspace and nothing else: a bare `Edit`,
       * or one reaching outside, would hand a run holding the app token the
       * ability to rewrite the checkout it is reviewing.
       */
      const edits = tools.filter((tool) => tool.startsWith('Edit'));
      assert.deepEqual(edits, ['Edit(/.ci-review/**)'], 'the reviewer may write in one scratch directory, nowhere else');
      // What a review cannot work without. `git fetch` and `echo` are here
      // because #148's reviewer was denied both and returned "No issues
      // found" about a diff it had never read: the checkout is shallow, so
      // without a fetch there is no base commit to compare against, and one
      // denied part of a compound denies the whole command.
      for (const tool of [
        'Read',
        'Grep',
        'Glob',
        'Task',
        'Agent',
        'Bash(gh pr view *)',
        'Bash(gh pr diff *)',
        'Bash(gh pr comment *)',
        'Bash(git fetch *)',
        'Bash(echo *)',
      ]) {
        assert.ok(tools.includes(tool), `${tool} is missing, and the review cannot run without it`);
      }
    },
  },
  {
    name: 'claude-review: the earlier comments are listed with the read-only token, into the file the prompt names',
    run() {
      const { step } = stepNamed(parseWorkflow().steps, LIST);
      assert.match(step.code, /GH_TOKEN: \$\{\{ github\.token \}\}/);
      assert.ok(step.run.includes(`> ${EXISTING}`), 'the listing is not written where the prompt says it is');

      const listed = runStep(step.run, { findings: '{"path":"a.ts","line":3,"author":"claude[bot]","body":"x"}\n' });
      assert.equal(listed.status, 0, listed.stderr);
      assert.equal(listed.listed, '{"path":"a.ts","line":3,"author":"claude[bot]","body":"x"}\n');
      assert.match(listed.stdout, /1 inline comments already on the PR/);

      const none = runStep(step.run, {});
      assert.equal(none.status, 0, none.stderr);
      assert.equal(none.listed, '');
      assert.match(none.stdout, /0 inline comments already on the PR/);

      // No listing, no review: the reviewer would post every finding again.
      const apiDown = runStep(step.run, { ghFails: true });
      assert.notEqual(apiDown.status, 0);
    },
  },
  {
    name: 'claude-review: the posted-review check passes only on a summary for this commit',
    run() {
      const { step } = stepNamed(parseWorkflow().steps, POSTED);

      const reviewed = runStep(step.run, { summaries: `${SUMMARY_URL}\n` });
      assert.equal(reviewed.status, 0, reviewed.stderr);
      assert.match(reviewed.stdout, /was reviewed: https:\/\/github\.com\/lantu222\/Gymlog\/pull\/128#issuecomment-1/);

      const cutOff = runStep(step.run, { findings: '11\n12\n' });
      assert.equal(cutOff.status, 1);
      assert.match(cutOff.stdout, /::error::The review posted 2 inline comments on fcfb466a/);

      const nothing = runStep(step.run, {});
      assert.equal(nothing.status, 1);
      assert.match(nothing.stdout, /::error::Nothing was posted for fcfb466a/);

      const apiDown = runStep(step.run, { ghFails: true });
      assert.notEqual(apiDown.status, 0);
    },
  },
  {
    name: 'claude-review: the lookup skips a reviewed commit and fails rather than guess when GitHub errors',
    run() {
      const { step } = stepNamed(parseWorkflow().steps, PRIOR);

      const found = runStep(step.run, { summaries: `${SUMMARY_URL}\n${SUMMARY_URL}-later\n` });
      assert.equal(found.status, 0, found.stderr);
      assert.equal(found.output, `url=${SUMMARY_URL}\n`, 'one URL, the first, or the output line breaks');

      const none = runStep(step.run, {});
      assert.equal(none.status, 0, none.stderr);
      assert.equal(none.output, 'url=\n');

      // An error read as "no review yet" would only cost a review. An error
      // read as "reviewed" would be the silent green again, so the step fails.
      const apiDown = runStep(step.run, { ghFails: true });
      assert.notEqual(apiDown.status, 0);
      assert.equal(apiDown.output, '');
    },
  },
  {
    /**
     * The diagnostics step printed the run's own error text raw. A result of
     * "::error::..." (or `::stop-commands::`) starts a line, and the runner
     * reads any such line as a workflow command: the text is the model's and
     * the provider's, so it is not ours to let steer the job. Every line is
     * prefixed. The jq is stubbed (it is the runner's), the rest of the
     * pipeline is run for real in bash.
     */
    name: 'claude-review: the diagnostics step cannot print a workflow command from the run’s own words',
    run() {
      const { step } = stepNamed(parseWorkflow().steps, EXPLAIN);
      assert.equal(step.continueOnError, 'true', 'diagnostics must stay continue-on-error');
      const printing = step.run.split('\n').find((line) => line.includes('| tr -d'));
      assert.ok(printing, 'the error text no longer goes through a prefixing filter');
      assert.ok(printing.includes("sed 's/^/  | /'"), 'the lines are no longer prefixed');
      // The jq that produces the text is inside the same braces as the fallback,
      // so a jq failure still prints "(could not read it)" through the filter.
      assert.ok(printing.trimStart().startsWith('{ jq '), 'the fallback is no longer inside the filtered group');

      const lines = [
        '::error::injected failure',
        '::stop-commands::token',
        'plain line',
        'two\r::warning::after a bare CR',
        '::add-mask::value',
      ];
      const fake = `jq() { printf '%s\\n' ${lines.map((line) => `$'${line.replace(/\r/g, '\\r')}'`).join(' ')}; }`;
      const script = `${fake}\nEXECUTION_FILE=/dev/null\n${printing}\n`;
      const result = spawnSync(findBash(), ['--noprofile', '--norc', '-e', '-c', script], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const printed = result.stdout.split(/\r?\n|\r/).filter(Boolean);
      assert.ok(printed.length >= lines.length, result.stdout);
      for (const line of printed) {
        assert.ok(line.startsWith('  | '), `a line is printed unprefixed: ${line}`);
        assert.ok(!line.startsWith('::'), `a line is a workflow command: ${line}`);
      }
      // And a failing jq still says so, through the same filter.
      const failing = spawnSync(
        findBash(),
        ['--noprofile', '--norc', '-e', '-c', `jq() { return 3; }\nEXECUTION_FILE=/dev/null\n${printing}\n`],
        { encoding: 'utf8' },
      );
      assert.equal(failing.status, 0, failing.stderr);
      assert.equal(failing.stdout.trimEnd(), '  | (could not read it)');
    },
  },
  {
    // 1-2 Oct 2026: nine reds in a row on turn 1 that were an invalid OAuth
    // token ("401 OAuth access token is invalid"), which the warning called a
    // usage limit or an incident.
    name: 'claude-review: a one-turn error is not blamed on a usage limit alone',
    run() {
      const { step } = stepNamed(parseWorkflow().steps, EXPLAIN);
      const warning = step.run.split('\n').find((line) => line.includes('first turn'));
      assert.ok(warning, 'the one-turn warning is gone');
      assert.match(warning, /Read the error text above/);
      assert.match(warning, /401 OAuth access token is invalid/);
      assert.match(warning, /usage limit/);
      assert.match(warning, /provider incident/);
      assert.doesNotMatch(warning, /That is a usage limit OR a provider incident/);
    },
  },
];
