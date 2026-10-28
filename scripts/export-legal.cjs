#!/usr/bin/env node
/**
 * Renders the privacy policy and terms to Markdown for hosting.
 *
 * The published documents and the in-app documents come from the same data
 * (src/lib/legalDocuments.ts), so they cannot drift. Run this after any edit to
 * that file and commit the output.
 *
 *   node scripts/export-legal.cjs
 */
require('./registerTs.cjs');
const fs = require('node:fs');
const path = require('node:path');

const { buildLegalDocument, renderLegalDocumentMarkdown } = require(path.join(__dirname, '..', 'src', 'lib', 'legalDocuments'));

const outDir = path.join(__dirname, '..', 'docs', 'legal');
fs.mkdirSync(outDir, { recursive: true });

const written = [];
for (const id of ['privacy', 'terms']) {
  for (const language of ['en', 'fi']) {
    const markdown = renderLegalDocumentMarkdown(buildLegalDocument(id, language));
    const file = path.join(outDir, `${id}.${language}.md`);
    fs.writeFileSync(file, markdown, 'utf8');
    written.push(path.relative(path.join(__dirname, '..'), file));
  }
}

console.log(`Wrote ${written.length} files:`);
for (const file of written) console.log(`  ${file}`);
