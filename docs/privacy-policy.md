# Moved

This file was an early draft (26 March 2026) and is **not** the privacy policy.
It still carried unfilled bracket placeholders for the publisher name and
support email, and predated the real documents, so it was replaced with this
pointer rather than left where a release could pick up the wrong version.

The policy now has one source of truth:

| | |
|---|---|
| **In code** | [`src/lib/legalDocuments.ts`](../src/lib/legalDocuments.ts) — rendered in-app by `LegalDocumentScreen` |
| **Published Markdown** | [`docs/legal/privacy.en.md`](legal/privacy.en.md), [`docs/legal/privacy.fi.md`](legal/privacy.fi.md) |
| **Terms** | [`docs/legal/terms.en.md`](legal/terms.en.md), [`docs/legal/terms.fi.md`](legal/terms.fi.md) |

Edit `legalDocuments.ts`, then regenerate the Markdown:

```bash
node scripts/export-legal.cjs
```

`tests/lib/legalDocuments.test.cjs` fails if the published Markdown and the
in-app text drift apart, and re-derives the policy's factual claims from the
code — four outbound request sites (coach, cloud backup, usage events, notice check), six storage keys, no third-party SDKs.
