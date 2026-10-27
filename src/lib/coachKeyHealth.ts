/**
 * Whether the live coach's key still opens the door.
 *
 * On 2026-09-13 the production key had been rejected by Anthropic ("API key is
 * invalid", 401) for an unknown stretch: every coach answer was quietly the
 * on-device fallback, and nothing said so to anyone who could fix it. Vercel's
 * free tier keeps function logs for about an hour, so the failure left no trail
 * either. A daily probe (api/coach-health.ts) asks and this decides what the
 * answer means.
 *
 * Only a verdict on the setup raises an alert. A timeout, a 429 or a 5xx is
 * Anthropic or the network having a bad minute, and the next day's run asks
 * again; alerting on those would teach the reader to ignore the channel.
 *
 * Two more verdicts since the server audit (2026-09-21). The check said ok
 * while a deploy without AI_COACH_APP_KEY refused every request the app made
 * ('app_key_missing'). And it asked for the model list, which a key can read
 * while every real call is refused — a spend limit reached, credit gone, a
 * model name that no longer exists. It now asks the coach's own model for one
 * token, and a 400 or 404 to that is a coach answering offline ('refused').
 */

type CoachKeyState = 'ok' | 'missing' | 'app_key_missing' | 'rejected' | 'refused' | 'unreachable';

interface CoachKeyProbe {
  /** Whether ANTHROPIC_API_KEY is set at all. */
  keyConfigured: boolean;
  /**
   * Whether AI_COACH_APP_KEY is set. Without it the endpoint refuses every
   * request the app makes, whatever Anthropic says. Absent: not checked.
   */
  appKeyConfigured?: boolean;
  /** The HTTP status Anthropic answered the one-token call with, or null when no answer arrived. */
  status: number | null;
}

interface CoachKeyVerdict {
  state: CoachKeyState;
  alert: boolean;
}

export function classifyCoachKeyProbe(probe: CoachKeyProbe): CoachKeyVerdict {
  if (!probe.keyConfigured) {
    return { state: 'missing', alert: true };
  }
  if (probe.appKeyConfigured === false) {
    return { state: 'app_key_missing', alert: true };
  }
  if (probe.status !== null && probe.status >= 200 && probe.status < 300) {
    return { state: 'ok', alert: false };
  }
  // 401: the key is unknown, deleted or disabled. 403: it exists but may not
  // be used (a disabled workspace or organisation). Both need a person.
  if (probe.status === 401 || probe.status === 403) {
    return { state: 'rejected', alert: true };
  }
  // The probe is a fixed one-token call the coach makes every day in bigger
  // form. Refused as invalid (400: a spend limit, no credit) or as naming
  // nothing (404: the model), it is refused for every reader too.
  if (probe.status === 400 || probe.status === 404) {
    return { state: 'refused', alert: true };
  }
  return { state: 'unreachable', alert: false };
}

/**
 * The Slack note for an alerting verdict, or null when there is nothing to say.
 *
 * In Finnish, because the one reader of #bugs reads it that way. It names the
 * consequence and the fix, never the key itself. `detail` is Anthropic's own
 * error type and message for a refused call — its words about the account,
 * which say whether it is the limit, the credit or the model.
 */
export function coachKeyAlertText(verdict: CoachKeyVerdict, status: number | null, detail: string | null = null): string | null {
  if (!verdict.alert) {
    return null;
  }
  const consequence = 'Kaikki valmentajan vastaukset ovat nyt laitteen varavastauksia.';
  const fix =
    'Korjaus: uusi avain Anthropic Consolessa → Vercel, projekti vinha → Settings → Environment Variables → '
    + 'ANTHROPIC_API_KEY (Production) → Deployments → Redeploy.';
  if (verdict.state === 'missing') {
    return `Valmentajan API-avain puuttuu: ANTHROPIC_API_KEY ei ole asetettu Vercelissä. ${consequence} ${fix}`;
  }
  if (verdict.state === 'app_key_missing') {
    return (
      'Valmentajan sovellusavain puuttuu: AI_COACH_APP_KEY ei ole asetettu Vercelissä, joten palvelin hylkää '
      + `jokaisen sovelluksen pyynnön. ${consequence} Korjaus: sama arvo kuin buildin EXPO_PUBLIC_AI_COACH_APP_KEY → `
      + 'Vercel, projekti vinha → Settings → Environment Variables → AI_COACH_APP_KEY (Production) → Deployments → Redeploy.'
    );
  }
  if (verdict.state === 'refused') {
    const reason = detail ? ` (${detail})` : '';
    return (
      `Anthropic hylkäsi valmentajan kutsun: ${status}${reason}. Avain kelpaa, mutta kutsu ei mene läpi — `
      + `tavallisimmin Consolen käyttöraja tai loppunut saldo, tai AI_COACH_CLAUDE_MODEL nimeää mallin, jota ei ole. ${consequence} `
      + 'Korjaus: Anthropic Console → Billing ja Limits, tai AI_COACH_CLAUDE_MODEL Vercelissä → Redeploy.'
    );
  }
  return `Valmentajan API-avain ei kelpaa: Anthropic vastasi ${status}. ${consequence} ${fix}`;
}
