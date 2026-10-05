import { getLargeItem, removeLargeItem, setLargeItem } from './largeItem';

/**
 * Where an unreadable blob is set aside before an empty one replaces it.
 *
 * It was one key. A second unreadable blob — later, after the reader had
 * trained again on the empty database the first one left — was written over
 * the copy of the first, which could be the only copy of a long history left
 * anywhere (bug hunt, 2026-10-05). The workout aside slots never write over a
 * copy that holds something; these follow them: the first free slot of five,
 * `<key>`, `<key>/2` … `<key>/5`, and only once all five are taken does the
 * last one give way, so the oldest copies are the ones that stay.
 */
export const CORRUPT_COPY_SLOTS = 5;

function slotKey(base: string, index: number): string {
  return index === 0 ? base : `${base}/${index + 1}`;
}

/**
 * Keeps `raw` in the first free slot. A write that fails goes up, as the single
 * key's did: the caller's load then fails instead of opening on an empty
 * database that would sweep the only copy.
 */
export async function setAsideCorruptCopy(base: string, raw: string): Promise<void> {
  for (let index = 0; index < CORRUPT_COPY_SLOTS - 1; index += 1) {
    const key = slotKey(base, index);
    let held: string | null;
    try {
      held = await getLargeItem(key);
    } catch {
      // A copy whose parts are damaged is still somebody's copy: skip it.
      continue;
    }
    if (held === null) {
      await setLargeItem(key, raw);
      return;
    }
    if (held === raw) {
      // The same bytes again (a retried load): kept already.
      return;
    }
  }
  await setLargeItem(slotKey(base, CORRUPT_COPY_SLOTS - 1), raw);
}

/** Reset erases every slot: a reader who asks for their data gone means all of it. */
export async function removeCorruptCopies(base: string): Promise<void> {
  for (let index = 0; index < CORRUPT_COPY_SLOTS; index += 1) {
    await removeLargeItem(slotKey(base, index));
  }
}
