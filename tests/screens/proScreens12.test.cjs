const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const unlock = read('src', 'screens', 'PremiumUnlockScreen.tsx');
const end = read('src', 'screens', 'MembershipEndScreen.tsx');
const tab = read('src', 'app', 'renderProfileTab.tsx');
const i18n = read('src', 'lib', 'i18n.ts');

/**
 * GAINER Pro screens, parts 01 and 02 (design 2026-09-02). One grammar: a
 * list of before → after, one filled action per screen, state in violet,
 * the destructive choice a text line under the safe one. Gold, green and
 * filled red are out.
 */
module.exports = [
  {
    name: 'pro live: a violet state badge that names the moment, violet chips, one action and a quiet link',
    run() {
      // The green pip is gone with its glyph; the badge says when.
      assert.doesNotMatch(unlock, /promo\.proOn|statusDot|CheckGlyph|theme\.green|theme\.gold|HIGHLIGHT_INK/);
      assert.match(unlock, /'unlock\.state\.liveSince', \{ time: formatTime\(liveSince, language\) \}/);
      assert.match(unlock, /stateBadge: \{[^}]*backgroundColor: theme\.purpleLight/s);
      assert.match(unlock, /nowChip: \{[^}]*backgroundColor: theme\.purpleLight/s);
      // The headline's count is derived and spelled: "Five caps just came off".
      assert.match(unlock, /'unlock\.headline', \{ count: countWord\(PRO_UNLOCK_CARDS\.length, language\) \}/);
      // ONE action, and nothing under it. The quiet link sold the Pro page to
      // a reader who had just bought it, standing beneath a list of what they
      // now have: "poista ala nappi katso kaikki mita pro tekee" (user
      // 2026-09-07).
      assert.match(unlock, /cta: \{[^}]*backgroundColor: theme\.highlight/s);
      assert.equal((unlock.match(/styles\.cta,/g) ?? []).length, 1, 'one filled button');
      assert.doesNotMatch(unlock, /unlock\.seeEverything/, 'the quiet link grew back');
      assert.doesNotMatch(i18n, /'unlock\.seeEverything'/, 'the string outlived its link');

      // And the page thanks the reader before it lists anything.
      assert.match(i18n, /'unlock\.headline': 'Thank you — \{count\} caps just came off'/);
      // The spelled count is capitalised, so it must open its own sentence.
      assert.match(i18n, /'unlock\.headline': 'Kiitos\. \{count\} rajaa poistui, ja Pro on päällä\.'/);
      // No purchase record, no invented time: the badge drops to a bare "live".
      // A trial is not a purchase, so it never borrows one's instant.
      assert.match(tab, /liveSince=\{route\.trialUntil \? null : preferences\.mockSubscriptionPurchasedAt \?\? null\}/);
      assert.doesNotMatch(tab, /liveSince=\{[^}]*new Date\(\)/);
      for (const key of ['unlock.state.liveSince', 'unlock.headline']) {
        assert.equal(i18n.split(`'${key}': '`).length - 1, 2, `${key} in EN and FI`);
      }
      assert.ok(i18n.includes("'unlock.cta': 'Back to the app'"));
    },
  },
  {
    name: 'end membership: the rows run backwards in violet → grey, Keep is the only button, ending is a dated red line',
    run() {
      // Chips, not struck text: what you have (violet) → what it becomes (grey).
      assert.match(end, /haveChip: \{[^}]*backgroundColor: theme\.purpleLight/s);
      assert.match(end, /becomesChip: \{[^}]*backgroundColor: theme\.surfaceSoft/s);
      assert.doesNotMatch(end, /endButton: \{|lossNow: \{|lossWas: \{/);
      // One card holds the message and the one filled action; ending is a
      // quiet red text line under the card, with no date in it (owner,
      // 2026-10-15; one card and a text line, owner 2026-10-29).
      const page = end.slice(end.indexOf('styles.card}'), end.indexOf('function membershipEndCopy'));
      const keep = page.indexOf('styles.keepButton');
      const endLink = page.indexOf('styles.endLink');
      assert.ok(keep > 0 && endLink > keep, 'Keep first, the end line under it');
      assert.equal((page.match(/styles\.keepButton,/g) ?? []).length, 1, 'one filled button');
      assert.match(page, /\{t\(language, 'subs\.end\.cta'\)\}/);
      assert.doesNotMatch(page, /subs\.end\.ctaOn/);
      assert.match(end, /card: \{[^}]*backgroundColor: theme\.surface,/s);
      assert.doesNotMatch(end, /endLink: \{[^}]*border/s, 'the end line is text, not a second box');
      assert.match(end, /endLinkText: \{[^}]*color: theme\.danger/s);
      assert.match(end, /keepButton: \{[^}]*backgroundColor: theme\.highlight/s);
      // No filled red anywhere, and no fixed red: the danger token is themed
      // text, so the line clears contrast on the dark surface too.
      assert.doesNotMatch(end, /DANGER_FILL|backgroundColor: theme\.danger|#DC2626/i);
      // The losses only show for a renewing purchase (resolveMembershipEndCard).
      assert.match(page, /\{card\.showLosses \? \(/);
      // The end date is counted from the purchase instant, like the
      // subscription screen's — two screens must not name two dates.
      // The date is the one the entitlement will actually stop on — the end of
      // the CURRENT period, rolled forward through renewals. One period after
      // the purchase was months in the past for a subscriber who had renewed
      // (review 2026-09-03).
      assert.match(tab, /periodEndsAt=\{\s*proEntitlement\.purchaseEndsAt \?\?\s*renewingPeriodEndAt\(\s*preferences\.mockSubscriptionTerm,\s*preferences\.mockSubscriptionPurchasedAt \?\? MOCK_BILLING\.lastChargedAt,\s*preferences\.mockSubscriptionEndsAt,\s*\)\s*\}/);
      assert.ok(i18n.includes("'subs.end.keeps': 'Your log, programmes and records stay.'"));
      for (const key of [
        'subs.end.paidUntil',
        'subs.end.cta',
        'subs.end.ifEnd',
        'subs.end.cancelledTitle',
        'subs.end.cancelledBody',
        'membership.end.nothingTitle',
      ]) {
        assert.equal(i18n.split(`'${key}': '`).length - 1, 2, `${key} in EN and FI`);
      }
    },
  },
];
