/**
 * Deleting an account from the web page (styxon.fi), without the app — what
 * Play asks of the Delete account URL: "without sending the user back to the
 * app and requiring them to re-download it".
 *
 * The page signs the reader in with Google in the browser and sends the same
 * request the app's Delete account sends: DELETE with the Google ID token and
 * `x-backup-action: delete-account`. The token's audience is the same Web
 * client the app signs in through, so the server needs no new identity; it
 * needs only to let that one page make that one request across origins.
 *
 * Shared by api/backup.ts (which answers the browser) and the page builder.
 */

/** The pages allowed to send the request. Nothing else gets a CORS header. */
const WEB_DELETION_ORIGINS = ['https://styxon.fi', 'https://www.styxon.fi'] as const;

/** Where the page sends it. */
export const WEB_DELETION_ENDPOINT = 'https://api.vinha.app/api/backup';

/** The headers the page sends besides the simple ones. */
const WEB_DELETION_REQUEST_HEADERS = ['authorization', 'x-backup-action'] as const;

/**
 * The CORS headers for one request, or null when it gets none.
 *
 * Only a DELETE and its preflight are answered: a GET carrying a token is not
 * preflighted by method (GET is always allowed), so an Allow-Origin header on
 * it would let script on the page read the backup back. Without the header the
 * browser keeps the response from the page.
 */
export function webDeletionCorsHeaders(
  origin: string | string[] | undefined,
  method: string | undefined,
): Record<string, string> | null {
  const value = Array.isArray(origin) ? origin[0] : origin;
  if (!value || !(WEB_DELETION_ORIGINS as readonly string[]).includes(value)) {
    return null;
  }
  if (method !== 'DELETE' && method !== 'OPTIONS') {
    return null;
  }
  return {
    'access-control-allow-origin': value,
    'access-control-allow-methods': 'DELETE',
    'access-control-allow-headers': WEB_DELETION_REQUEST_HEADERS.join(', '),
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
