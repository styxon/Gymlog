import React, { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { ConfirmDialog } from '../../components/ConfirmDialog';
import { t } from '../../lib/i18n';
import { AppLanguage } from '../../types/models';
import { AppUpdateNotice, getAppUpdateNotice, subscribeAppUpdateNotice } from './appUpdateSignal';

/**
 * "Update Vinha", raised when our server refuses this build (appUpdateSignal).
 *
 * Asked once per launch, at a calm moment (`held` while anything else is
 * asking or a workout is running), and never blocking: the refusal only
 * reaches the server features, and everything on the phone keeps working, so
 * the reader can say later and keep logging. A build that is still refused asks again
 * the next time it starts and reaches the server.
 */
export function AppUpdateDialog({
  language,
  held,
  onShownChange,
}: {
  language: AppLanguage;
  held: boolean;
  /** Whether the dialog is up: Home's sign-in dialog waits for it (HomeScreen). */
  onShownChange?: (shown: boolean) => void;
}) {
  const [notice, setNotice] = useState<AppUpdateNotice | null>(getAppUpdateNotice);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => subscribeAppUpdateNotice(setNotice), []);

  const storeUrl = notice?.storeUrl ?? null;
  const close = () => setDismissed(true);
  const shown = storeUrl !== null && !dismissed && !held;
  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);

  // No store to name — an iOS build before APP_STORE_URL_IOS is set — leaves
  // nothing to press but OK, so it is said with the system's one-button alert.
  useEffect(() => {
    if (notice && !notice.storeUrl && !dismissed && !held) {
      setDismissed(true);
      Alert.alert(t(language, 'appUpdate.title'), t(language, 'appUpdate.bodyNoStore'));
    }
  }, [notice, dismissed, held, language]);

  return (
    <ConfirmDialog
      visible={shown}
      title={t(language, 'appUpdate.title')}
      message={t(language, 'appUpdate.body')}
      confirmLabel={t(language, 'appUpdate.update')}
      cancelLabel={t(language, 'appUpdate.later')}
      language={language}
      onCancel={close}
      onConfirm={() => {
        close();
        if (storeUrl) {
          void Linking.openURL(storeUrl).catch(() => undefined);
        }
      }}
    />
  );
}
