#!/usr/bin/env node
/**
 * What running the AI Coach would actually cost.
 *
 *   node scripts/simulate-coach-cost.cjs
 *
 * Every token count below is measured, not assumed: the script builds real
 * training histories, runs them through the same buildAiCoachSystemContext the
 * endpoint sends, and prices the result. The only guesses are behavioural —
 * how often a Pro user opens the sheet — and those are stated as ranges.
 */

require('./registerTs.cjs');
const path = require('node:path');
const fs = require('node:fs');

const DIST = path.join(__dirname, '..', 'src', 'lib');

const { buildEvalContext } = require(path.join(DIST, 'aiCoachEvalCases.js'));
const { buildAiCoachSystemContext } = require(path.join(DIST, 'aiCoachSystemContext.js'));
const { estimateTokens, DEFAULT_BUDGET_LIMITS } = require(path.join(DIST, 'aiCoachBudget.js'));
const {
  HAIKU_4_5_PRICING,
  SONNET_5_PRICING,
  TOKENIZER_FACTOR_VS_HAIKU_4_5,
  conversationCost,
  cacheBreakEvenQuestions,
  monthlyCost,
  grossMarginShare,
} = require(path.join(DIST, 'aiCoachCostModel.js'));

/**
 * Which model to price. Defaults to what production runs, not what the code
 * falls back to — the deployed AI_COACH_CLAUDE_MODEL has been Sonnet 5 since
 * 2026-08-23, and a simulation of the unused default answers no question.
 *
 *   node scripts/simulate-coach-cost.cjs                    # sonnet-5
 *   node scripts/simulate-coach-cost.cjs --model haiku-4-5
 */
const MODEL_KEY = (() => {
  const i = process.argv.indexOf('--model');
  const value = i === -1 ? 'sonnet-5' : process.argv[i + 1];
  if (value !== 'sonnet-5' && value !== 'haiku-4-5') {
    console.error(`Unknown --model ${value}. Use sonnet-5 or haiku-4-5.`);
    process.exit(1);
  }
  return value;
})();
const PRICING = MODEL_KEY === 'sonnet-5' ? SONNET_5_PRICING : HAIKU_4_5_PRICING;
/**
 * estimateTokens is calibrated on the pre-4.7 tokenizer. Claude 4.7 and later
 * split the same text into roughly 30% more tokens, so every measured count
 * has to be scaled before it is priced or the bill comes out low.
 */
const TOKENIZER = TOKENIZER_FACTOR_VS_HAIKU_4_5[MODEL_KEY];
const modelTokens = (tokens) => Math.round(tokens * TOKENIZER);

const DAY_MS = 86400000;
const NOW = Date.parse('2026-07-28T09:00:00.000Z');
const at = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toISOString();

const LIFTS = [
  'Barbell Back Squat', 'Barbell Bench Press', 'Barbell Deadlift', 'Barbell Overhead Press',
  'Lat Pulldown', 'Seated Cable Row', 'Dumbbell Incline Press', 'Leg Press',
  'Romanian Deadlift', 'Dumbbell Lateral Raise', 'Barbell Curl', 'Triceps Pushdown',
  'Face Pull', 'Hip Thrust', 'Bulgarian Split Squat', 'Cable Fly',
];

function buildHistory(weeks, perWeek, liftsPerSession) {
  const sessions = [];
  const logs = [];
  let index = 0;

  for (let week = weeks - 1; week >= 0; week -= 1) {
    for (let day = 0; day < perWeek; day += 1) {
      const id = `s${index}`;
      const daysAgo = week * 7 + (perWeek - 1 - day) * Math.floor(7 / perWeek);
      sessions.push({
        id,
        workoutTemplateId: 'tpl',
        workoutNameSnapshot: `Day ${(day % 4) + 1}: Upper`,
        performedAt: at(daysAgo),
        durationMinutes: 52,
        setsCompleted: liftsPerSession * 3,
        totalVolumeKg: 6200 + index * 40,
      });

      for (let slot = 0; slot < liftsPerSession; slot += 1) {
        logs.push({
          id: `${id}-${slot}`,
          sessionId: id,
          exerciseTemplateId: null,
          exerciseNameSnapshot: LIFTS[(day * liftsPerSession + slot) % LIFTS.length],
          weight: 60 + ((index + slot) % 8) * 2.5,
          repsPerSet: [8, 8, 7],
          tracked: true,
          orderIndex: slot,
        });
      }

      index += 1;
    }
  }

  return { sessions, logs };
}

/**
 * The two constants that ride along with every request. Measured from source
 * rather than retyped, so a rules edit shows up in the cost.
 */
function readEndpointConstants() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'ai-coach.ts'), 'utf8');
  const rules = source.match(/const COACH_SYSTEM_RULES = \[([\s\S]*?)\]\.join\('\\n'\);/);
  const schema = source.match(/const AI_COACH_RESPONSE_SCHEMA = \{([\s\S]*?)\n\} as const;/);
  return {
    rulesChars: rules ? rules[1].length : 0,
    schemaChars: schema ? schema[1].length : 0,
  };
}

const PROFILES = [
  { label: 'brand new (no history)', weeks: 0, perWeek: 0, lifts: 0 },
  { label: 'first month (3x/wk, 5 lifts)', weeks: 4, perWeek: 3, lifts: 5 },
  { label: 'full window (8 wk, 4x/wk, 6 lifts)', weeks: 8, perWeek: 4, lifts: 6 },
  { label: 'heavy logger (8 wk, 6x/wk, 9 lifts)', weeks: 8, perWeek: 6, lifts: 9 },
];

// Behavioural assumptions — the only guesses in this script.
const ENGAGEMENT = [
  { label: 'light', conversationsPerMonth: 4, questionsPerConversation: 1 },
  { label: 'typical', conversationsPerMonth: 12, questionsPerConversation: 2 },
  { label: 'power user', conversationsPerMonth: 40, questionsPerConversation: 3 },
  { label: 'abusive (at the rate limit, every day)', conversationsPerMonth: 30, questionsPerConversation: 12 },
];

const PROMPT_TOKENS = modelTokens(estimateTokens('x'.repeat(160))); // a real typed question
const OUTPUT_TOKENS = modelTokens(350); // schema-shaped answer; max_tokens caps it at 700
const usd = (value) => `$${value.toFixed(4)}`;

const constants = readEndpointConstants();
const overheadTokens = modelTokens(estimateTokens('x'.repeat(constants.rulesChars + constants.schemaChars)));

console.log('AI Coach cost simulation');
console.log('='.repeat(78));
console.log(`Model: claude-${MODEL_KEY}   in $${PRICING.inputPerMTok}/MTok   out $${PRICING.outputPerMTok}/MTok`);
console.log(`Tokenizer: ${TOKENIZER}x Haiku 4.5 token counts for the same text`);
console.log(`Fixed overhead per call: rules + tool schema = ~${overheadTokens} tokens`);
console.log(`Output assumed ${OUTPUT_TOKENS} tokens (endpoint caps at ${DEFAULT_BUDGET_LIMITS.maxOutputTokens})`);
console.log('');

console.log('MEASURED CONTEXT SIZE');
console.log('-'.repeat(78));
const measured = PROFILES.map((profile) => {
  const { sessions, logs } = profile.weeks
    ? buildHistory(profile.weeks, profile.perWeek, profile.lifts)
    : { sessions: [], logs: [] };
  const text = buildAiCoachSystemContext(buildEvalContext(sessions, logs, ['mon', 'tue', 'thu', 'sat']));
  const contextTokens = estimateTokens(text);
  const headroom = ((text.length / DEFAULT_BUDGET_LIMITS.maxContextChars) * 100).toFixed(0);

  console.log(
    `${profile.label.padEnd(38)} ${String(text.length).padStart(6)} chars  ` +
      `~${String(contextTokens).padStart(5)} tok  (${headroom}% of the ${DEFAULT_BUDGET_LIMITS.maxContextChars}-char cap)`,
  );

  return { ...profile, contextTokens, prefixTokens: modelTokens(contextTokens) + overheadTokens };
});

console.log('');
console.log('COST PER CONVERSATION (heaviest context, cached vs not)');
console.log('-'.repeat(78));
const heaviest = measured[measured.length - 1];
for (const engagement of ENGAGEMENT) {
  const cost = conversationCost(
    {
      label: engagement.label,
      prefixTokens: heaviest.prefixTokens,
      promptTokens: PROMPT_TOKENS,
      outputTokens: OUTPUT_TOKENS,
      questionsPerConversation: engagement.questionsPerConversation,
      conversationsPerMonth: engagement.conversationsPerMonth,
    },
    PRICING,
  );
  const verdict = cost.cachedUsd <= cost.uncachedUsd ? 'cache wins' : 'cache COSTS more';
  console.log(
    `${String(engagement.questionsPerConversation).padStart(2)} question(s)   ` +
      `cached ${usd(cost.cachedUsd)}   uncached ${usd(cost.uncachedUsd)}   ${verdict}`,
  );
}
console.log(`\nBreak-even: caching pays from ${cacheBreakEvenQuestions(PRICING)} questions per 5-minute window.`);

console.log('');
console.log('COST PER PRO USER PER MONTH');
console.log('-'.repeat(78));
console.log('context profile'.padEnd(38) + ENGAGEMENT.map((e) => e.label.slice(0, 11).padStart(13)).join(''));
for (const profile of measured) {
  const cells = ENGAGEMENT.map((engagement) => {
    const monthly = monthlyCost(
      {
        label: engagement.label,
        prefixTokens: profile.prefixTokens,
        promptTokens: PROMPT_TOKENS,
        outputTokens: OUTPUT_TOKENS,
        questionsPerConversation: engagement.questionsPerConversation,
        conversationsPerMonth: engagement.conversationsPerMonth,
      },
      PRICING,
    );
    return usd(monthly.perUserUsd).padStart(13);
  });
  console.log(profile.label.padEnd(38) + cells.join(''));
}

console.log('');
console.log('FLEET COST PER MONTH (full-window context, typical engagement)');
console.log('-'.repeat(78));
const fleetProfile = measured[2];
const fleetMonthly = monthlyCost(
  {
    label: 'typical',
    prefixTokens: fleetProfile.prefixTokens,
    promptTokens: PROMPT_TOKENS,
    outputTokens: OUTPUT_TOKENS,
    questionsPerConversation: 2,
    conversationsPerMonth: 12,
  },
  PRICING,
);
for (const users of [100, 1000, 10000, 100000]) {
  console.log(`${String(users).padStart(7)} Pro users   ${usd(fleetMonthly.fleetUsd(users)).padStart(12)} / month`);
}

console.log('');
console.log('WORST CASE — every Pro user behaves like the abusive column');
console.log('-'.repeat(78));
const worst = monthlyCost(
  {
    label: 'abusive',
    prefixTokens: heaviest.prefixTokens,
    promptTokens: PROMPT_TOKENS,
    outputTokens: DEFAULT_BUDGET_LIMITS.maxOutputTokens,
    questionsPerConversation: 12,
    conversationsPerMonth: 30,
  },
  PRICING,
);
console.log(`per user  ${usd(worst.perUserUsd)} / month`);
for (const price of [4.99, 7.99, 9.99]) {
  const share = grossMarginShare(worst.perUserUsd, price);
  console.log(`  at $${price.toFixed(2)}/month subscription → model cost is ${(share * 100).toFixed(2)}% of revenue`);
}
