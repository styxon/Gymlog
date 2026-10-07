import { AppLanguage } from '../types/models';
import type { LegalDocumentId } from './legalDocuments';

/**
 * Where the documents live on the web: styxon.fi's copy of what
 * scripts/build-legal-site.cjs writes (privacy, terms and the account
 * deletion page, each in Finnish and English).
 *
 * The app reads the documents from its own screen, offline and in the version
 * the reader accepts; these are for the reader who wants the web copy, and for
 * the deletion page the policy points at (user, 2026-10-05).
 */
export const LEGAL_SITE_URL = 'https://styxon.fi/vinha-fitness/legal';

export type LegalWebPage = LegalDocumentId | 'delete-account';

/** styxon.fi serves each page without its .html, which is how the policy text writes them. */
export function legalWebUrl(page: LegalWebPage, language: AppLanguage): string {
  return `${LEGAL_SITE_URL}/${page}.${language}`;
}

export interface LegalTextPart {
  text: string;
  /** Present when this part is a link: an https:// URL, or mailto: for an e-mail address. */
  url?: string;
}

/**
 * Top-level domains a bare address may end in. A bare "name.tld" is only a
 * link when the tld is one the texts actually use or could: otherwise "e.g."
 * and "v1.2" and a file name would be underlined.
 */
const BARE_TLDS = 'fi|com|app|eu|org|net|io|dev|se|no|dk|co\\.uk';

/**
 * One alternation, e-mail first so an address's own domain is not cut out of
 * it as a web address: an explicit URL, an e-mail address, or a bare domain
 * (optionally with a path, which is how the text writes the deletion page).
 * No lookbehind: Hermes on older devices does not run it.
 */
const LINK_PATTERN = new RegExp(
  [
    'https?:\\/\\/[^\\s<>"\']+',
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}',
    `\\b(?:[A-Za-z0-9-]+\\.)+(?:${BARE_TLDS})\\b(?:\\/[^\\s<>"']*)?`,
  ].join('|'),
  'gi',
);

/**
 * What a sentence puts after an address that is not part of it: its own full
 * stop, comma, colon, semicolon or closing bracket. A ")" stays when the
 * address opened one itself ("…/page_(1)"), which no address of ours does.
 */
function trimTrailingPunctuation(address: string): string {
  let end = address;
  for (;;) {
    const next = end.replace(/[.,:;!?'"]+$/, '');
    const unbalanced = next.endsWith(')') && !next.includes('(');
    const trimmed = unbalanced ? next.slice(0, -1) : next;
    if (trimmed === end) {
      return end;
    }
    end = trimmed;
  }
}

/**
 * The document text, cut into plain runs and the addresses inside it, so the
 * screen can make them tappable: styxon.fi pages and other web addresses
 * (opened over https), and e-mail addresses (opened with mailto:). The text
 * writes them bare ("styxon.fi/vinha-fitness/legal/delete-account.fi",
 * "privacy@vinha.app"), inside sentences and brackets; the punctuation around
 * one is not part of it. Nothing of the text is lost: the parts join back to it.
 */
export function splitLegalLinks(text: string): LegalTextPart[] {
  const parts: LegalTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    const address = trimTrailingPunctuation(match[0]);
    if (!address) {
      continue;
    }
    if (start > last) {
      parts.push({ text: text.slice(last, start) });
    }
    const url = address.includes('@') && !/^https?:\/\//i.test(address)
      ? `mailto:${address}`
      : /^https?:\/\//i.test(address)
        ? address
        : `https://${address}`;
    parts.push({ text: address, url });
    last = start + address.length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last) });
  }
  return parts;
}
