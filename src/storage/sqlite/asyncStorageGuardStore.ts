import AsyncStorage from '@react-native-async-storage/async-storage';
import { MIRROR_GUARD_STORAGE_KEY } from '../../lib/historyMirrorGuard';
import type { GuardStore } from './guardStore';

/**
 * The crash guard's row in AsyncStorage: a few bytes, outside the database it
 * guards. Reset does not touch it (it holds nothing of the user's), and it is
 * deliberately not a large item.
 */
export function createAsyncStorageGuardStore(): GuardStore {
  return {
    read: () => AsyncStorage.getItem(MIRROR_GUARD_STORAGE_KEY),
    write: (value) => AsyncStorage.setItem(MIRROR_GUARD_STORAGE_KEY, value),
  };
}
