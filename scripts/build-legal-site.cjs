#!/usr/bin/env node
/**
 * Renders the privacy policy and terms as a small static site for GitHub
 * Pages — the public URL the Play listing points at.
 *
 * Same one-truth pipeline as export-legal.cjs: the HTML is rendered from
 * src/lib/legalDocuments.ts, not parsed out of the Markdown exports, so the
 * published page cannot drift from the in-app documents. When the real
 * homepage exists, these pages move there and the Play listing's URL field
 * is updated — nothing here is load-bearing beyond serving that URL.
 *
 *   node scripts/build-legal-site.cjs        # writes dist-legal/
 */
require('./registerTs.cjs');
const fs = require('node:fs');
const path = require('node:path');

const { LEGAL_ENTITY, buildLegalDocument } = require(path.join(__dirname, '..', 'src', 'lib', 'legalDocuments'));
const { buildAccountDeletionPage } = require(path.join(__dirname, '..', 'src', 'lib', 'accountDeletionPage'));
const { WEB_DELETION_ENDPOINT } = require(path.join(__dirname, '..', 'src', 'lib', 'webAccountDeletion'));

// LEGAL_SITE_OUT_DIR: the tests build into a temporary directory.
const outDir = process.env.LEGAL_SITE_OUT_DIR || path.join(__dirname, '..', 'dist-legal');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Manrope from the app's own bundle, served beside the pages: a font from Google's servers would hand every
// reader's IP address to Google on the privacy policy itself, which says the deletion page's sign-in is the only
// thing loaded from Google (bug hunt 5, 2026-10-03). The variable file covers every weight the pages use.
fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'assets', 'fonts', 'Manrope.ttf'), path.join(outDir, 'fonts', 'Manrope.ttf'));

const escapeHtml = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// styxon.fi's look (the site these pages live on): its colour tokens, Manrope,
// the same top bar and footer. Orange is what you press, violet is the brand.
const STYLE = `
  @font-face { font-family: Manrope; src: url('fonts/Manrope.ttf') format('truetype'); font-weight: 200 800; font-display: swap; }
  :root { --bg: #15131f; --bg2: #1c1830; --line: #2c2740; --fg: #ece9f5; --fg2: #cfcadf; --mut: #9a95ad; --acc: #ff7a3d; --vio2: #a78bfa; --danger: #f04438; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg2); font-family: Manrope, system-ui, sans-serif; font-size: 17px; line-height: 1.65; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 44rem; margin: 0 auto; padding: 0 24px; }
  header.top { border-bottom: 1px solid var(--line); }
  header.top .wrap { display: flex; align-items: center; gap: 10px; height: 64px; max-width: 1080px; font-size: 15px; }
  header.top a { color: var(--fg); text-decoration: none; }
  .wm { font-weight: 700; letter-spacing: -0.02em; }
  .wm span { font-weight: 300; color: var(--mut); }
  .sep { color: var(--line); }
  .wm.vinha span { font-weight: 700; color: var(--vio2); }
  main { padding: 48px 0 72px; }
  h1 { color: var(--fg); font-size: clamp(30px, 6vw, 44px); line-height: 1.1; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 12px; }
  h2 { color: var(--fg); font-size: 20px; line-height: 1.3; font-weight: 700; letter-spacing: -0.01em; margin: 40px 0 10px; }
  p { margin: 10px 0; }
  ul, ol { margin: 10px 0; padding-left: 1.3rem; }
  li { margin: 6px 0; }
  li::marker { color: var(--vio2); }
  ol li::marker { font-weight: 700; }
  .updated { color: var(--mut); font-size: 14px; margin: 0 0 20px; }
  .summary { color: var(--fg); font-size: 19px; }
  a { color: var(--vio2); }
  a:hover { color: var(--acc); }
  nav { margin-bottom: 40px; }
  footer { border-top: 1px solid var(--line); padding: 28px 0 44px; color: var(--mut); font-size: 14px; }
  footer .wrap { display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; max-width: 1080px; }
  footer a { color: var(--mut); }
  .web-delete { margin: 20px 0 8px; padding: 20px; background: var(--bg2); border: 1px solid var(--line); border-radius: 12px; }
  .web-delete button { font: inherit; font-size: 15px; font-weight: 600; padding: 9px 16px; margin: 4px 8px 4px 0; border: 1px solid var(--mut); border-radius: 8px; background: transparent; color: var(--fg); cursor: pointer; }
  .web-delete button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
  .web-delete button:disabled { opacity: 0.5; cursor: default; }
  #confirm-text { color: var(--fg); }
  #status { font-weight: 700; color: var(--fg); margin-bottom: 0; }
  #status:empty { display: none; }
`;

const FONTS = `<link rel="preload" href="fonts/Manrope.ttf" as="font" type="font/ttf" crossorigin>`;

// Absolute links: the same pages are also served from GitHub Pages, where a
// root-relative "/" would not be styxon.fi.
function page(language, title, body) {
  const { name, businessId, country, countryFi } = LEGAL_ENTITY;
  const company = `${name} · ${language === 'fi' ? 'Y-tunnus' : 'Business ID'} ${businessId} · ${language === 'fi' ? countryFi : country}`;
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="https://styxon.fi/assets/favicon.ico">
${FONTS}
<style>${STYLE}</style>
</head>
<body>
<header class="top"><div class="wrap">
<a class="wm" href="https://styxon.fi/">Styxon <span>Studio</span></a>
<span class="sep" aria-hidden="true">/</span>
<a class="wm vinha" href="https://styxon.fi/vinha-fitness/">Vinha <span>Fitness</span></a>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer><div class="wrap">
<span>${escapeHtml(company)}</span>
<span>© 2026 ${escapeHtml(LEGAL_ENTITY.name)}</span>
</div></footer>
</body>
</html>
`;
}

function renderDocument(id, language) {
  const doc = buildLegalDocument(id, language);
  const sections = doc.sections
    .map((section) => {
      const paragraphs = (section.body ?? []).map((text) => `<p>${escapeHtml(text)}</p>`).join('\n');
      const bullets = section.bullets?.length
        ? `<ul>\n${section.bullets.map((text) => `<li>${escapeHtml(text)}</li>`).join('\n')}\n</ul>`
        : '';
      return `<h2>${escapeHtml(section.heading)}</h2>\n${paragraphs}\n${bullets}`;
    })
    .join('\n');

  const body = `<h1>${escapeHtml(doc.title)}</h1>
<p class="updated">${escapeHtml(doc.updatedLabel)}</p>
<p class="summary">${escapeHtml(doc.summary)}</p>
${sections}`;

  return page(language, `${doc.title} – Vinha`, body);
}

// The account deletion page. Its first section deletes from the browser
// (src/lib/webAccountDeletion.ts): Google signs the reader in on the page,
// and the page sends the app's own Delete account request. The Google client
// id is the app's Web client — public, it ships in every APK — read from the
// environment or .env.local. Without it the deletion pages are not built at
// all (LEGAL_SITE_WITHOUT_WEB_DELETION=1, the GitHub Pages copy), never built
// without the form Play asks for.
function googleWebClientId() {
  const fromEnv = (process.env.GOOGLE_WEB_CLIENT_ID ?? process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  const envFile = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envFile)) return '';
  const line = fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID='));
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
}

/** A value for an inline script: JSON, with `<` escaped so no text can close the tag. */
const inlineJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

function webDeletionForm(language, doc, clientId) {
  const config = {
    clientId,
    endpoint: WEB_DELETION_ENDPOINT,
    action: 'delete-account',
    language,
    text: doc.web,
  };
  return `<div class="web-delete">
<noscript><p>${escapeHtml(doc.web.noScript)}</p></noscript>
<div id="gsi-button"></div>
<div id="confirm" hidden>
<p id="confirm-text"></p>
<button type="button" id="confirm-yes" class="danger">${escapeHtml(doc.web.confirmButton)}</button>
<button type="button" id="confirm-no">${escapeHtml(doc.web.cancelButton)}</button>
</div>
<p id="status" role="status" aria-live="polite"></p>
</div>
<script>
(function () {
  var C = ${inlineJson(config)};
  var token = null;
  var email = '';
  var $ = function (id) { return document.getElementById(id); };
  function say(text) { $('status').textContent = text || ''; }
  function claims(jwt) {
    var part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (part.length % 4) part += '=';
    var bytes = Uint8Array.from(atob(part), function (c) { return c.charCodeAt(0); });
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function reset() {
    token = null;
    $('confirm').hidden = true;
    $('gsi-button').hidden = false;
    $('confirm-yes').disabled = false;
    $('confirm-no').disabled = false;
  }
  function onCredential(response) {
    try {
      token = response.credential;
      email = claims(token).email || '';
    } catch (error) {
      reset();
      say(C.text.signInFailed);
      return;
    }
    // A function, not the string: a replacement string reads $& and $' in the address as patterns.
    $('confirm-text').textContent = C.text.confirm.replace('{email}', function () { return email; });
    $('gsi-button').hidden = true;
    $('confirm').hidden = false;
    say('');
  }
  $('confirm-no').addEventListener('click', function () { reset(); say(''); });
  $('confirm-yes').addEventListener('click', function () {
    if (!token) return;
    $('confirm-yes').disabled = true;
    $('confirm-no').disabled = true;
    say(C.text.working);
    fetch(C.endpoint, {
      method: 'DELETE',
      headers: { authorization: 'Bearer ' + token, 'x-backup-action': C.action },
    })
      .then(function (answer) {
        // Done is said only once the server has answered that it is done.
        if (answer.ok) {
          var deleted = email;
          reset();
          $('gsi-button').hidden = true;
          say(C.text.done.replace('{email}', function () { return deleted; }));
          return;
        }
        reset();
        say(answer.status === 401 ? C.text.refused : answer.status === 429 ? C.text.rateLimited : C.text.failed);
      })
      .catch(function () { reset(); say(C.text.failed); });
  });
  window.vinhaGoogleLoaded = function () {
    google.accounts.id.initialize({ client_id: C.clientId, callback: onCredential, auto_select: false });
    google.accounts.id.renderButton($('gsi-button'), { theme: 'filled_black', size: 'large', text: 'signin_with', locale: C.language });
  };
  window.vinhaGoogleFailed = function () { say(C.text.signInFailed); };
})();
</script>
<script src="https://accounts.google.com/gsi/client" async onload="vinhaGoogleLoaded()" onerror="vinhaGoogleFailed()"></script>`;
}

// Numbered steps, then what goes and what stays.
function renderDeletionPage(language, clientId) {
  const doc = buildAccountDeletionPage(language);
  const sections = doc.sections
    .map((section) => {
      const steps = section.steps?.length
        ? `<ol>\n${section.steps.map((text) => `<li>${escapeHtml(text)}</li>`).join('\n')}\n</ol>`
        : '';
      const paragraphs = (section.body ?? []).map((text) => `<p>${escapeHtml(text)}</p>`).join('\n');
      const bullets = section.bullets?.length
        ? `<ul>\n${section.bullets.map((text) => `<li>${escapeHtml(text)}</li>`).join('\n')}\n</ul>`
        : '';
      const form = section.webDeletion ? webDeletionForm(language, doc, clientId) : '';
      return `<h2>${escapeHtml(section.heading)}</h2>\n${steps}\n${paragraphs}\n${form}\n${bullets}`;
    })
    .join('\n');
  const privacy = buildLegalDocument('privacy', language).title;
  const body = `<h1>${escapeHtml(doc.title)}</h1>
<p class="summary">${escapeHtml(doc.summary)}</p>
${sections}
<p><a href="privacy.${language}.html">${escapeHtml(privacy)}</a></p>`;
  return page(language, doc.title, body);
}

const written = [];
const titles = {};
for (const id of ['privacy', 'terms']) {
  for (const language of ['fi', 'en']) {
    const file = `${id}.${language}.html`;
    fs.writeFileSync(path.join(outDir, file), renderDocument(id, language), 'utf8');
    titles[file] = buildLegalDocument(id, language).title;
    written.push(file);
  }
}

const clientId = googleWebClientId();
const withDeletion = clientId !== '';
if (!withDeletion && process.env.LEGAL_SITE_WITHOUT_WEB_DELETION !== '1') {
  console.error(
    'No Google Web client id (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env.local, or GOOGLE_WEB_CLIENT_ID): the account deletion page needs it.\n' +
      'Set LEGAL_SITE_WITHOUT_WEB_DELETION=1 to build the documents without the deletion pages.',
  );
  process.exit(1);
}
if (withDeletion) {
  for (const language of ['fi', 'en']) {
    const file = `delete-account.${language}.html`;
    fs.writeFileSync(path.join(outDir, file), renderDeletionPage(language, clientId), 'utf8');
    titles[file] = buildAccountDeletionPage(language).title;
    written.push(file);
  }
}
const deletionLink = (language) =>
  withDeletion
    ? `\n<li><a href="delete-account.${language}.html">${escapeHtml(titles[`delete-account.${language}.html`])}</a></li>`
    : '';

// The landing page the Play listing can point at directly. Finnish first,
// because that is the app's first language.
const indexBody = `<h1>Vinha</h1>
<p class="summary">Sovelluksen oikeudelliset dokumentit / the app's legal documents.</p>
<nav>
<h2>Suomeksi</h2>
<ul>
<li><a href="privacy.fi.html">${escapeHtml(titles['privacy.fi.html'])}</a></li>
<li><a href="terms.fi.html">${escapeHtml(titles['terms.fi.html'])}</a></li>${deletionLink('fi')}
</ul>
<h2>In English</h2>
<ul>
<li><a href="privacy.en.html">${escapeHtml(titles['privacy.en.html'])}</a></li>
<li><a href="terms.en.html">${escapeHtml(titles['terms.en.html'])}</a></li>${deletionLink('en')}
</ul>
</nav>`;
fs.writeFileSync(path.join(outDir, 'index.html'), page('fi', 'Vinha – dokumentit', indexBody), 'utf8');
written.push('index.html');

console.log(`Wrote ${written.length} files to dist-legal/:`);
for (const file of written) console.log(`  ${file}`);
