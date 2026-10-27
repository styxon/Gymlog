/**
 * Supersets, as one idea shared by every list of exercises in the app.
 *
 * A superset is two or more lifts done back to back with no rest between
 * them. The app had no notion of pairing at all — the word appeared six times
 * in the tree and every one of them was something else, a lift whose NAME is
 * "Lateral Raise Superset" and Hevy's `superset_id` column the import skips.
 * So this is not a screen behaviour: the programme day, the guided player and
 * the free workout each hold a list of exercises, and unless all three read
 * the same rule the app ends up with two different ideas of what a superset
 * is — and the programme side is where people actually train.
 *
 * The rule, in one sentence: a group is a run of ADJACENT exercises sharing
 * one group id, and rest belongs after the run, not inside it.
 *
 * Adjacency is what makes the concept survive everything else the lists do.
 * A row can be reordered, removed, swapped or skipped by code that knows
 * nothing about supersets; if the pairing were a free-floating id, those
 * edits would leave a pair whose halves sit five rows apart, and every
 * consumer would have to decide separately what that means. Here it means
 * nothing: `normalizeSupersetGroups` is run on load and after every edit, and
 * a group that is no longer adjacent is no longer a group.
 */
import { createId } from './ids';

/** Anything a list holds that can carry a pairing. */
interface SupersetMember {
  supersetGroup?: string | null;
}

/**
 * One run of the list: either a group of adjacent members sharing an id, or a
 * single exercise standing on its own (`groupId: null`).
 *
 * Every member of the source list appears in exactly one run, in order, so a
 * caller can rebuild the list from the runs without consulting the original.
 */
interface SupersetRun {
  groupId: string | null;
  /** Indexes into the source list, ascending and contiguous. */
  indexes: number[];
}

/**
 * Where one exercise sits in its group.
 *
 * No letter and no 'A1': the screens draw a superset as one box with one label
 * on it, so a badge per row would state the same fact once per line. That was
 * the first shape this shipped in, and the reader asked for the box instead
 * (2026-09-11).
 */
interface SupersetPosition {
  groupId: string | null;
  /** How many exercises the group holds. 1 when the row is not in a group. */
  size: number;
  /** True for every member but the last: what follows is the next lift, not a rest. */
  hasNextInGroup: boolean;
}

function groupIdOf(member: SupersetMember | undefined): string | null {
  const raw = member?.supersetGroup;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * The list as runs of adjacent same-group members.
 *
 * Adjacency is read here and nowhere else, so "what counts as one superset"
 * has a single answer. A lone member carrying a group id still comes back as
 * a run of one with its id intact — `normalizeSupersetGroups` is what decides
 * that such an id should be dropped, and it is built on top of this.
 */
export function buildSupersetRuns(members: readonly SupersetMember[]): SupersetRun[] {
  const runs: SupersetRun[] = [];

  members.forEach((member, index) => {
    const groupId = groupIdOf(member);
    const previous = runs[runs.length - 1];

    if (groupId !== null && previous && previous.groupId === groupId && previous.indexes[previous.indexes.length - 1] === index - 1) {
      previous.indexes.push(index);
      return;
    }

    runs.push({ groupId, indexes: [index] });
  });

  return runs;
}

/**
 * Drop pairings the list no longer supports, and keep the ones it does.
 *
 * Two things are repaired here, both of them consequences of edits made by
 * code that does not know about supersets:
 *
 *   - A group id left on a single row is not a superset. Somebody removed,
 *     reordered or skipped its partner, and a lift labelled "A1" with no A2
 *     under it is a promise the player cannot keep.
 *   - The same id on two runs that are no longer adjacent is two supersets
 *     wearing one name. The first run keeps the id; later runs are re-issued,
 *     so a later edit to one cannot silently reach into the other.
 *
 * Called on load (old installs know nothing of the field) and after every
 * edit. Returns the same array instance when nothing changed, so a caller can
 * use it as a "did anything move" check.
 */
export function normalizeSupersetGroups<T extends SupersetMember>(
  members: readonly T[],
  makeId: () => string = () => createId('superset'),
): T[] {
  const runs = buildSupersetRuns(members);
  const seen = new Set<string>();
  // What each row's id SHOULD be once the rules have had their say. Compared
  // against the raw stored value rather than against the trimmed one, so a
  // row carrying "  " or a number from an older install is rewritten to null
  // instead of quietly keeping a value no reader would recognise.
  const desired = new Map<number, string | null>();

  runs.forEach((run) => {
    if (run.groupId === null || run.indexes.length < 2) {
      run.indexes.forEach((index) => desired.set(index, null));
      return;
    }

    if (!seen.has(run.groupId)) {
      seen.add(run.groupId);
      run.indexes.forEach((index) => desired.set(index, run.groupId));
      return;
    }

    const reissued = makeId();
    seen.add(reissued);
    run.indexes.forEach((index) => desired.set(index, reissued));
  });

  const changed = members.some((member, index) => (member.supersetGroup ?? null) !== desired.get(index));
  if (!changed) {
    return members as T[];
  }

  return members.map((member, index) =>
    (member.supersetGroup ?? null) === desired.get(index)
      ? member
      : { ...member, supersetGroup: desired.get(index) ?? null },
  );
}

/**
 * Where each row stands, aligned with the input list index for index.
 *
 * What a row needs to know about its own pairing is whether it HAS one and
 * whether a lift follows it inside it — the first decides whether the row is
 * drawn inside a box, the second whether a rest follows the row or the next
 * lift does.
 */
export function supersetPositions(members: readonly SupersetMember[]): SupersetPosition[] {
  const runs = buildSupersetRuns(normalizeSupersetGroups(members));
  const positions: SupersetPosition[] = new Array(members.length);

  runs.forEach((run) => {
    if (run.groupId === null || run.indexes.length < 2) {
      run.indexes.forEach((index) => {
        positions[index] = { groupId: null, size: 1, hasNextInGroup: false };
      });
      return;
    }

    run.indexes.forEach((index, orderIndex) => {
      positions[index] = {
        groupId: run.groupId,
        size: run.indexes.length,
        hasNextInGroup: orderIndex < run.indexes.length - 1,
      };
    });
  });

  return positions;
}

/** Whether the row at `index` runs straight into the row below it. */
export function isSupersetLinked(members: readonly SupersetMember[], index: number): boolean {
  if (index < 0 || index >= members.length - 1) {
    return false;
  }

  const groupId = groupIdOf(members[index]);
  return groupId !== null && groupId === groupIdOf(members[index + 1]);
}

/**
 * Link or unlink the boundary between the row at `index` and the row below it.
 *
 * The link, not the row, is the thing the reader acts on — "these two run
 * together" is a statement about a gap, and a gap has exactly two states.
 * Modelling it as a property of a row instead ("pair this with something")
 * needs a second question the moment a group holds three lifts.
 *
 * Linking joins whatever runs the two rows already belong to, so linking the
 * bottom of an A1/A2 pair to the row under it makes a group of three rather
 * than a second pair. Unlinking cuts the run at that gap and leaves both
 * halves standing on their own — a half that drops to one member loses its id
 * in `normalizeSupersetGroups`, which every return here passes through.
 */
export function setSupersetLink<T extends SupersetMember>(
  members: readonly T[],
  index: number,
  linked: boolean,
  makeId: () => string = () => createId('superset'),
): T[] {
  if (index < 0 || index >= members.length - 1) {
    return members as T[];
  }

  if (isSupersetLinked(members, index) === linked) {
    return members as T[];
  }

  if (linked) {
    const groupId = groupIdOf(members[index]) ?? groupIdOf(members[index + 1]) ?? makeId();
    const from = runStart(members, index);
    const to = runEnd(members, index + 1);
    return normalizeSupersetGroups(
      members.map((member, memberIndex) =>
        memberIndex >= from && memberIndex <= to ? { ...member, supersetGroup: groupId } : member,
      ),
      makeId,
    );
  }

  // The tail keeps training together; it just stops being the same superset
  // as the head, so it needs a name of its own before normalization decides
  // the two runs are one group split in half.
  const tailStart = index + 1;
  const tailEnd = runEnd(members, tailStart);
  const tailId = tailEnd > tailStart ? makeId() : null;

  return normalizeSupersetGroups(
    members.map((member, memberIndex) =>
      memberIndex >= tailStart && memberIndex <= tailEnd
        ? { ...member, supersetGroup: tailId }
        : member,
    ),
    makeId,
  );
}

function runStart(members: readonly SupersetMember[], index: number): number {
  const groupId = groupIdOf(members[index]);
  if (groupId === null) {
    return index;
  }

  let start = index;
  while (start > 0 && groupIdOf(members[start - 1]) === groupId) {
    start -= 1;
  }
  return start;
}

function runEnd(members: readonly SupersetMember[], index: number): number {
  const groupId = groupIdOf(members[index]);
  if (groupId === null) {
    return index;
  }

  let end = index;
  while (end < members.length - 1 && groupIdOf(members[end + 1]) === groupId) {
    end += 1;
  }
  return end;
}

/**
 * The order a superset is actually performed in: one set of every lift in the
 * group, then the next set of every lift, and so on.
 *
 * Returned as (member index, set index) pairs over the group, which is the
 * shape both the guided player's step list and the free workout's rest rule
 * need. Lifts in one group rarely disagree about set count — the day view
 * offers the pair one dose — but when they do, the longer lift simply
 * continues alone once the shorter one runs out, which is what a person does.
 */
/**
 * The set count every lift in a superset should carry: the first lift's.
 *
 * A superset is counted in ROUNDS, so two lifts inside one that disagree about
 * how many sets they do leave the block four rounds of which one lift does
 * three — and every screen that states the block then has to explain itself.
 * Asked for from the gym floor: "miten romanialainen mave voi olla 3 × 10 ja
 * takakyykky 4 × 8 jos on superset?" (2026-09-11). It cannot, so linking makes
 * it so.
 *
 * The FIRST lift decides, because it is the one the block is built on — the
 * heavier of the pair by convention, and the one whose dose the reader chose
 * before pairing anything. Returned as index → sets rather than applied, so
 * the caller keeps whatever shape its rows are in.
 */
export function supersetSetTargets(
  members: readonly SupersetMember[],
  setsOf: (index: number) => number,
): Map<number, number> {
  const targets = new Map<number, number>();

  buildSupersetRuns(normalizeSupersetGroups(members)).forEach((run) => {
    if (run.groupId === null || run.indexes.length < 2) {
      return;
    }
    const anchor = setsOf(run.indexes[0]);
    run.indexes.forEach((index) => {
      if (setsOf(index) !== anchor) {
        targets.set(index, anchor);
      }
    });
  });

  return targets;
}

/**
 * Every member of the group the row at `index` belongs to, itself included —
 * or just that row, when it is not in one.
 *
 * The shape every "do this to the whole block" action needs: a superset's set
 * count is ONE number, so adding a set adds it to both lifts and taking one
 * back takes both. A button that moved one half would put the block straight
 * back into the state the linking rule exists to prevent.
 */
export function supersetGroupIndexes(members: readonly SupersetMember[], index: number): number[] {
  if (index < 0 || index >= members.length) {
    return [];
  }

  const run = buildSupersetRuns(normalizeSupersetGroups(members)).find((candidate) =>
    candidate.indexes.includes(index),
  );
  return run && run.groupId !== null && run.indexes.length > 1 ? run.indexes : [index];
}

/** One set of one lift, addressed the way both loggers address it. */
interface SupersetPlaySlot {
  exerciseIndex: number;
  setIndex: number;
}

/**
 * Every set in the session, in the order it is meant to be performed.
 *
 * This is the list logger's and the player's shared answer to "what is next",
 * and it exists so the two cannot disagree. Without supersets it is simply
 * every lift's sets in order, which is what both did before; with them, the
 * lifts of a group interleave a round at a time.
 *
 * Takes set COUNTS rather than the sets themselves: what is pending is the
 * caller's question, and a plan that changed shape as sets were logged would
 * be a different plan after every tap.
 */
export function buildSupersetPlayOrder(
  exercises: readonly (SupersetMember & { setCount: number })[],
): SupersetPlaySlot[] {
  const order: SupersetPlaySlot[] = [];

  buildSupersetRuns(normalizeSupersetGroups(exercises)).forEach((run) => {
    const counts = run.indexes.map((index) => exercises[index].setCount);
    supersetRoundOrder(counts).forEach((entry) => {
      order.push({ exerciseIndex: run.indexes[entry.memberIndex], setIndex: entry.setIndex });
    });
  });

  return order;
}

export function supersetRoundOrder(setCounts: readonly number[]): Array<{ memberIndex: number; setIndex: number }> {
  const rounds = Math.max(0, ...setCounts);
  const order: Array<{ memberIndex: number; setIndex: number }> = [];

  for (let setIndex = 0; setIndex < rounds; setIndex += 1) {
    setCounts.forEach((setCount, memberIndex) => {
      if (setIndex < setCount) {
        order.push({ memberIndex, setIndex });
      }
    });
  }

  return order;
}
