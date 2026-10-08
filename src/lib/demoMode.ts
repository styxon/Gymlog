/**
 * Whether this build is the demo.
 *
 * A plain constant, not a read of app.json: importing the config from src
 * widens TypeScript's rootDir and moves every compiled file, which breaks the
 * test build. So the flag is declared twice — here and as app.json's
 * `extra.demoBuild` — and tests/lib/proLock asserts the two agree.
 *
 * That guard is the point. The release step is to clear extra.demoBuild, and
 * the moment someone does, the suite fails until this constant is cleared too.
 * Anything that only belongs in the demo hangs off this one flag, so nothing
 * demo-shaped can reach a release build by being forgotten.
 */
export const DEMO_BUILD = false;

export function isDemoBuild(): boolean {
  return DEMO_BUILD;
}
