const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { LEGAL_SITE_URL, legalWebUrl, splitLegalLinks } = require('../../.test-dist/lib/legalLinks.js');
const { buildLegalDocument } = require('../../.test-dist/lib/legalDocuments.js');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** Every line a reader can get, on every platform, in both languages. */
function everyLine() {
  const lines = [];
  for (const platform of ['android', 'ios', 'both']) {
    for (const id of ['privacy', 'terms']) {
      for (const language of ['fi', 'en']) {
        const doc = buildLegalDocument(id, language, platform);
        lines.push(doc.summary);
        for (const section of doc.sections) {
          lines.push(...(section.body ?? []), ...(section.bullets ?? []));
        }
      }
    }
  }
  return lines;
}

/**
 * The legal screen links to the web copy and makes the addresses in the text
 * tappable (user, 2026-10-05). The documents themselves stay in the app.
 */
module.exports = [
  {
    name: 'legal links: an address in a sentence is cut out without the sentence’s own colon or full stop',
    run() {
      const text = 'Without the app, use styxon.fi/vinha-fitness/legal/delete-account.fi: sign in there. Or styxon.fi/vinha-fitness/legal/privacy.en.';
      const parts = splitLegalLinks(text);
      assert.equal(parts.map((part) => part.text).join(''), text, 'nothing of the sentence is lost');
      const links = parts.filter((part) => part.url);
      assert.deepEqual(
        links.map((part) => part.url),
        ['https://styxon.fi/vinha-fitness/legal/delete-account.fi', 'https://styxon.fi/vinha-fitness/legal/privacy.en'],
      );
      assert.deepEqual(splitLegalLinks('No address here.'), [{ text: 'No address here.' }]);
    },
  },
  {
    name: 'legal links: every styxon.fi address the documents name is a page the site build writes',
    run() {
      // The pages scripts/build-legal-site.cjs writes, each in both languages.
      const pages = ['privacy', 'terms', 'delete-account'];
      const known = new Set(pages.flatMap((page) => ['fi', 'en'].map((language) => legalWebUrl(page, language))));
      const found = new Set();
      for (const line of everyLine()) {
        for (const part of splitLegalLinks(line)) {
          if (part.url) {
            found.add(part.url);
          }
        }
      }
      assert.ok(found.size > 0, 'the policy names the deletion page');
      for (const url of found) {
        assert.ok(known.has(url), `${url} is not a page of ${LEGAL_SITE_URL}`);
      }

      // And the build writes exactly those pages: privacy and terms, then the deletion page.
      const build = read('scripts', 'build-legal-site.cjs');
      assert.match(build, /for \(const id of \['privacy', 'terms'\]\)[\s\S]*?const file = `\$\{id\}\.\$\{language\}\.html`;/);
      assert.match(build, /const file = `delete-account\.\$\{language\}\.html`;/);
    },
  },
  {
    name: 'legal links: the screen opens the same document on the web, and the addresses in the text',
    run() {
      const screen = read('src', 'screens', 'LegalDocumentScreen.tsx');
      assert.match(screen, /onPress=\{\(\) => open\(legalWebUrl\(document, language\)\)\}/);
      assert.match(screen, /t\(language, 'legal\.readOnWeb'\)/);
      assert.match(screen, /\{withLinks\(paragraph\)\}/);
      assert.match(screen, /\{withLinks\(bullet\)\}/);
      // A failed open (no browser) is not an unhandled rejection.
      assert.match(screen, /Linking\.openURL\(url\)\.catch\(\(\) => undefined\)/);
      const { t } = require('../../.test-dist/lib/i18n.js');
      assert.equal(t('fi', 'legal.readOnWeb'), 'Lue verkossa');
      assert.equal(t('en', 'legal.readOnWeb'), 'Read on the web');
    },
  },
];
