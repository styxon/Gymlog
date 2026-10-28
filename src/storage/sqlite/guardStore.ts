import {
  parseMirrorGuard,
  serializeMirrorGuard,
  type MirrorGuardState,
} from '../../lib/historyMirrorGuard';

/** Where the crash guard keeps its state: one small string, outside the database it guards. */
export interface GuardStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

/**
 * The guard's state as stored: the empty state when the row is missing or does
 * not parse. A read that FAILS rejects instead: treating it as empty would
 * write the counts back as zeros and forget the crashes.
 */
export async function readMirrorGuard(store: GuardStore): Promise<MirrorGuardState> {
  return parseMirrorGuard(await store.read());
}

/** Read, change, write back. Rejects when the write fails; a caller says whether that matters. */
export async function updateMirrorGuard(
  store: GuardStore,
  change: (state: MirrorGuardState) => MirrorGuardState,
): Promise<MirrorGuardState> {
  const current = await readMirrorGuard(store);
  const next = change(current);
  if (next !== current) {
    await store.write(serializeMirrorGuard(next));
  }
  return next;
}
