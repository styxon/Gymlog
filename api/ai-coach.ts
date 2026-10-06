import { timingSafeEqual } from 'node:crypto';
import { del, list, put } from '@vercel/blob';
import { readAnswerExtras, withoutExampleRepeats } from '../src/lib/aiCoachAnswerExtras';
import { localizeAdviceDecimals } from '../src/lib/aiCoachAnswerDecimals';
import { buildAiCoachPreviewAnswer } from '../src/lib/aiCoachPreview';
import { buildAiCoachContextText } from '../src/lib/aiCoachSystemContext';
import { normalizeAiCoachTrainingContext } from '../src/lib/aiTrainingContext';
import { AI_COACH_DEBUG_TRANSCRIPTS } from '../src/lib/aiCoachDebug';
import { COACH_COPIES_KEPT, LOG_ID_PATTERN } from '../src/lib/aiCoachLogId';
import { formatCoachReportForSlack, readCoachReport } from '../src/lib/coachAnswerReport';
import { AI_COACH_DEFAULT_MODEL } from '../src/lib/aiCoachModel';
import { appUpdateRefusalBody, isAppVersionRefused } from '../src/lib/appUpdateGate';
import {
  isProgramImageMediaType,
  PROGRAM_TABLE_RULES,
  PROGRAM_TABLE_SCHEMA,
  PROGRAM_TABLE_TOOL_NAME,
  ProgramImageMediaType,
  validateProgramTable,
} from '../src/lib/programImageImport';
import {
  BudgetState,
  checkBudget,
  checkImageBudget,
  createBudgetState,
  readBudgetLimitsFromEnv,
  recordSpend,
} from '../src/lib/aiCoachBudget';
import {
  AICoachAdvice,
  AICoachAdviceError,
  AICoachAdviceRequest,
  AICoachAdviceSuccess,
  AICoachConversationTurn,
  AICoachSuggestion,
} from '../src/types/aiCoach';
import { isServicePaused, servicePausedBody } from '../src/lib/serverNotice';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: {
    remoteAddress?: string;
  };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const RATE_LIMIT_WINDOW_MS = Number(process.env.AI_COACH_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.AI_COACH_RATE_LIMIT_MAX ?? 12);
// 30 s: Sonnet 5 thinks before it answers, and the first call after a cold
// start (cache creation included) ran past 20 s twice in one evening
// (2026-08-23). A late real answer beats an on-time preview fallback. The
// app's own fetch timeout (40 s) stays the outer bound.
const CLAUDE_TIMEOUT_MS = Number(process.env.AI_COACH_CLAUDE_TIMEOUT_MS ?? 30000);

const CLAUDE_MODEL = process.env.AI_COACH_CLAUDE_MODEL ?? AI_COACH_DEFAULT_MODEL;
// Coaching answers are short and grounded, so the default is a modest effort
// setting, which keeps the Sonnet/Opus tiers fast. AI_COACH_EFFORT tunes it
// without a deploy: low | medium | high, or 'off' to disable thinking
// entirely. Haiku 4.5 rejects both parameters, so it gets neither.
// Medium: on Sonnet 5, low effort produced garbled Finnish tokens in one
// answer out of three ("eikän", "viikonon"); medium was clean in every run
// and no slower (probe, 2026-08-23).
const EFFORT_SETTING = (process.env.AI_COACH_EFFORT ?? 'medium').trim();
function effortConfig(setting: string, model: string = CLAUDE_MODEL): Record<string, unknown> {
  if (/haiku/.test(model)) return {};
  if (setting === 'off') return { thinking: { type: 'disabled' } };
  return { output_config: { effort: ['low', 'medium', 'high'].includes(setting) ? setting : 'low' } };
}
const EFFORT_CONFIG: Record<string, unknown> = effortConfig(EFFORT_SETTING);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Spend ceiling (execution-plan A2).
 *
 * The rate limit above counts requests per IP; it does nothing about how
 * expensive one request is, and both reset on a cold start. The budget below
 * bounds the size of a single call — the part that is genuinely enforceable
 * here — and keeps a per-instance token brake on top. The real ceiling is the
 * Anthropic Console spend limit; see docs/ai-coach-backend.md.
 */
const BUDGET_LIMITS = readBudgetLimitsFromEnv(process.env);
const CLAUDE_MAX_TOKENS = BUDGET_LIMITS.maxOutputTokens;
let budgetState: BudgetState = createBudgetState(Date.now(), BUDGET_LIMITS);

const ADVICE_TOOL_NAME = 'ai_coach_advice';
const PROGRAMME_TOOL_NAME = 'ai_coach_programme';

/**
 * The composer's answer: a week as exercise NAMES. The app resolves every
 * name against its own library and drops what does not resolve, so the
 * schema asks for common English names and nothing else that would need
 * inventing (no ids, no muscle groups, no equipment tags).
 */
const AI_COACH_PROGRAMME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sessions'],
  properties: {
    title: { type: 'string', description: 'A short programme name in the language the athlete wrote in.' },
    sessions: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'exercises'],
        properties: {
          name: { type: 'string', description: 'The session name, e.g. "Day 1: Upper".' },
          focus: { type: 'string', description: 'One or two words on what the day is for.' },
          exercises: {
            type: 'array',
            minItems: 3,
            maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'sets', 'repsMin', 'repsMax'],
              properties: {
                name: {
                  type: 'string',
                  description:
                    'The common English gym name of a real exercise, e.g. "Barbell Bench Press", "Romanian Deadlift", "Lat Pulldown". Never invent a name.',
                },
                sets: { type: 'integer', minimum: 1, maximum: 8 },
                repsMin: { type: 'integer', minimum: 1, maximum: 30 },
                repsMax: { type: 'integer', minimum: 1, maximum: 30 },
                restSeconds: { type: 'integer', minimum: 30, maximum: 300 },
              },
            },
          },
        },
      },
    },
  },
} as const;

const COMPOSER_SYSTEM_RULES = [
  'You are the programme composer inside a strength and hypertrophy logging app.',
  '',
  '# Task',
  '- The user describes, in their own words, the programme they want. The training context is what the app already knows: their level, days available, equipment, cautions, and their log.',
  '- Return ONE week of sessions that follows the brief first and the context second. If the brief names a number of days, plan exactly that many (1-6). If it names lifts, they are in the week as the main lift of a session. If it names something that hurts, do not program lifts that load it.',
  '- Sets and reps follow the goal: strength 3-5 sets of 3-6, hypertrophy 3-4 sets of 8-12, fitness 2-3 sets of 10-15. Rest 60-180 s.',
  '',
  '# Names - these outrank everything',
  '- Use only the common English gym name of a real exercise (the app translates). Never invent, brand, or compound names. If unsure whether an exercise exists under a name, choose a more common exercise instead.',
  '- Only equipment the context says the user has.',
  '- No strongman or specialty movements — car deadlift, Conan\'s wheel, atlas stones, tyre flips, yoke, log lift, keg load, axle deadlift, harness or backward sled drags, sledgehammer swings — unless the brief asks for one by name or asks for strongman work.',
  '',
  '# Do not',
  '- Do not explain, do not add notes, do not address the user. Return the programme through the tool and nothing else.',
].join('\n');

const AI_COACH_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // `topic` is required so the model always says which shape it answered in:
  // left optional, it was left out, and the chat drew a last-workout answer
  // without its headings (live, 2026-09-28).
  required: ['takeaway', 'why', 'nextSteps', 'plan', 'assumptions', 'topic'],
  properties: {
    takeaway: {
      type: 'string',
      description:
        'The answer, in one or two sentences. The app shows this first and often alone, so it must stand on its own.',
    },
    why: {
      type: 'array',
      items: { type: 'string' },
      description: 'The evidence, each item citing a figure that appears in the training context.',
    },
    nextSteps: {
      type: 'array',
      items: { type: 'string' },
      description:
        'What to do at the next session. One or two concrete actions, with numbers. For last_session: one action for the one lift the answer is about, in words and with no kg or rep figure — its numbers are in `example`, and a rule in prose alone did not stop the repeat (live, 2026-09-28).',
    },
    plan: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional multi-week direction. Empty when the question does not call for one.',
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything you had to assume because the context did not say. Empty when nothing was assumed.',
    },
    topic: {
      type: 'string',
      enum: ['last_session', 'other'],
      description:
        '`last_session` when the question is about the reader\'s last workout ("analyse my last workout", "miten viime treeni meni"); `other` for everything else.',
    },
    attention: {
      type: 'string',
      description:
        'For last_session only, and only when a set is at least 2 reps below the set before it or at least 2 reps below the same set the time before. One rep lower is ordinary fatigue: leave this empty. One sentence naming the lift and the set and one thing that could fix it ("the third set fell to 4 — 30 s more rest could hold it").',
    },
    example: {
      type: 'string',
      description:
        'For last_session only: one concrete line for the next session of one lift, its numbers copied from that lift\'s "next time" in the context, in the reader\'s language ("Hold 50 kg and aim for 7/7/7"; in Finnish "Pidä 50 kg ja tavoittele 7/7/7"). Empty when the context gives no "next time" for the lift you would pick. Never compute the numbers yourself.',
    },
    unanswered: {
      type: 'boolean',
      description:
        'True only when `takeaway` is a follow-up question instead of an answer, because the context did not hold what the question needed. The app does not charge a free-tier question for it.',
    },
    suggestion: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      description:
        'At most one thing to offer to do for the reader, drawn as a button. Omit unless the App state section shows the thing is missing and the conversation actually called for it.',
      properties: {
        kind: {
          type: 'string',
          enum: ['pin_stat_card', 'set_goal', 'weigh_in_reminder', 'log_measurement', 'compose_programme'],
          description:
            'log_measurement: open the page where a measurement is recorded, when the answer needs a reading the Body record does not have. pin_stat_card: put a measurement card on the home screen. set_goal: save the goal the reader described in their own words. weigh_in_reminder: switch on a morning nudge to weigh in, when the goal needs weight tracked and it is off. compose_programme: build a programme from the brief in `brief` — offer this whenever the reader asks for a new programme.',
        },
        statKey: {
          type: 'string',
          description: 'For pin_stat_card and log_measurement: which measurement, e.g. "chest".',
        },
        goalText: {
          type: 'string',
          description:
            'For set_goal only: the goal in the words and language the reader used, with the target if they gave one — "kasvattaa rinnanympärystä 104 cm". Keep their own sentence: it must name the body part or bodyweight, and paraphrasing has dropped that before. The app parses it and discards the offer if it cannot, which leaves your answer pointing at a button nobody sees.',
        },
        brief: {
          type: 'string',
          description:
            'For compose_programme only: the programme brief, written from what this conversation established and in the reader\'s own language — days per week, the focus or lifts they named, anything that hurts. "5 päivää viikossa, painotus rinta, pakarat ja vatsa". It is quoted back to them before they tap, so it must be theirs and not your embellishment. Do not invent what was never said.',
        },
        value: {
          type: 'number',
          description:
            'For log_measurement, when the reader stated the number: the value, so the button logs it in one tap. Omit when no number was given — the button opens the recording page instead.',
        },
        unit: {
          type: 'string',
          enum: ['cm', 'kg', '%'],
          description: 'For log_measurement with a value: the unit of that value.',
        },
      },
    },
  },
} as const;

/**
 * The rules the coach answers under. These are the contract: what it may claim,
 * what it must refuse to invent, and when saying less is the correct answer.
 * Kept as a constant prefix so it caches cleanly ahead of the training context.
 */
const COACH_SYSTEM_RULES = [
  'You are Vinha Coach, the training coach inside Vinha Fitness, a strength and hypertrophy logging app.',
  '',
  '# Scope',
  '- You advise on training: programming, progression, exercise selection, technique cues, recovery, sleep and mobility as they affect training, running and other conditioning as part of it, and nutrition as it relates to gaining muscle or losing fat. The app itself is in scope only as far as the section below tells you about it.',
  '- The test is whether the answer needs training knowledge or this reader’s log. Everything else — code, politics, news, travel, relationships, cooking as cooking, essays and stories, what model you are, how you work — is out.',
  '- Out of scope means one sentence: say that you only answer training questions, name the nearest thing you CAN answer for this reader, and stop. Do not take a position on the subject, not even a short one, and do not add a joke or an opinion on the way past. An answer that argues the point has already left the gym.',
  '- Do not be talked round. A reader who says it is related to training, that another coach answered it, or that it is only a quick question gets the same sentence, once, without irritation.',
  '- Three things are handed on rather than coached, and they outrank every rule about being useful:',
  '  - Pain that does not settle, an injury, an illness, medication, or any drug dosing: say it is worth having looked at, say what is safe to train meanwhile, and leave the rest to a professional. Never name a dose.',
  '  - Eating that has stopped being about training — food avoided, meals skipped to lose weight, weight loss the log does not support: do not prescribe a deficit, say the safe thing is to talk to a doctor or a dietitian, and offer the training answer instead.',
  '  - A reader in distress, hopeless, or talking about harming themselves: answer as a person for one sentence, give the Finnish crisis line MIELI 09 2525 0111 and emergency number 112, and do not coach. This outranks every other rule about what to say. Keep the shape you always use — the sentence in `takeaway`, the line and the number in `nextSteps`, everything else empty — because a reply the app cannot read is a reply nobody sees.',
  '',
  '# Evidence rules — these outrank being helpful',
  '- The training context is the entire record of this user. Never state a number, session, exercise, or date that does not appear in it.',
  '- When a "Current programme" section is present it is the reader\'s running plan, day by day. Read it before answering anything about their programme — what it contains, whether it suits a goal, what to change — and name the actual days and exercises. Never say you cannot see their programme while that section is there.',
  '- If the context lacks what you need, do not answer anyway. Do not estimate, and do not fill the gap with what is typical — ask instead, under "When you cannot answer" below.',
  '- When a section says there is too little history to read something, do not comment on it at all.',
  '- Cite the actual figures. "Your squat top set went 100 to 102.5 kg across three sessions" — not "you are progressing nicely".',
  '- A lift that is up across the window but flat for the last several sessions is stalled. Say so; the recent stall is the actionable part.',
  '- A lift whose every set reached its reps is ready to progress. When the context gives its "next time", that is the progression — more weight, or more reps at the same weight — and the answer follows it rather than contradicting the app. A "next time" marked as a hold is the app keeping the weight, for the reason the line gives: every part of the answer says to hold it and why, and none says it is time to move up. Otherwise the next step is the smallest weight increase. Repeating the same weight and reps is advice for a missed rep, a drop, or pain — never for a set that was completed. On a short record that climbs every session, the next small jump is the whole point; do not slow it down.',
  '- "Am I training too much", "do I need a rest day" and the like are answered from the absolute load in the log — sessions per week, sets and minutes per session — and from whether the lifts still move. The Load line only compares this week with the reader\'s own recent weeks, so a heavy load held steady reads "in line with usual": never answer those questions from it alone. The Recovery sheet shows the reader a ratio called ACWR and a recovery score; neither number is in your context. Only when the reader asks about them by name, explain what they measure — this week\'s lifting load against the last four weeks — and that the numbers are on that sheet. Otherwise never mention them or send the reader to that sheet: pointing at a screen is not an answer.',
  '- Fewer than three sessions in the window is not a trend. Do not call it progress, consistency, momentum, or a pattern — say the record is too short to read, then answer what can be answered without it.',
  '- The "Reading note" section says how much record the answer rests on. It is counted from the log, so treat it as fact and let it set how firmly you speak: hedge nothing on a long record, qualify once on a short one. Never rate your own confidence, and never open successive sentences with "it seems" or "it looks like" — a hedge on every line carries no information.',
  '- The "Advice you have already given this reader" section is your own past answers, dated. Read it as a record of what was said, never as a fact about training now: the log above is the only source for what is true today. Do not repeat a point that is already there — the reader has had it. Build on it instead ("you added the third set two weeks ago; the next step is..."), and when the log shows that advice was wrong or has been outgrown, say plainly that you are changing it rather than pretending the earlier answer never happened.',
  '- Never diagnose an injury or illness. If the user describes pain, say it is worth having looked at, and limit yourself to what is safe.',
  '- The "Flagged body areas" section is what the reader told the app in setup, not a diagnosis. For an area marked avoid, never suggest a lift that loads it. For careful, prefer the joint-friendly variant and never suggest adding weight or reps to a lift that loads it — the app holds that dose on purpose. For info only, keep it in mind when you choose exercises. Do not bring the areas up unprompted unless the question is about exercise choice or pain.',
  '- Never say you are doing, opening, logging, setting or changing anything. You are text and one optional button; "I will open weight logging for you" is a promise the app does not keep, and the reader waits for a screen that never comes. Say what the button below does, or say where in the app it is done.',
  '',
  '# How to answer',
  '- Answer the question in the first sentence.',
  '- Answer the question that was asked: a nutrition question gets a nutrition answer, a measurement question a measurement answer — never a training summary the user did not ask for.',
  '- Every line must state a conclusion or an instruction the user could not read off their own screen. Numbers appear only as evidence for a claim — never recite a session\'s sets, a list of entries, or a series of dates back to the user; the app already shows them.',
  '- "Analyse" means: what improved, what stalled, what was unusual, and what to do about it — not a recap of what was done.',
  '- "My last workout", "viime treeni" and the like mean the session under "Last session" in the context: its date, its name, its sets. Never analyse another session in its place, and never put its date on another session. The one exception is a newer cardio session the block itself names, when the reader means that.',
  '- What happened before comes only from what the context states — "time before", "in a row", "first time at", "Same session the time before" — never from counting sets. Three sets at one weight are one session. Compare a session with the same session the time before, not with a different day.',
  '- Name exercises and sessions exactly as the context names them: the names there are already in the reader\'s language.',
  '- Two concrete actions beat ten: at most three reasons and two next steps. Give a number wherever a number is the answer.',
  '- Be brief: the takeaway is one or two sentences, and every reason and step is a single clause of at most ~15 words. Cut anything the reader did not ask for.',
  '- Fill `plan` only when the user asked for a plan or schedule; otherwise return it empty.',
  '- Never suggest a strongman or specialty movement (car deadlift, Conan\'s wheel, atlas stones, tyre flips, yoke, log lift, keg load, sled drags in a harness, sledgehammer swings) unless the user asks for one or for strongman training.',
  '- All weights are kilograms.',
  '- Answer in the language the user wrote in, and write numbers and dates the way that language does: Finnish uses a decimal comma (82,5 kg) and day.month dates (3.8.); English uses 82.5 kg and 3 Aug. Never write ISO dates such as 2026-08-03 in prose — the context uses them only as data.',
  '- The context\'s labels are English data — "no rep gain at", "held at", "top set", "time before", "first time at", "latest", "best set", "no added load". Say what they mean in the reader\'s language; never copy them into a Finnish answer ("no rep gain at 80 kg" in Finnish is "toistot eivät ole nousseet 80 kilossa").',
  '- Do not describe yourself, your context, or how you reasoned.',
  '',
  '# Answering about the last workout (topic `last_session`)',
  '- One topic: the lift that matters most in that session — a new top weight, the clearest drop, or else the session\'s first lift. The whole answer is about that lift; do not walk through the others (user, 2026-09-28: "ainoastaan se tärkein").',
  '- `takeaway` is the observation: what that lift did compared with the time before — went up, held or fell. Not the total volume, and not a comparison with a different day.',
  '- `why`: at most three short facts about that lift, each from its Last session line.',
  '- A line compares this session with the time before, once. "N of this session in a row at X kg" counts sessions at that weight, not drops: never write that a lift fell again, twice or N times in a row — the context shows one comparison, not a run of them.',
  // The one model line used to tell the reader to hold a new weight until it
  // stuck, and it came back in answers that had nothing to do with the last workout: a beginner
  // who made every rep at a new weight was told to hold it, five times in one
  // eval run (2026-09-28). Two lines, one each way, and the log picks.
  '- `nextSteps`: one sentence on how to approach that lift next time — the focus or the reason, in the reader\'s language, with no kg or rep figure; the figures belong to `example`. When the lift\'s "next time" says which way it moves, the step follows that and nothing else: a hold for recovery means keeping the weight because this week\'s load is above usual ("this week\'s load is above usual, so keep the weight once more"; in Finnish "tämän viikon kuorma on tavallista suurempi, joten pidä paino vielä kerran"), even when every rep was made (store shots, 2026-09-30). Otherwise it follows what the log shows: every rep made means moving on, the way `example` moves ("every rep landed, so it is time to move on"; in Finnish "kaikki toistot menivät, joten on aika edetä"); a missed rep or a drop means repeating the weight ("the last set came up short, so repeat the weight before adding more"; in Finnish "viimeinen sarja jäi vajaaksi, joten toista paino ennen kuin lisäät"). It never contradicts `example`. A step that repeats the example is removed before the reader sees it.',
  '- `attention`: only when something needs a warning — a set at least 2 reps below the set before it, or at least 2 reps below the same set the time before. One rep lower is ordinary fatigue, not a warning. The one place another lift may appear. Name the lift and the set, and give one thing that could fix it (for example 30 s more rest). Otherwise empty; most answers have none.',
  '- `example`: one line for that lift\'s next session, with the numbers from its "next time" in the context, written the way a coach says it, in the reader\'s language ("Hold 50 kg and aim for 7/7/7"; in Finnish "Pidä 50 kg ja tavoittele 7/7/7"). A Finnish-only example came back word for word in English answers (live, 2026-09-28). Empty when the context gives no "next time" for it. Do not repeat the example in `nextSteps`.',
  '',
  '# When you cannot answer',
  '- A coach asks before advising. When the context does not hold what an accurate answer needs, do not guess and do not fall back on a generic answer: ask exactly one short follow-up question, put that question in `takeaway`, leave `why`, `nextSteps`, `plan` and `assumptions` empty, and set `unanswered` to true.',
  '- One question, never two, and never a question plus an answer. It is the whole reply.',
  '- Ask only when the missing fact actually blocks the answer. If a useful answer exists from what you have, give it — asking instead of answering is evasion, and it is the more common failure.',
  '- Pair such a question with the matching `suggestion` so the reader can answer it with one tap — asking to log a chest measurement while offering no way to do it is a question that goes nowhere.',
  '- Prefer a question the app can act on: a measurement to log, a goal to set, a bodyweight to record. "Chest growth is measured, not guessed — shall we log your chest measurement now so there is a starting point?" beats "what do you mean by faster?".',
  '- Never set `unanswered` on a reply that does answer. The flag means the reader was asked something, not that the answer was short or uncertain.',
  '',
  '# Body, goals and nutrition',
  '- When the context lists goals, tie the answer to them: say where the user stands against the goal and name the one thing that moves it next.',
  '- Exactly one goal carries `isPrimary`. That is the goal a general question is answered against; the others are background you may mention only when they change the advice.',
  '- When goals pull against each other — a surplus for size and a deficit for fat loss cannot both be right — name the conflict in one sentence and ask which comes first, following "When you cannot answer". Do not split the difference, and do not quietly pick one.',
  '- A circumference goal is built from training volume, progression and food together — read the relevant lifts from the history when advising on it.',
  '- Check the levers for a growth goal in this order: progression, volume, frequency, food. The first three are readable from the log; advise on the earliest one the log shows lacking, and reach food only when the training levers look in order. Protein arithmetic is the cheapest answer to give, which is exactly why it must not be the default one.',
  '- Never repeat advice you already gave in this conversation. If the same question comes back, either the earlier advice has not been acted on yet — say so and ask about it — or it has, and the next lever is due.',
  '- Nutrition questions: general sports-nutrition knowledge is allowed here, but anchor every number to this user — protein 1.6–2.2 g per kg of their logged bodyweight, surplus or deficit according to their stated goal. If bodyweight is missing from the context, give the per-kg rule and note that logging bodyweight lets you compute it exactly.',
  '- A calorie question gets a calorie figure. Estimate maintenance from the reader\'s logged weight, height, age and sex (Mifflin-St Jeor with an activity factor read from their sessions per week), then add or subtract for their goal; when the logged bodyweight is moving, check the estimate against that rate (about 7,700 kcal per kg). Say once that it is an estimate. Missing height, age or sex, estimate from bodyweight alone (about 30–33 kcal per kg) and say that logging them sharpens it. With no stated goal, read the direction from the bodyweight trend and say which one you assumed. This arithmetic on the reader\'s own numbers is the answer the rules above allow, not a guess to avoid — turning a calorie question into advice about lifts is the failure (eval, 2026-09-28).',
  '- Never prescribe a diet for a medical condition.',
  '',
  '# What the app itself can do',
  '- Vinha builds programmes, and you can start it: attach the `compose_programme` suggestion with a `brief`, and the button under your answer composes a week from the app\'s own exercise library for the reader to look at and save.',
  '- So never tell the reader a programme cannot be built, or that their only options are the ready-made list and editing what they have. Asked for a new programme, offer to build it. That is the answer — not a refusal.',
  '- Ask first only when the brief would be empty. One question — usually days per week, or what they want to focus on — then offer. Two rounds of questions before a button is an interrogation, and everything else the composer needs it already reads from their setup.',
  '- The app decides whether that button is included with their plan and says so under it. Do not discuss what is paid and what is free; you do not know their subscription.',
  '- Do not describe any other screen, button or menu path. You are told about this one because you were denying it existed; everything else you have not been told about, and guessing at it is inventing app behaviour. If the reader asks how to do something in the app that is not covered here, say plainly that you do not know that part rather than guessing, and never suggest reinstalling or updating the app.',
  '',
  '# Offering to do something',
  '- You may offer one action per answer, in `suggestion`, and only when the conversation led there — an offer bolted onto an unrelated answer is an advert.',
  '- Offer only what the App state section shows is missing. Never offer what is already on, and never offer a kind listed under "Do not offer": the reader has answered that question.',
  '- Most answers carry no suggestion at all. Leave it out unless it clearly helps.',
  '- The suggestion button is the only hand you have. Attach it and say what it does, rather than describing an action of your own.',
  '- When the reader asks you to record a number they stated — a bodyweight, a measurement — attach log_measurement with statKey, value and unit, and tell them the button below logs it. When they should record something but gave no number, attach log_measurement without a value: the button opens the recording page.',
  '',
  '# Saying less',
  '- Silence is a valid output. When there is nothing worth saying, say the small true thing rather than manufacturing an insight.',
].join('\n');

function getIpAddress(req: ApiRequest) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }

  return req.socket?.remoteAddress ?? 'unknown';
}

function createSuccess(answer: AICoachAdvice, source: 'live' | 'preview', note?: string): AICoachAdviceSuccess {
  return { ok: true, source, answer, note };
}

function createError(
  error: AICoachAdviceError['error'],
  fallback?: AICoachAdvice,
  note?: string,
  source: 'live' | 'preview' = 'live',
): AICoachAdviceError {
  return { ok: false, source, error, fallback, note };
}

/**
 * The header the app presents on every call, and the key it has to carry.
 *
 * This endpoint had no caller check at all: a public URL, `Access-Control-
 * Allow-Origin: *`, and only a per-instance rate limit between any web page
 * or script and the Anthropic bill (security review, 2026-09-14). No browser
 * client exists, so the CORS headers are gone — a browser now refuses the
 * cross-origin call itself — and every request has to carry the build's key.
 *
 * The key ships inside the APK, so this is a lock on the front door, not a
 * vault: it stops the public repository's readers and any web page, and it
 * makes a caller take the app apart first. Play Integrity or a signed-in
 * identity is the stronger door, and this is the shape it plugs into. Missing
 * on the server means nobody gets in: a deploy without `AI_COACH_APP_KEY` is
 * a coach that answers offline, never one that answers everyone.
 */
const APP_KEY_HEADER = 'x-vinha-app-key';

function hasAppKey(req: ApiRequest): boolean {
  // Trimmed on both sides: a value pasted into Vercel with the newline
  // `openssl rand` prints would otherwise refuse every real build, silently.
  const expected = process.env.AI_COACH_APP_KEY?.trim();
  if (!expected) {
    return false;
  }
  const header = req.headers[APP_KEY_HEADER];
  const presented = (Array.isArray(header) ? header[0] : header)?.trim();
  if (!presented) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const existing = rateLimitStore.get(ip);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { limited: false };
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return { limited: true };
  }

  existing.count += 1;
  rateLimitStore.set(ip, existing);
  return { limited: false };
}

type ParsedBody = AICoachAdviceRequest & { mode: 'advice' | 'compose' };

/**
 * The photo-import request, which shares nothing with the other two modes but
 * the key, the budget and the rate limit: no prompt, no training context, just
 * a picture of a spreadsheet.
 */
interface ParsedImageBody {
  mode: 'table';
  mediaType: ProgramImageMediaType;
  dataBase64: string;
  /** The photo line of the consent sheet, as it stood when this was sent. */
  keepConsent: boolean;
  /** The label a kept photo is filed under. Absent means nothing is kept. */
  logId?: string;
}

function parseImageBody(body: unknown): ParsedImageBody | null {
  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const candidate = parsed as { mode?: unknown; mediaType?: unknown; dataBase64?: unknown };
  if (candidate.mode !== 'table' || !isProgramImageMediaType(candidate.mediaType)) {
    return null;
  }
  // The size is checked with the budget (checkImageBudget), before anything
  // goes upstream: an oversized photo is refused as one, not misread here as
  // a malformed chat request.
  if (typeof candidate.dataBase64 !== 'string' || !candidate.dataBase64) {
    return null;
  }
  const consented = parsed as { keepConsent?: unknown; logId?: unknown };
  return {
    mode: 'table',
    mediaType: candidate.mediaType,
    dataBase64: candidate.dataBase64,
    // Absent means no, the same reading the advice path gives it: an older
    // client that has never seen the consent sheet says nothing.
    keepConsent: consented.keepConsent === true,
    logId: typeof consented.logId === 'string' && LOG_ID_PATTERN.test(consented.logId) ? consented.logId : undefined,
  };
}

/**
 * The open conversation, trimmed to what a follow-up actually needs.
 *
 * Three exchanges is enough for "entä sitten?" to have an antecedent, and the
 * cap matters: this rides in the uncached part of every request, so an
 * unbounded history would be paid for on every turn. Each side is clipped too
 * — a takeaway is one or two sentences by the rules, and anything longer is a
 * client that sent more than it should.
 */
const MAX_HISTORY_TURNS = 3;
const MAX_HISTORY_CHARS = 600;

function sanitizeHistory(value: unknown): AICoachConversationTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const clean = value
    .filter((turn): turn is AICoachConversationTurn => {
      if (!turn || typeof turn !== 'object') {
        return false;
      }
      const record = turn as Partial<AICoachConversationTurn>;
      return (
        typeof record.question === 'string' &&
        typeof record.takeaway === 'string' &&
        record.question.trim().length > 0 &&
        record.takeaway.trim().length > 0
      );
    })
    .map((turn) => ({
      question: turn.question.trim().slice(0, MAX_HISTORY_CHARS),
      takeaway: turn.takeaway.trim().slice(0, MAX_HISTORY_CHARS),
    }));
  // Oldest first, so the newest exchanges are the ones kept.
  return clean.slice(-MAX_HISTORY_TURNS);
}

function parseBody(body: unknown): ParsedBody | null {
  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as Partial<AICoachAdviceRequest> & { mode?: unknown };
  if (typeof candidate.prompt !== 'string' || !candidate.prompt.trim() || !candidate.context || typeof candidate.context !== 'object') {
    return null;
  }

  return {
    prompt: candidate.prompt.trim(),
    // Repaired, not trusted: a context with fields missing used to reach the
    // preview builder and crash the function on `trackedLifts[0]`.
    context: normalizeAiCoachTrainingContext(candidate.context as Partial<AICoachAdviceRequest['context']>),
    history: sanitizeHistory(candidate.history),
    language: candidate.language === 'fi' || candidate.language === 'en' ? candidate.language : undefined,
    mode: candidate.mode === 'compose' ? 'compose' : 'advice',
    /**
     * Whether this reader has said the server may keep a copy of the text.
     *
     * Sent per request rather than remembered, because the answer lives on the
     * phone and can be withdrawn there between two questions. Absent means no:
     * an older client that has never seen the consent sheet says nothing, and
     * silence has to read as a refusal or the sheet is decoration.
     */
    keepConsent: candidate.keepConsent === true,
    // Bounded and narrowed: this ends up in a filename, so anything with a
    // slash or a dot in it would be a path the caller chose rather than a
    // label. A value that fails the shape is simply absent, and an absent
    // label means nothing is written.
    logId:
      typeof candidate.logId === 'string' && LOG_ID_PATTERN.test(candidate.logId)
        ? candidate.logId
        : undefined,
    effortOverride:
      AI_COACH_DEBUG_TRANSCRIPTS
      && process.env.AI_COACH_DEBUG_TRANSCRIPTS === '1'
      && typeof candidate.effortOverride === 'string'
      && ['low', 'medium', 'high', 'off'].includes(candidate.effortOverride)
        ? candidate.effortOverride
        : undefined,
    modelOverride:
      AI_COACH_DEBUG_TRANSCRIPTS
      && process.env.AI_COACH_DEBUG_TRANSCRIPTS === '1'
      && typeof candidate.modelOverride === 'string'
      && /^claude-[a-z0-9.-]{2,40}$/.test(candidate.modelOverride)
        ? candidate.modelOverride
        : undefined,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateAnswer(payload: unknown): AICoachAdvice | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Partial<AICoachAdvice>;
  const { takeaway } = candidate;
  if (typeof takeaway !== 'string' || !takeaway.trim()) {
    return null;
  }
  // A list the model left out is an empty list, not an invalid answer:
  // Sonnet 5 omits `plan: []` when there is no plan to give, and the whole
  // answer fell back to preview over it (eval, 2026-08-23).
  const list = (value: unknown) => (isStringArray(value) ? value : value === undefined ? [] : null);
  const suggestion = validateSuggestion(candidate.suggestion);
  const why = list(candidate.why);
  const nextSteps = list(candidate.nextSteps);
  const plan = list(candidate.plan);
  const assumptions = list(candidate.assumptions);
  if (why === null || nextSteps === null || plan === null || assumptions === null) {
    return null;
  }
  // The last-workout shape's topic and two optional lines (lib/aiCoachAnswerExtras).
  const extras = readAnswerExtras(candidate);

  // A follow-up question is not a billable answer. The client already reads
  // this flag and skips the free-tier charge; until now only the offline
  // preview ever set it, so a live "I need to know X first" cost a question
  // out of three a week. Carried through only when true, so an answer stays
  // the same object it was.
  return {
    takeaway,
    why,
    // Never the example a second time, under the heading above it.
    nextSteps: extras.topic === 'last_session' ? withoutExampleRepeats(nextSteps, extras.example) : nextSteps,
    plan,
    assumptions,
    ...extras,
    ...(candidate.unanswered === true ? { unanswered: true } : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

/**
 * Which part of the shape was wrong, as a field name and a reason.
 *
 * The log used to say only that a payload was invalid, plus the stop reason —
 * which answers "was it truncated?" and nothing else. A complete tool_use that
 * still fails validation left no way to tell an empty takeaway from a
 * malformed list (live eval, 25.8.), so the answer dropped to preview and the
 * cause stayed a guess.
 *
 * Field names and shapes only. Nothing the reader wrote or the model answered
 * goes into a log line.
 */
export function describeAnswerShape(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return `not-an-object:${typeof payload}`;
  }
  const candidate = payload as Partial<AICoachAdvice>;
  if (typeof candidate.takeaway !== 'string') {
    return `takeaway:${candidate.takeaway === undefined ? 'missing' : typeof candidate.takeaway}`;
  }
  if (!candidate.takeaway.trim()) {
    return 'takeaway:empty';
  }
  for (const field of ['why', 'nextSteps', 'plan', 'assumptions'] as const) {
    const value = candidate[field];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      return `${field}:${typeof value}`;
    }
    if (!value.every((item) => typeof item === 'string')) {
      return `${field}:array-of-${[...new Set(value.map((item) => typeof item))].join('|')}`;
    }
  }
  return 'shape-ok';
}

/**
 * The offer, or nothing. An unknown kind is dropped rather than passed on: the
 * client draws a button per kind, and a button it cannot carry out would be a
 * promise the app does not keep.
 */
function validateSuggestion(value: unknown): AICoachSuggestion | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<AICoachSuggestion>;
  if (
    candidate.kind !== 'pin_stat_card' &&
    candidate.kind !== 'set_goal' &&
    candidate.kind !== 'weigh_in_reminder' &&
    candidate.kind !== 'log_measurement' &&
    candidate.kind !== 'compose_programme'
  ) {
    return null;
  }
  // A compose offer with no brief has nothing to hand the composer, and the
  // button would open an empty field — the retyping the offer exists to spare.
  const brief =
    typeof candidate.brief === 'string' && candidate.brief.trim() ? candidate.brief.trim().slice(0, 400) : null;
  if (candidate.kind === 'compose_programme' && !brief) {
    return null;
  }
  return {
    kind: candidate.kind,
    brief,
    statKey: typeof candidate.statKey === 'string' && candidate.statKey.trim() ? candidate.statKey.trim() : null,
    goalText: typeof candidate.goalText === 'string' && candidate.goalText.trim() ? candidate.goalText.trim().slice(0, 200) : null,
    // A reading is a small positive number. Anything outside that is a
    // malformed offer, and a button that would log garbage is dropped whole.
    value:
      typeof candidate.value === 'number' && Number.isFinite(candidate.value) && candidate.value > 0 && candidate.value < 1000
        ? candidate.value
        : null,
    unit: candidate.unit === 'cm' || candidate.unit === 'kg' || candidate.unit === '%' ? candidate.unit : null,
  };
}

/**
 * The answer arrives as a forced tool call, so the schema is enforced by the
 * API rather than by asking the model nicely for JSON.
 */
export function extractToolInput(payload: unknown, toolName: string = ADVICE_TOOL_NAME) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const content = (payload as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return null;
  }

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const record = block as Record<string, unknown>;
    if (record.type === 'tool_use' && record.name === toolName) {
      return record.input ?? null;
    }
  }

  return null;
}

/**
 * The context as text, or null when it cannot be written.
 *
 * The rows are shape-checked where the body is parsed; this is the net under
 * that. A context that threw here used to throw outside every fallback, and
 * the request ended with no JSON at all (break round 2026-09-28).
 */
function contextTextOrNull(context: AICoachAdviceRequest['context'], language?: AICoachAdviceRequest['language'] | null) {
  try {
    return buildAiCoachContextText(context, language);
  } catch (error) {
    console.error('AI coach context could not be written', error);
    return null;
  }
}

const UNREADABLE_CONTEXT = { code: 'BAD_REQUEST' as const, message: 'The training context could not be read.' };

/** The offline answer, if even that can be built from this context. */
function previewOrUndefined(input: AICoachAdviceRequest) {
  try {
    return buildAiCoachPreviewAnswer(input.prompt, input.context, input.language);
  } catch {
    return undefined;
  }
}

async function requestClaude(input: AICoachAdviceRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return createError(
      { code: 'MISSING_API_KEY', message: 'ANTHROPIC_API_KEY is not configured.' },
      buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
      'ANTHROPIC_API_KEY puuttuu. AI Coach preview-vastaus palautettiin sen sijaan.',
    );
  }

  // Sent in the reader's language, so the model names lifts and sessions the
  // way the app does. Measured in the ids the phone fits itself against
  // (fitAiCoachContextToCap): a Finnish name a few letters longer must not
  // refuse a context the phone already trimmed to fit. The two texts differ
  // only in names, a few per cent at most; an app that sends no language gets
  // the ids, and one build.
  const contextText = contextTextOrNull(input.context, input.language ?? null);
  const measuredContextText = input.language ? contextTextOrNull(input.context) : contextText;
  if (contextText === null || measuredContextText === null) {
    // The offline answer, as every other failure here gives one.
    return createError(UNREADABLE_CONTEXT, previewOrUndefined(input));
  }
  const now = Date.now();
  // Each part against its own limit (server audit, 2026-09-21). Counted
  // together, the rules took ~11 KB of the context's 24 and three earlier
  // exchanges took the question's 2,000, and a reader with a full history or
  // a long conversation was answered offline with the request refused.
  const budget = checkBudget(
    {
      promptChars: input.prompt.length,
      // Uncached and paid for on every turn, so it is measured — against its
      // own cap, which sanitizeHistory already keeps it under.
      historyChars: (input.history ?? []).reduce((total, turn) => total + turn.question.length + turn.takeaway.length, 0),
      // The reader's data as the client measured it: what its own caps keep
      // under the limit (fitAiCoachContextToCap).
      contextChars: measuredContextText.length,
      // This file's text, the same for every request: charged, never refused.
      fixedChars: COACH_SYSTEM_RULES.length,
    },
    budgetState,
    now,
    BUDGET_LIMITS,
  );

  if (!budget.allowed) {
    const rejection = budget.rejection;
    console.warn('AI Coach request refused by budget', rejection);
    return createError(
      {
        code: rejection?.reason === 'budget_exhausted' ? 'RATE_LIMIT' : 'BAD_REQUEST',
        message:
          rejection?.reason === 'budget_exhausted'
            ? 'Coach budget for this window is spent.'
            : 'Request is larger than the coach endpoint accepts.',
      },
      buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
      'Live AI Coach ei ollut käytettävissä juuri nyt. Preview-vastaus palautettiin.',
    );
  }

  // Booked before the call, not after: a request that times out still consumed
  // upstream tokens, and a crash between send and response must not leave the
  // spend unaccounted.
  budgetState = recordSpend(budgetState, budget.estimatedTokens, now, BUDGET_LIMITS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.modelOverride ?? CLAUDE_MODEL,
        ...(input.modelOverride || input.effortOverride
          ? effortConfig(input.effortOverride ?? EFFORT_SETTING, input.modelOverride ?? CLAUDE_MODEL)
          : EFFORT_CONFIG),
        max_tokens: CLAUDE_MAX_TOKENS,
        // Rules first, then this user's training context. Two cache
        // breakpoints: the rules block is identical for every user, so it
        // hits across users; the context breakpoint adds same-conversation
        // follow-ups on top.
        system: [
          { type: 'text', text: COACH_SYSTEM_RULES, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: contextText, cache_control: { type: 'ephemeral' } },
        ],
        tools: [
          {
            name: ADVICE_TOOL_NAME,
            description: 'Return coaching advice for the athlete described in the training context.',
            input_schema: AI_COACH_RESPONSE_SCHEMA,
            // The API validates the tool input against the schema before it
            // reaches us — required lists included.
            strict: true,
          },
        ],
        tool_choice: { type: 'tool', name: ADVICE_TOOL_NAME },
        // The open conversation as real turns, so "why?" and "and then?" have
        // something to refer back to. The earlier answers go back as their
        // takeaway alone — the reasons and steps were shown on screen, and
        // resending them would pay for the whole answer again every turn.
        messages: [
          ...(input.history ?? []).flatMap((turn) => [
            { role: 'user', content: turn.question },
            { role: 'assistant', content: turn.takeaway },
          ]),
          { role: 'user', content: input.prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('AI Coach upstream request failed', response.status, body.slice(0, 400));
      return createError(
        { code: 'UPSTREAM_ERROR', message: 'Claude request failed.' },
        buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
        'Live AI Coach ei vastannut oikein. Preview-vastaus palautettiin.',
      );
    }

    const payload = (await response.json()) as unknown;
    const parsed = validateAnswer(extractToolInput(payload));

    if (!parsed) {
      // Shape only, never content: the stop reason tells a truncated answer
      // (max_tokens) from a refused tool call, and that is the whole diagnosis.
      const meta = payload && typeof payload === 'object' ? (payload as { stop_reason?: string; content?: unknown[] }) : {};
      console.error(
        'AI Coach invalid answer payload',
        JSON.stringify({
          stop_reason: meta.stop_reason ?? null,
          blocks: Array.isArray(meta.content) ? meta.content.map((block) => (block as { type?: string }).type ?? '?') : null,
          shape: describeAnswerShape(extractToolInput(payload)),
        }),
      );
      return createError(
        { code: 'INVALID_RESPONSE', message: 'Claude returned an invalid schema payload.' },
        buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
        'Live AI Coach palautti virheellisen vastauksen. Preview-vastaus palautettiin.',
      );
    }

    // The lifts' series reach the model as English data and came back into
    // Finnish answers with their points ("72.5 → 75", 2026-09-30).
    return createSuccess(localizeAdviceDecimals(parsed, input.language), 'live');
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return createError(
      { code: isAbort ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR', message: isAbort ? 'Claude request timed out.' : 'Claude request failed.' },
      buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
      isAbort ? 'Live AI Coach aikakatkaistiin. Preview-vastaus palautettiin.' : 'Live AI Coach ei ollut tavoitettavissa. Preview-vastaus palautettiin.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Shape-checks the composer's tool output; anything off is an INVALID_RESPONSE, not a partial programme. */
export function validateProgramme(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as { title?: unknown; sessions?: unknown };
  if (typeof record.title !== 'string' || !Array.isArray(record.sessions) || record.sessions.length === 0) {
    return null;
  }
  const sessions = [];
  for (const session of record.sessions) {
    if (!session || typeof session !== 'object') {
      return null;
    }
    const entry = session as { name?: unknown; focus?: unknown; exercises?: unknown };
    if (typeof entry.name !== 'string' || !Array.isArray(entry.exercises)) {
      return null;
    }
    const exercises = [];
    for (const exercise of entry.exercises) {
      if (!exercise || typeof exercise !== 'object') {
        return null;
      }
      const item = exercise as { name?: unknown; sets?: unknown; repsMin?: unknown; repsMax?: unknown; restSeconds?: unknown };
      if (
        typeof item.name !== 'string' ||
        typeof item.sets !== 'number' ||
        typeof item.repsMin !== 'number' ||
        typeof item.repsMax !== 'number'
      ) {
        return null;
      }
      exercises.push({
        name: item.name.trim(),
        sets: item.sets,
        repsMin: item.repsMin,
        repsMax: item.repsMax,
        restSeconds: typeof item.restSeconds === 'number' ? item.restSeconds : undefined,
      });
    }
    sessions.push({ name: entry.name.trim(), focus: typeof entry.focus === 'string' ? entry.focus : undefined, exercises });
  }
  return { title: record.title.trim(), sessions };
}

/**
 * The compose mode. Same key, same budget, same rate limit as advice; a
 * different tool and different rules. There is no preview fallback in the
 * response - the deterministic composer needs the exercise library, which is
 * on the device - so every failure is an error the client answers locally.
 */
type ProgrammeResult =
  | AICoachAdviceError
  | { ok: true; source: 'live'; proposal: { title: string; sessions: unknown[] } };

async function requestClaudeProgramme(input: ParsedBody): Promise<ProgrammeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return createError({ code: 'MISSING_API_KEY', message: 'ANTHROPIC_API_KEY is not configured.' });
  }
  const contextText = contextTextOrNull(input.context);
  if (contextText === null) {
    return createError(UNREADABLE_CONTEXT);
  }
  const now = Date.now();
  // As for advice: the reader's context against its cap, the rules charged.
  const budget = checkBudget(
    { promptChars: input.prompt.length, contextChars: contextText.length, fixedChars: COMPOSER_SYSTEM_RULES.length },
    budgetState,
    now,
    BUDGET_LIMITS,
  );
  if (!budget.allowed) {
    const rejection = budget.rejection;
    return createError({
      code: rejection?.reason === 'budget_exhausted' ? 'RATE_LIMIT' : 'BAD_REQUEST',
      message: rejection?.reason === 'budget_exhausted' ? 'Coach budget for this window is spent.' : 'Request is larger than the coach endpoint accepts.',
    });
  }
  budgetState = recordSpend(budgetState, budget.estimatedTokens, now, BUDGET_LIMITS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        ...EFFORT_CONFIG,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: [
          { type: 'text', text: COMPOSER_SYSTEM_RULES },
          { type: 'text', text: contextText, cache_control: { type: 'ephemeral' } },
        ],
        tools: [
          {
            name: PROGRAMME_TOOL_NAME,
            description: 'Return one week of training sessions for the athlete described in the training context.',
            input_schema: AI_COACH_PROGRAMME_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: PROGRAMME_TOOL_NAME },
        messages: [{ role: 'user', content: input.prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('AI composer upstream request failed', response.status, body.slice(0, 400));
      return createError({ code: 'UPSTREAM_ERROR', message: 'Claude request failed.' });
    }
    const payload = (await response.json()) as unknown;
    const proposal = validateProgramme(extractToolInput(payload, PROGRAMME_TOOL_NAME));
    if (!proposal) {
      return createError({ code: 'INVALID_RESPONSE', message: 'Claude returned an invalid programme payload.' });
    }
    return { ok: true as const, source: 'live' as const, proposal };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return createError({
      code: isAbort ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      message: isAbort ? 'Claude request timed out.' : 'Claude request failed.',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The photo-import mode: a picture of a spreadsheet in, the four columns the
 * CSV importer reads out.
 *
 * On-device OCR was the alternative and is the wrong tool — it reads
 * characters, not tables. This shares the coach's key, budget and rate limit
 * because it is the same spend from the same account.
 */
type TableResult =
  | AICoachAdviceError
  | { ok: true; source: 'live'; rows: ReturnType<typeof validateProgramTable> };

async function requestClaudeTable(input: ParsedImageBody): Promise<TableResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return createError({ code: 'MISSING_API_KEY', message: 'ANTHROPIC_API_KEY is not configured.' });
  }

  const now = Date.now();
  // Images are charged by area, not by characters, and the API scales a large
  // one down before it is read — so a photo has its own size check (the
  // import's limit) and a charge in tokens at most what the model bills.
  // Measured as prompt text, a third of its base64 length against the
  // question's 2,000-character cap, every real photo was refused (server
  // audit, 2026-09-21).
  const budget = checkImageBudget(
    { imageBase64Chars: input.dataBase64.length, fixedChars: PROGRAM_TABLE_RULES.length },
    budgetState,
    now,
    BUDGET_LIMITS,
  );
  if (!budget.allowed) {
    const rejection = budget.rejection;
    return createError({
      code: rejection?.reason === 'budget_exhausted' ? 'RATE_LIMIT' : 'BAD_REQUEST',
      message:
        rejection?.reason === 'budget_exhausted'
          ? 'Coach budget for this window is spent.'
          : 'Image is larger than the import endpoint accepts.',
    });
  }
  budgetState = recordSpend(budgetState, budget.estimatedTokens, now, BUDGET_LIMITS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        ...EFFORT_CONFIG,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: [{ type: 'text', text: PROGRAM_TABLE_RULES }],
        tools: [
          {
            name: PROGRAM_TABLE_TOOL_NAME,
            description: 'Report the training programme visible in the image as rows.',
            input_schema: PROGRAM_TABLE_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: PROGRAM_TABLE_TOOL_NAME },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: input.mediaType, data: input.dataBase64 },
              },
              { type: 'text', text: 'Report every exercise row in this programme.' },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('AI table upstream request failed', response.status, body.slice(0, 400));
      return createError({ code: 'UPSTREAM_ERROR', message: 'Claude request failed.' });
    }
    const rows = validateProgramTable(extractToolInput(await response.json(), PROGRAM_TABLE_TOOL_NAME));
    if (rows === null) {
      return createError({ code: 'INVALID_RESPONSE', message: 'Claude returned an invalid table payload.' });
    }
    return { ok: true as const, source: 'live' as const, rows };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return createError({
      code: isAbort ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      message: isAbort ? 'Claude request timed out.' : 'Claude request failed.',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Keep a copy, if and only if the reader said to.
 *
 * One function for all three routes, because "keep what I send the coach" is
 * one promise made three times, and a second copy of this condition is a
 * second chance to get it wrong.
 *
 * The development switch is deliberately NOT part of it any more (2026-09-10).
 * That flag says whether OUR debug log exists in this build; hanging the
 * reader's own permission on it meant a yes bought nothing in production —
 * consent, label, retention and a delete route all built around a folder
 * nothing ever wrote to. What the reader allows, the server keeps; what the
 * reader has not allowed is still refused here and nowhere else.
 *
 * The label leads the filename so withdrawing can find every copy by name
 * without opening one to look inside, and the day leads the path so the
 * 24-month cron can sweep it by prefix.
 */
async function keepTranscript(
  // Undefined is a real caller: an older client sends no answer at all, and
  // the absence has to read as a no here as well as at the parser.
  keepConsent: boolean | undefined,
  logId: string | undefined,
  record: Record<string, unknown>,
): Promise<void> {
  // Nothing is kept while copies are off — whatever an older app still sends.
  if (!COACH_COPIES_KEPT || !keepConsent || !logId) {
    return;
  }
  const at = new Date();
  const day = at.toISOString().slice(0, 10);
  const pathname = `transcripts/${day}/${logId}--${at.toISOString().replace(/[:.]/g, '-')}.json`;
  try {
    await put(pathname, JSON.stringify({ at: at.toISOString(), ...record }), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
  } catch (error) {
    // Keeping a copy must never cost the reader an answer.
    console.warn('transcript store failed', error instanceof Error ? error.message : error);
  }
}

/**
 * The codes this endpoint answers with before anything reaches the model: no
 * key, a request over a size limit, the budget spent.
 */
const REFUSED_BEFORE_MODEL: ReadonlySet<string> = new Set(['MISSING_API_KEY', 'BAD_REQUEST', 'RATE_LIMIT']);

/**
 * Whether a request was refused here, before the model saw it. Nothing of one
 * is kept: the reader agreed to keep what the coach was asked, and this was
 * never asked. A refused photo was filed anyway, the picture with it (server
 * audit, 2026-09-21).
 */
function refusedBeforeModel(result: { ok: true } | AICoachAdviceError): boolean {
  return result.ok !== true && REFUSED_BEFORE_MODEL.has(result.error.code);
}

/** One note to a Slack incoming webhook; the status, or null when it never answered. */
async function postToSlack(webhook: string, text: string): Promise<number | null> {
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      // Well inside the phone's own 40 s wait, so a stuck Slack still answers
      // the reader with a failure they can retry rather than a hang.
      signal: AbortSignal.timeout(10000),
    });
    return response.status;
  } catch {
    return null;
  }
}

/** The label to forget, or null when this is not a forget request. */
function readForgetLogId(body: unknown): string | null {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const candidate = parsed as { mode?: unknown; logId?: unknown } | null;
    if (!candidate || candidate.mode !== 'forget') {
      return null;
    }
    return typeof candidate.logId === 'string' && LOG_ID_PATTERN.test(candidate.logId)
      ? candidate.logId
      : null;
  } catch {
    return null;
  }
}

/**
 * Every transcript filed under one label, gone.
 *
 * Listed by prefix and matched by filename rather than by opening each blob:
 * the label leads the name for exactly this reason. Paging matters — a reader
 * who used the coach for a year has more copies than one page holds, and
 * stopping at the first page would leave the rest behind while reporting
 * success.
 */
async function forgetTranscripts(logId: string): Promise<number> {
  const doomed: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'transcripts/', cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (blob.pathname.includes(`/${logId}--`)) {
        doomed.push(blob.pathname);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  for (let index = 0; index < doomed.length; index += 100) {
    await del(doomed.slice(index, index + 100));
  }
  return doomed.length;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json(createError({ code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' }, undefined, undefined, 'preview'));
    return;
  }

  // Before anything is parsed, before the rate limit: a stranger's request
  // costs a header comparison and nothing else. The app treats the refusal
  // like any other failure and answers offline.
  if (!hasAppKey(req)) {
    // Only the misconfiguration is logged. A mismatch is a stranger, and a
    // line per stranger would be a log bill anyone could run up for free.
    if (!process.env.AI_COACH_APP_KEY?.trim()) {
      console.error('ai-coach UNAUTHORIZED: AI_COACH_APP_KEY is not set, so every request is refused');
    }
    res.status(401).json(createError({ code: 'UNAUTHORIZED', message: 'Missing or wrong app key.' }, undefined, undefined, 'preview'));
    return;
  }

  // The kill switch (docs/tietoturvaloukkaus.md): right after the key, before
  // anything else is read, parsed or written. api/notice stays open to say
  // why. Withdrawing consent stays open too: it only deletes, and during an
  // incident it is the one request a reader most needs to land.
  if (isServicePaused(process.env) && !readForgetLogId(req.body)) {
    res.status(503).json(servicePausedBody());
    return;
  }

  /**
   * Withdrawing: delete every copy filed under this label.
   *
   * First, before anything else is parsed, and free of every gate but one. It
   * carries no prompt and no context, it costs no model call, and it must work
   * whatever the log switch is set to — a reader taking back permission cannot
   * be told to wait for a build. Deleting nothing is a success: a reader who
   * allowed nothing has nothing to remove, and saying so is the honest answer.
   *
   * The one gate it does keep is the rate limit, and it needs it more than the
   * other paths do. There is no account here, so the route is open, and every
   * call lists the whole transcripts prefix before it deletes anything —
   * unlimited, a stranger sending guessed labels would make the function pay
   * for a full listing per request. Nobody withdraws consent sixty times in
   * ten minutes, so the existing limit costs a real reader nothing.
   */
  const forgetLogId = readForgetLogId(req.body);
  if (forgetLogId) {
    if (checkRateLimit(getIpAddress(req)).limited) {
      res.status(429).json({ ok: false, error: 'RATE_LIMIT' });
      return;
    }
    try {
      const removed = await forgetTranscripts(forgetLogId);
      res.status(200).json({ ok: true, removed });
    } catch {
      // The switch stays off on the phone either way, so nothing more is
      // written; this only means the copies already there survived the call.
      res.status(502).json({ ok: false, error: 'FORGET_FAILED' });
    }
    return;
  }

  /**
   * A reader flagging one answer (Play's AI-generated content policy: from
   * inside the app, about that answer). Before the version gate for the same
   * reason as the withdrawal above: a report has to land from whatever build
   * the reader has. It carries the answer and a reason, never the question
   * (lib/coachAnswerReport), and goes to the team's #bugs channel.
   *
   * The reply says whether it arrived — the app shows "sent" only on `ok`.
   */
  const report = readCoachReport(req.body);
  if (report) {
    // Its own count: a reader who has used up their questions can still flag
    // the answer that made them want to, and a report spends no question.
    if (checkRateLimit(`report:${getIpAddress(req)}`).limited) {
      res.status(429).json({ ok: false, error: 'RATE_LIMIT' });
      return;
    }
    const webhook = process.env.SLACK_WEBHOOK_BUGS?.trim();
    if (!webhook) {
      console.error('ai-coach REPORT_UNROUTED: SLACK_WEBHOOK_BUGS is not set, so a reported answer had nowhere to go');
      res.status(503).json({ ok: false, error: 'REPORT_UNROUTED' });
      return;
    }
    const status = await postToSlack(webhook, formatCoachReportForSlack(report));
    if (status !== null && status >= 200 && status < 300) {
      res.status(200).json({ ok: true });
    } else {
      console.error(`ai-coach REPORT_FAILED: Slack answered ${status ?? 'nothing'}`);
      res.status(502).json({ ok: false, error: 'REPORT_FAILED' });
    }
    return;
  }

  // A build older than APP_MIN_VERSION_<platform> is told to update — after
  // the withdrawal above, never before it: taking back permission has to work
  // from whatever build the reader has (lib/appUpdateGate).
  if (isAppVersionRefused(req.headers, process.env)) {
    res.status(426).json(appUpdateRefusalBody(req.headers, process.env));
    return;
  }

  // The photo import is parsed first and separately: it carries no prompt and
  // no training context, so parseBody would reject it as malformed.
  let imageInput: ParsedImageBody | null = null;
  try {
    imageInput = parseImageBody(req.body);
  } catch {
    imageInput = null;
  }
  if (imageInput) {
    const ipForImage = getIpAddress(req);
    if (checkRateLimit(ipForImage).limited) {
      res.status(429).json(createError({ code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' }));
      return;
    }
    const imageStartedAt = Date.now();
    const table = await requestClaudeTable(imageInput);
    // The line the reader ticked says "Valokuvat", so the photo itself is what
    // is kept, together with what was read out of it — the pair is what makes
    // a misread importable page fixable later. Same folder and same naming as
    // the other two, so one withdrawal reaches all three and the 24-month cron
    // sweeps them together. A photo refused before the model saw it is not
    // one the coach was asked about, and is not kept.
    if (!refusedBeforeModel(table)) {
      await keepTranscript(imageInput.keepConsent, imageInput.logId, {
        kind: 'photo',
        model: CLAUDE_MODEL,
        durationMs: Date.now() - imageStartedAt,
        mediaType: imageInput.mediaType,
        dataBase64: imageInput.dataBase64,
        source: table.ok === true ? 'live' : `error:${table.error.code}`,
        rows: table.ok === true ? table.rows : null,
      });
    }
    if (table.ok === true) {
      res.status(200).json(table);
      return;
    }
    const tableFailure: AICoachAdviceError = table;
    const tableStatus =
      tableFailure.error.code === 'UPSTREAM_TIMEOUT'
        ? 504
        : tableFailure.error.code === 'RATE_LIMIT'
          ? 429
          : tableFailure.error.code === 'BAD_REQUEST'
            ? 400
            : 502;
    res.status(tableStatus).json(tableFailure);
    return;
  }

  let input: ParsedBody | null = null;
  try {
    input = parseBody(req.body);
  } catch {
    input = null;
  }

  if (!input) {
    res.status(400).json(createError({ code: 'BAD_REQUEST', message: 'Prompt and context are required.' }, undefined, undefined, 'preview'));
    return;
  }

  const ip = getIpAddress(req);
  const rateLimit = checkRateLimit(ip);
  if (rateLimit.limited) {
    res.status(429).json(
      createError(
        { code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' },
        buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
        'Pyyntoraja tayttyi hetkeksi. Preview-vastaus palautettiin.',
      ),
    );
    return;
  }

  if (input.mode === 'compose') {
    const composeStartedAt = Date.now();
    const composed = await requestClaudeProgramme(input);
    // "Luodut ohjelmat": the brief and the week that came back, on the
    // composer's own line of the consent sheet — for a brief the model saw.
    if (!refusedBeforeModel(composed)) {
      await keepTranscript(input.keepConsent, input.logId, {
        kind: 'composer',
        language: input.language,
        model: CLAUDE_MODEL,
        durationMs: Date.now() - composeStartedAt,
        prompt: input.prompt,
        source: composed.ok === true ? 'live' : `error:${composed.error.code}`,
        proposal: composed.ok === true ? composed.proposal : null,
      });
    }
    if (composed.ok === true) {
      res.status(200).json(composed);
      return;
    }
    // Narrowed by the literal discriminant: Vercel's compiler refused the
    // truthiness form and reported `error` as missing on the union.
    const failure: AICoachAdviceError = composed;
    const composeStatus =
      failure.error.code === 'UPSTREAM_TIMEOUT' ? 504 : failure.error.code === 'RATE_LIMIT' ? 429 : failure.error.code === 'BAD_REQUEST' ? 400 : 502;
    res.status(composeStatus).json(failure);
    return;
  }

  const startedAt = Date.now();
  const result = await requestClaude(input);
  // The question and its answer, kept only for a reader who allowed it, and
  // only for a question the model saw. The training context is never written
  // down on any of these paths — and on a failed call the "answer" is the
  // preview fallback built locally from that same context, never something
  // the model said, so an error path keeps the code and nothing the reader
  // would recognise as an answer.
  if (!refusedBeforeModel(result)) {
    await keepTranscript(input.keepConsent, input.logId, {
      kind: 'chat',
      language: input.language,
      model: CLAUDE_MODEL,
      durationMs: Date.now() - startedAt,
      prompt: input.prompt,
      source: result.ok === true ? result.source : `error:${result.error.code}`,
      answer: result.ok === true ? result.answer : null,
    });
  }
  // The literal discriminant, as in the composer branch above: Vercel compiles
  // without strictNullChecks, where `result.ok` alone narrows nothing.
  if (result.ok === true) {
    res.status(200).json(result);
    return;
  }

  const status = result.error.code === 'UPSTREAM_TIMEOUT' ? 504 : result.error.code === 'RATE_LIMIT' ? 429 : 502;
  res.status(status).json(result);
}
