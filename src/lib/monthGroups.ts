/**
 * One rule for "group these by the month they happened in".
 *
 * Records grouped its own way and History did not group at all; the Progress
 * v2 brief gives History the same month headers Records has, and two copies of
 * the same arithmetic is how they start disagreeing about which month a
 * midnight entry belongs to.
 *
 * Newest month first, because both screens answer "what have I done lately"
 * before "what did I do in March".
 */
interface MonthGroup<T> {
  year: number;
  /** 0-based, matching Date#getMonth and the month label tables. */
  month: number;
  items: T[];
}

/**
 * Grouped by LOCAL month, not by UTC.
 *
 * A session logged at half past midnight on the 1st belongs to the month the
 * reader was in when they trained, and Date#getMonth is the only reading that
 * agrees with the calendar on their wall.
 *
 * An item whose date does not parse is dropped rather than bundled into a
 * group of its own: a header reading "NaN" is worse than a missing row, and
 * the loader normalises what it stores, so this is a belt to that brace.
 */
export function groupByMonth<T>(items: readonly T[], getDate: (item: T) => string): Array<MonthGroup<T>> {
  const groups = new Map<string, MonthGroup<T>>();

  for (const item of items) {
    const date = new Date(getDate(item));
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const year = date.getFullYear();
    const month = date.getMonth();
    const key = `${year}-${month}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { year, month, items: [item] });
    }
  }

  return [...groups.values()].sort((left, right) =>
    right.year !== left.year ? right.year - left.year : right.month - left.month,
  );
}
