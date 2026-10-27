/**
 * What the backup row shows as paused, and what deleting the cloud copy
 * leaves behind. Pure, so the rules are tested as behaviour rather than read
 * back from the hook's source.
 */
type BackupPause = 'other_phone' | 'smaller_phone' | 'copy_deleted';

/** The account fields a deleted cloud copy touches. */
interface BackupBookkeeping {
  lastBackupAt: string | null;
  lastBackupItemCount: number | null;
  lastBackupHistoryCount: number | null;
  lastBackupFingerprint: string | null;
  autoBackupPaused: boolean;
  cloudVersion: string | null;
  cloudCopyDeletedAt?: string | null;
}

/**
 * The account after the reader deleted the cloud copy: no backup on record,
 * automatic backup paused until their own "Back up now", and an older "deleted
 * elsewhere" mark cleared - the copy is gone by their own hand, so it has
 * nothing left to say.
 */
export function accountAfterCloudCopyDeleted<A extends BackupBookkeeping>(account: A): A {
  return {
    ...account,
    lastBackupAt: null,
    lastBackupItemCount: null,
    lastBackupHistoryCount: null,
    lastBackupFingerprint: null,
    autoBackupPaused: true,
    cloudVersion: null,
    cloudCopyDeletedAt: null,
  };
}

/**
 * The pause the row shows: the one noticed during this session, else the
 * "copy deleted" mark held on the account across launches.
 */
export function visibleBackupPause(live: BackupPause | null, cloudCopyDeletedAt: string | null | undefined): BackupPause | null {
  return live ?? (cloudCopyDeletedAt ? 'copy_deleted' : null);
}
