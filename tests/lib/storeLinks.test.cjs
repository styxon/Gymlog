module.exports = [
  {
    name: 'store links: an iPhone is sent to the App Store, never to Google Play',
    run() {
      const assert = require('node:assert/strict');
      const links = require('../../src/lib/storeLinks');

      assert.equal(links.storePlatformOf('ios'), 'ios');
      assert.equal(links.storePlatformOf('android'), 'android');
      assert.equal(links.storePlatformOf('web'), 'android');

      for (const url of [links.manageSubscriptionsUrl('ios'), links.paymentMethodsUrl('ios')]) {
        assert.match(url, /^https:\/\/apps\.apple\.com\//);
      }
      assert.match(links.manageSubscriptionsUrl('android'), /^https:\/\/play\.google\.com\//);

      // The listing needs the id Apple assigns: none configured is no link, not Play's.
      assert.equal(links.storeListingUrl('ios', undefined), null);
      assert.equal(links.storeListingUrl('ios', 'https://play.google.com/x'), null);
      assert.equal(links.storeListingUrl('ios', ' https://apps.apple.com/app/id123 '), 'https://apps.apple.com/app/id123');
      assert.equal(links.storeListingUrl('android', undefined), links.PLAY_LISTING_URL);

      assert.equal(links.writeReviewUrl('ios', undefined), null);
      assert.equal(links.writeReviewUrl('ios', 'https://apps.apple.com/app/id123'), 'https://apps.apple.com/app/id123?action=write-review');
      assert.equal(links.writeReviewUrl('android', undefined), links.PLAY_LISTING_URL);

      assert.equal(links.inviteMessage('Join me', null), 'Join me');
      assert.equal(links.inviteMessage('Join me', 'https://x'), 'Join me\nhttps://x');

      // App Review 5.6.1: no custom review sheet in front of Apple's.
      assert.equal(links.usesSystemReviewPrompt('ios'), true);
      assert.equal(links.usesSystemReviewPrompt('android'), false);
    },
  },
  {
    name: 'store links: every Play wording has an Apple one in both languages, and Android keeps its own',
    run() {
      const assert = require('node:assert/strict');
      const { storeTextKey } = require('../../src/lib/storeLinks');
      const { t } = require('../../src/lib/i18n');
      const playKeys = ['subs.row.play', 'subs.row.playSub', 'subs.foot.play', 'subs.pay.gplay', 'subs.receipts.sub'];
      for (const key of playKeys) {
        assert.equal(storeTextKey(key, 'android'), key);
        const ios = storeTextKey(key, 'ios');
        assert.notEqual(ios, key, `${key} has no App Store wording`);
        for (const language of ['en', 'fi']) {
          const text = t(language, ios);
          assert.ok(text && text !== ios, `${ios} is missing in ${language}`);
          assert.doesNotMatch(text, /Google|Play/, `${ios} (${language}) still names Google Play`);
        }
      }
      // The invite text carries no hard-coded store link any more.
      for (const language of ['en', 'fi']) {
        assert.doesNotMatch(t(language, 'profile.inviteMessage'), /play\.google\.com/);
      }
    },
  },
];
