import { AICoachProgramme, AICoachProgrammeDay } from '../types/aiCoach';

/**
 * The programme block of the coach's context: what the reader's plan actually
 * contains, not just what it is called.
 *
 * The context used to carry one line — `custom: Pakarakunto · Pro | 57 ready
 * programs available` — so the coach could name the programme and nothing
 * else. Asked what was in it, it answered "I cannot see your programme's
 * exercises in this data": honest about the payload, and nonsense to a reader
 * whose next tap shows every exercise (user 2026-08-25). It also made every
 * "does this fit my goal" question unanswerable, because judging a programme
 * without reading it is the one thing the evidence rules forbid.
 *
 * The source is Home's own composed week, so the coach reads the same rows the
 * reader does. Nothing is recomputed here; a second derivation is a second
 * chance to disagree with the screen.
 */

/**
 * A reader-authored string (a goal, a custom programme, day or exercise name)
 * rendered as one line inside the system prompt. Posted straight from the
 * phone into a payload the endpoint otherwise trusts the shape of, a goal or
 * a name carrying a blank line and a line starting with `#` opens what reads
 * to the model as a new section — its own heading, in the middle of the
 * reader's data. Collapsing every run of whitespace, including newlines, to
 * one space keeps it what it is: a line of the reader's data, never a
 * section of instructions.
 */
export function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Sessions past this are named but not listed — see MAX_EXERCISES. Exported
 * so the endpoint's re-parse of a posted programme (normalizeAiCoachTrainingContext
 * in aiTrainingContext.ts) caps a posted `days` array to the same bound this
 * builder holds its own to, rather than a second number that can drift from
 * it (recheck round, 2026-09-29).
 */
export const MAX_DAYS = 7;
/**
 * Enough for a long day and a hard stop before a payload becomes a bill. A
 * trimmed day still says how many exercises it really has, because "8
 * exercises, first 12 listed" is a lie no reader can catch. Exported for the
 * same reason as MAX_DAYS above.
 */
export const MAX_EXERCISES = 12;

interface ProgrammeCardSession {
  title: string;
  dayLabel?: string | null;
  durationMinutes?: number | null;
  exercises: { name: string; schemeLabel?: string | null; setsLabel?: string | null }[];
}

export interface ProgrammeCardInput {
  title: string;
  programType: 'ready' | 'custom';
  sessions: ProgrammeCardSession[];
}

function schemeOf(exercise: ProgrammeCardSession['exercises'][number]): string {
  const scheme = exercise.schemeLabel?.trim();
  if (scheme) {
    return scheme;
  }
  // A card built before schemes existed still knows the set count, and "4
  // sets" beats an empty column.
  return exercise.setsLabel?.trim() ?? '';
}

export function buildAiCoachProgramme(card: ProgrammeCardInput | null | undefined): AICoachProgramme | null {
  if (!card || !card.title.trim() || card.sessions.length === 0) {
    return null;
  }

  let truncated = card.sessions.length > MAX_DAYS;
  const days: AICoachProgrammeDay[] = card.sessions.slice(0, MAX_DAYS).map((session) => {
    const listed = session.exercises.slice(0, MAX_EXERCISES);
    if (listed.length < session.exercises.length) {
      truncated = true;
    }
    return {
      name: session.title.trim(),
      dayLabel: session.dayLabel?.trim() || null,
      estimatedMinutes:
        typeof session.durationMinutes === 'number' && Number.isFinite(session.durationMinutes)
          ? session.durationMinutes
          : null,
      exercises: listed.map((exercise) => ({ name: exercise.name.trim(), scheme: schemeOf(exercise) })),
    };
  });

  return {
    title: card.title.trim(),
    source: card.programType,
    // The plan's own day count, not the listed one: a plan trimmed for the
    // payload must not read as a shorter week than it is.
    daysPerWeek: card.sessions.length,
    days,
    truncated,
  };
}

/**
 * The programme as prompt text. Kept beside the builder so the shape and the
 * rendering cannot drift. Names go through the caller's labels, so the
 * context reads in the reader's language (identity by default).
 */
export function renderAiCoachProgramme(
  programme: AICoachProgramme,
  liftName: (name: string) => string = (name) => name,
  sessionName: (name: string) => string = (name) => name,
): string[] {
  const lines = [
    `${singleLine(programme.title)} (${programme.source === 'ready' ? 'ready-made' : 'the reader authored it'}) | ${programme.daysPerWeek} days per week`,
  ];
  for (const day of programme.days) {
    const head = [day.dayLabel, day.name ? sessionName(day.name) : day.name].filter(Boolean).join(' · ');
    const minutes = day.estimatedMinutes ? ` (~${day.estimatedMinutes} min)` : '';
    lines.push(`- ${head}${minutes}`);
    for (const exercise of day.exercises) {
      lines.push(`  - ${liftName(exercise.name)}${exercise.scheme ? `: ${exercise.scheme}` : ''}`);
    }
  }
  if (programme.truncated) {
    lines.push('- (longer days were shortened for this payload)');
  }
  return lines;
}
