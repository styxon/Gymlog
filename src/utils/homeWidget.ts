/**
 * Hands the home-screen widget its contents.
 *
 * The widget is drawn by the launcher in a process that has none of the app's
 * state, so the app writes a small JSON file the widget can read on its own
 * schedule. That is the whole bridge: no native module, no broadcast, no
 * shared preferences.
 *
 * The trade-off is refresh latency. Android will not update a widget more
 * often than every 30 minutes on its own, so a change made in the app can take
 * that long to appear. The content is day-granular, so this is invisible in
 * practice — except right after a workout, and the widget does not claim
 * otherwise.
 *
 * Kotlin reads `context.filesDir/vinha-widget.json`. Keep that in step with
 * `plugins/withHomeWidget.js`.
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

import type { HomeWidgetPayload } from '../lib/widgetPayload';

const HOME_WIDGET_FILE_NAME = 'vinha-widget.json';

/**
 * Writes the payload. Returns the file URI on success, null when there was
 * nothing to write to — a widget that cannot be fed is never a reason to
 * interrupt the app.
 */
export function writeHomeWidgetPayload(payload: HomeWidgetPayload): string | null {
  // iOS widgets are a separate extension target that does not exist here.
  if (Platform.OS !== 'android') {
    return null;
  }

  try {
    const file = new File(Paths.document, HOME_WIDGET_FILE_NAME);
    if (!file.exists) {
      file.create({ intermediates: true, overwrite: true });
    }
    file.write(JSON.stringify(payload));
    return file.uri;
  } catch {
    return null;
  }
}
