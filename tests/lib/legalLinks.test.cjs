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
    // M15 (2026-10-06): the splitter knew only styxon.fi, so the e-mail
    // addresses the policy tells a reader to write to, and the authorities'
    // sites, were plain text.
    name: 'legal links: e-mail addresses and web addresses are cut out, punctuation left behind',
    run() {
      const linked = (text) => splitLegalLinks(text).filter((part) => part.url).map((part) => [part.text, part.url]);
      assert.deepEqual(linked('Write to privacy@vinha.app.'), [['privacy@vinha.app', 'mailto:privacy@vinha.app']]);
      assert.deepEqual(linked('(tietosuoja@om.fi), or tietosuoja.fi, or kkv.fi).'), [
        ['tietosuoja@om.fi', 'mailto:tietosuoja@om.fi'],
        ['tietosuoja.fi', 'https://tietosuoja.fi'],
        ['kkv.fi', 'https://kkv.fi'],
      ]);
      assert.deepEqual(linked('See https://styxon.fi/vinha-fitness/legal/terms.en, then stop.'), [
        ['https://styxon.fi/vinha-fitness/legal/terms.en', 'https://styxon.fi/vinha-fitness/legal/terms.en'],
      ]);
      // An address's own domain is not a second link inside it.
      assert.equal(linked('privacy@vinha.app').length, 1);
      // Not addresses.
      assert.deepEqual(linked('For example, e.g. version 1.2 of the app, i.e. now.'), []);
      for (const text of ['', 'privacy@vinha.app', 'a kkv.fi b privacy@vinha.app c']) {
        assert.equal(splitLegalLinks(text).map((part) => part.text).join(''), text);
      }
    },
  },
  {
    // Run over the strings the app really shows, not over a sample written to
    // suit the splitter: every address-shaped token in them must be a link.
    name: 'legal links: every e-mail and web address in the real legal texts is a link',
    run() {
      const expected = new Map([
        ['privacy@vinha.app', 'mailto:privacy@vinha.app'],
        ['tietosuoja@om.fi', 'mailto:tietosuoja@om.fi'],
        ['tietosuoja.fi', 'https://tietosuoja.fi'],
        ['kuluttajariita.fi', 'https://kuluttajariita.fi'],
        ['kkv.fi', 'https://kkv.fi'],
        ['styxon.fi/vinha-fitness/legal/delete-account.fi', 'https://styxon.fi/vinha-fitness/legal/delete-account.fi'],
        ['styxon.fi/vinha-fitness/legal/delete-account.en', 'https://styxon.fi/vinha-fitness/legal/delete-account.en'],
      ]);
      const seen = new Map();
      const addressShaped = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|\b(?:[A-Za-z0-9-]+\.)+(?:fi|com|app|eu|org|net|io|dev)\b(?:\/[^\s,;:)]*)?/g;
      for (const line of everyLine()) {
        const parts = splitLegalLinks(line);
        assert.equal(parts.map((part) => part.text).join(''), line, 'nothing of the text is lost');
        const linkedTexts = new Set(parts.filter((part) => part.url).map((part) => part.text));
        for (const part of parts) {
          if (part.url) {
            seen.set(part.text, part.url);
          }
        }
        for (const match of line.matchAll(addressShaped)) {
          const token = match[0].replace(/[.:]+$/, '');
          assert.ok(linkedTexts.has(token), `${token} is in the text but is not a link: ${line}`);
        }
      }
      assert.deepEqual(Object.fromEntries(seen), Object.fromEntries(expected));
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
          if (part.url && part.url.startsWith('https:') && new URL(part.url).hostname === 'styxon.fi') {
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
