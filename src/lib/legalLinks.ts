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
  /** Present when this part is an address: the https:// URL it opens. */
  url?: string;
}

/**
 * The document text, cut into plain runs and the styxon.fi addresses inside
 * it, so the screen can make the addresses tappable. The text writes them bare
 * ("styxon.fi/vinha-fitness/legal/delete-account.fi"); a sentence's own full
 * stop or colon after one is not part of it.
 */
export function splitLegalLinks(text: string): LegalTextPart[] {
  const parts: LegalTextPart[] = [];
  const pattern = /(?:https:\/\/)?styxon\.fi\/[^\s,;)]+/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const address = match[0].replace(/[.:]+$/, '');
    if (start > last) {
      parts.push({ text: text.slice(last, start) });
    }
    parts.push({ text: address, url: address.startsWith('https://') ? address : `https://${address}` });
    last = start + address.length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last) });
  }
  return parts;
}
