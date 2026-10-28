# SQLite plan, PR 0: what a long history costs today

Measurement only. No behaviour changed, nothing native added. These are the
numbers the SQLite mirror (plan phase A) is judged against.

**Node, not the phone.** Everything below ran in Node 24.15 on a desktop CPU
(i7-13700K). Hermes on the phone has no JIT and is roughly 20x slower
(CLAUDE.md), so multiply by about 20 for a rough guide. It is a guide, not a
measurement; the phone's own figure is still to be taken (last section).

## What was measured

`npm run measure:history` (`scripts/measure-history-load.cjs`). For each size it
builds a seeded, generated history (`src/lib/historyFixture.ts`: no real data),
writes it through the real `saveDatabase` into an in-memory AsyncStorage stub
that refuses rows over 2 MB the way Android does, and reports the median of 7
runs after one warm-up:

- **blob**: bytes written under `@vinha/database/v1`, and how many parts
  `largeItem` split it into
- **parse**: `JSON.parse` of the blob
- **normalize**: `normalizeDatabase` on the parsed object
- **stringify**: `JSON.stringify` of the five history collections (where a
  content hash or a mirror write starts)
- **save**: `saveDatabase` (stringify, split, write to the stub)
- **load**: the whole `loadDatabase` path (read parts, parse, normalize,
  preferences overlay, reconcile)

The fixture has about 6 logs per session, 3 to 4 sets each, bodyweight every
third day, a measurement each week and a cardio session every fifth session. It
comes to about 6.7 KB per session; the plan estimated 8 KB. The generated
history normalises to itself (`tests/lib/historyFixture.test.cjs`).

## Numbers (Node, ms)

| Sessions | Logs | Blob | Parts | Parse | Normalize | Stringify | Save | Load |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 300 | 1,772 | 1.98 MB | 9 | 3.6 | 7.3 | 2.7 | 2.7 | 11.6 |
| 1,000 | 5,968 | 6.66 MB | 28 | 11.7 | 14.6 | 9.2 | 9.3 | 31.4 |
| 3,000 | 17,970 | 20.09 MB | 83 | 39.8 | 39.7 | 30.6 | 30.4 | 92.7 |

Run to run the figures move by a few tenths of a millisecond at 300 sessions
and a few milliseconds at 3,000.

What they say, before any phone figure:

- The blob is already past Android's 2 MB row limit at 300 sessions (about 9
  parts); the plan's "24 MB at 3,000 sessions" is 20 MB here.
- Cost is linear in sessions: parse, normalize, stringify and save each cost
  about 10 to 13 ms per 1,000 sessions in Node, and a full load about 31 ms.
- Times 20, a 3,000-session load is on the order of 1.9 s on Hermes, of which
  parse and normalize are roughly 0.8 s each. A hash or mirror pass that
  stringifies everything would add about 0.6 s on the same scale. These are
  extrapolations; nothing here proves them.
- A save re-stringifies the whole history on every commit (about 30 ms Node at
  3,000 sessions, so about 0.6 s extrapolated).

## Duplicate ids and the real data

`npm run scan:history -- <file>` (`scripts/scan-history-ids.cjs`, logic in
`src/lib/historyIdScan.ts`) reads one local file you name: an AppDatabase JSON,
an account backup payload, either gzip-compressed, or the app's own compressed
envelope. It prints counts only, per collection: rows, duplicate ids, rows
missing an id, a date or a sessionId, logs whose session is not in the file,
and whether the list runs newest-first. It never prints a row, an id or a note.

It was run here only on generated files, to check the three input formats. It
has **not** been run on the owner's export, so the plan's open question
"does the corpus contain duplicate ids" is still open. To answer it: export a
backup, then run the command on that file. The fixture history has none, so a
non-zero count in the real file is real.

## Still needs the phone

- **Cold start with a long history**: `npm run measure:startup` after an APK
  install (fails over 3.5 s; 2.4 s on the Galaxy A54 reference). Run it on an
  install whose history is long, or with the synthetic over-2 MB history the
  plan's device list calls for. The Node numbers above cannot stand in for it.
- **The Hermes load, hash and first-build times** the plan lists as unverified:
  parse, normalize and stringify of 300, 1,000 and 3,000 sessions on the phone,
  and what a content hash costs there (plan decision 7: over 300 ms means
  verify only every fifth launch).
- **Responsiveness while a first mirror build runs** (idle work after first
  render).
