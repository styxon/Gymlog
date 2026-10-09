/**
 * The one reader of an exercise picture's key.
 *
 * Pictures ship inside the app (assets/exercises, looked up through
 * src/assets/exerciseImages.ts) and an exercise names its picture by a key: the
 * picture's folder name in free-exercise-db, e.g. "3_4_Sit-Up". Before
 * 2026-10-09 the app fetched them from jsDelivr, and the full URL was stored
 * with an active workout (ActiveLift.imageUrl) and with a finished one's
 * summary, so an old install still carries such strings.
 *
 * This accepts a key, or one of those legacy URLs (mapped to its key by slug),
 * and returns null for anything else. In particular any other http(s) URL
 * gives null: nothing here may ever lead to a request to a remote host.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

// The URL shape the app stored before the pictures were bundled. The host is
// named here only to recognise those strings; it is never requested.
const LEGACY_URL_PATTERN =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/yuhonas\/free-exercise-db@main\/exercises\/([A-Za-z0-9_-]+)\/\d+\.jpg$/;

export function exerciseImageKeyFrom(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (KEY_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const legacy = LEGACY_URL_PATTERN.exec(trimmed);
  return legacy ? legacy[1] : null;
}
