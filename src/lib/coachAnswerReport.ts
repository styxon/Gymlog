import { AICoachAdvice } from '../types/aiCoach';

/**
 * Reporting one coach answer from inside the app.
 *
 * Play's AI-generated content policy asks that a reader can flag an offensive
 * answer without leaving the app, and a `mailto:` link in Settings does
 * neither (project-play-readiness). What leaves the phone is the answer the
 * reader flagged and the reason they picked — not their question, which is
 * their own words and may be about their body. The answer is the model's.
 *
 * Built on the phone and read back on the server by the same module, so the
 * two cannot drift apart.
 */

export const COACH_REPORT_REASONS = ['offensive', 'harmful', 'wrong', 'other'] as const;
export type CoachReportReason = (typeof COACH_REPORT_REASONS)[number];

/** Per line and per list: an answer is short, and a longer body is not one of ours. */
export const MAX_REPORT_LINE_CHARS = 600;
export const MAX_REPORT_LIST_ITEMS = 8;

interface CoachReportAnswer {
  takeaway: string;
  why: string[];
  nextSteps: string[];
  attention: string | null;
  example: string | null;
  plan: string[];
}

interface CoachReport {
  reason: CoachReportReason;
  answer: CoachReportAnswer;
}

/** The request body the app sends. */
export function buildCoachReportBody(reason: CoachReportReason, advice: AICoachAdvice) {
  const report: CoachReport = {
    reason,
    answer: {
      takeaway: advice.takeaway,
      why: advice.why,
      nextSteps: advice.nextSteps,
      attention: advice.attention ?? null,
      example: advice.example ?? null,
      plan: advice.plan,
    },
  };
  return { mode: 'report' as const, report };
}

function line(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_REPORT_LINE_CHARS) : null;
}

function lines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(line)
    .filter((entry): entry is string => entry !== null)
    .slice(0, MAX_REPORT_LIST_ITEMS);
}

/**
 * The report in a request body, or null when the body is not one.
 *
 * Strict where it matters — the mode, a known reason and a takeaway — and
 * forgiving about the rest, so an answer with an empty section still arrives.
 */
export function readCoachReport(body: unknown): CoachReport | null {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const candidate = parsed as { mode?: unknown; report?: unknown } | null;
    if (!candidate || candidate.mode !== 'report' || !candidate.report || typeof candidate.report !== 'object') {
      return null;
    }
    const report = candidate.report as { reason?: unknown; answer?: unknown };
    if (!COACH_REPORT_REASONS.includes(report.reason as CoachReportReason)) {
      return null;
    }
    const answer = (report.answer ?? {}) as Record<string, unknown>;
    const takeaway = line(answer.takeaway);
    if (!takeaway) {
      return null;
    }
    return {
      reason: report.reason as CoachReportReason,
      answer: {
        takeaway,
        why: lines(answer.why),
        nextSteps: lines(answer.nextSteps),
        attention: line(answer.attention),
        example: line(answer.example),
        plan: lines(answer.plan),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Slack reads `<…>` as a link or a mention and `&` as the start of an entity,
 * and the answer is model output: escaped, a "<!channel>" in it is text.
 */
function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The note posted for the team to review. */
export function formatCoachReportForSlack(report: CoachReport): string {
  const { answer } = report;
  const quoted = (label: string, entries: string[]) =>
    entries.length > 0 ? [`*${label}*`, ...entries.map((entry) => `> ${escapeSlack(entry)}`)] : [];
  return [
    `:triangular_flag_on_post: Coach answer reported — reason: *${report.reason}*`,
    ...quoted('Takeaway', [answer.takeaway]),
    ...quoted('Why', answer.why),
    ...quoted('Next steps', answer.nextSteps),
    ...quoted('Attention', answer.attention ? [answer.attention] : []),
    ...quoted('Example', answer.example ? [answer.example] : []),
    ...quoted('Plan', answer.plan),
  ].join('\n');
}
